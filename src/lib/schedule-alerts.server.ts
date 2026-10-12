// Emails the owners about trips that overlap on the same car, once per overlap.
//
// Runs at the end of every Turo sync (every 15 minutes, and on the admin's
// Sync button) and after an owner picks the car for a Turo swap. Scanning the
// whole upcoming schedule each time, rather than checking whatever just
// changed, means an overlap gets caught however it came about (a new Turo
// booking, a swap, a late payment) without touching the payment code.
//
// Server-only: it reads with the service-role client the caller passes in,
// because schedule_overlap_alerts has no policies.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { SITE_URL } from './email-template'
import {
    bookingTrips,
    findScheduleOverlaps,
    tripKey,
    turoTrips,
    type ScheduleOverlap,
    type ScheduleTrip,
} from './schedule-overlaps'
import { sendOverlapAlert, type AlertTrip } from './turo-alert-email'
import { turoReservationUrl } from './turo-swap'

type Db = SupabaseClient<Database>

export type ScheduleCar = { id: number; year: number; make: string; model: string; license_plate: string | null }

type TuroRowForAlert = { id: string; renter_name: string | null; turo_trip_id: string | null; start_time: string; end_time: string }

export function describeTuroTrip(trip: TuroRowForAlert): AlertTrip {
    return {
        source: 'turo',
        who: trip.renter_name ?? 'Turo guest',
        reference: trip.turo_trip_id ? `Turo #${trip.turo_trip_id}` : 'Turo trip',
        start_time: trip.start_time,
        end_time: trip.end_time,
        url: trip.turo_trip_id ? turoReservationUrl(trip.turo_trip_id) : `${SITE_URL}/admin/calendar`,
    }
}

function describeBooking(booking: {
    id: string
    start_time: string
    end_time: string
    profiles: { full_name: string | null; email: string | null } | null
}): AlertTrip {
    return {
        source: 'booking',
        who: booking.profiles?.full_name ?? booking.profiles?.email ?? 'Guest',
        reference: `Bluefin #${booking.id.slice(0, 8).toUpperCase()}`,
        start_time: booking.start_time,
        end_time: booking.end_time,
        url: `${SITE_URL}/admin/reservation/${booking.id}`,
    }
}

/**
 * Every trip that hasn't ended: confirmed Bluefin trips and Turo trips, with
 * what an owner needs to recognise each one, and the cars by id.
 */
export async function loadUpcomingSchedule(supabase: Db, now: Date) {
    const nowIso = now.toISOString()
    const [bookingsRes, turoRes, carsRes] = await Promise.all([
        supabase
            .from('bookings')
            .select('id, car_id, start_time, end_time, status, profiles(full_name, email)')
            .eq('status', 'confirmed')
            .gt('end_time', nowIso),
        supabase
            .from('turo_bookings')
            .select('id, car_id, start_time, end_time, turo_trip_id, renter_name')
            .gt('end_time', nowIso),
        supabase.from('cars').select('id, year, make, model, license_plate'),
    ])
    if (bookingsRes.error) throw new Error(bookingsRes.error.message)
    if (turoRes.error) throw new Error(turoRes.error.message)
    if (carsRes.error) throw new Error(carsRes.error.message)

    const bookings = bookingsRes.data ?? []
    const turo = turoRes.data ?? []
    const details = new Map<string, AlertTrip>()
    for (const b of bookings) details.set(tripKey({ source: 'booking', id: b.id }), describeBooking(b))
    for (const t of turo) details.set(tripKey({ source: 'turo', id: t.id }), describeTuroTrip(t))

    return {
        trips: [...bookingTrips(bookings), ...turoTrips(turo)] as ScheduleTrip[],
        details,
        cars: new Map<number, ScheduleCar>((carsRes.data ?? []).map(c => [c.id, c])),
    }
}

/**
 * Emails any overlap the owners haven't been told about yet. Returns how many
 * were emailed. Each overlap is claimed in schedule_overlap_alerts first, so
 * two runs at once can't both send it; if the send fails the claims are
 * released and the next run tries again.
 *
 * An overlap that is resolved and later recurs between the same two trips is
 * not emailed again; the calendar and the Booked tab still flag it.
 */
export async function alertNewOverlaps(supabase: Db, now: Date = new Date()): Promise<number> {
    const schedule = await loadUpcomingSchedule(supabase, now)
    const overlaps = findScheduleOverlaps(schedule.trips, now)
    if (overlaps.length === 0) return 0

    const { data: known, error: knownError } = await supabase
        .from('schedule_overlap_alerts')
        .select('pair_key')
        .in('pair_key', overlaps.map(o => o.key))
    if (knownError) throw new Error(knownError.message)
    const knownKeys = new Set((known ?? []).map(k => k.pair_key))

    const claimed: ScheduleOverlap[] = []
    let claimError: string | null = null
    for (const overlap of overlaps) {
        if (knownKeys.has(overlap.key)) continue
        const { error } = await supabase
            .from('schedule_overlap_alerts')
            .insert({ pair_key: overlap.key, car_id: overlap.car_id })
        if (!error) claimed.push(overlap)
        // 23505: another run claimed it a moment ago and is sending it.
        else if (error.code !== '23505') {
            claimError = error.message
            break
        }
    }

    // Whatever was claimed is sent even if a later claim failed: a claim
    // without its email would never be sent at all.
    if (claimed.length > 0) {
        try {
            await sendOverlapAlert(claimed.map(overlap => ({
                car: schedule.cars.get(overlap.car_id) ?? null,
                trips: overlap.trips.map(trip => schedule.details.get(tripKey(trip))!) as [AlertTrip, AlertTrip],
            })))
        } catch (err) {
            await supabase
                .from('schedule_overlap_alerts')
                .delete()
                .in('pair_key', claimed.map(o => o.key))
            throw err
        }
    }
    if (claimError) throw new Error(claimError)
    return claimed.length
}
