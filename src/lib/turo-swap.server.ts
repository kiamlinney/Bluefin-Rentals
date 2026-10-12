// Settling a Turo vehicle swap: an owner says which car the trip is on now.
// See turo-swap.ts for why the sync can't work it out. db.ts wraps both
// functions in admin-only server functions; they take the service-role client.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { formatBusinessDate, formatBusinessTime } from './dates'
import { findScheduleOverlaps, otherTrip, tripKey, type ScheduleTrip } from './schedule-overlaps'
import { alertNewOverlaps, loadUpcomingSchedule } from './schedule-alerts.server'

type Db = SupabaseClient<Database>

export type TuroSwapCarOption = {
    id: number
    make: string
    model: string
    year: number
    trim: string | null
    license_plate: string | null
    /** The car the trip is on now (the original, until a car is picked). */
    isCurrent: boolean
    /** Other trips on this car at the same time. Shown as a warning, never a block. */
    clashes: string[]
}

function shortRange(start: string, end: string): string {
    const day = (iso: string) => formatBusinessDate(iso, { month: 'short', day: 'numeric' })
    return `${day(start)}, ${formatBusinessTime(start)} to ${day(end)}, ${formatBusinessTime(end)}`
}

async function loadTrip(supabase: Db, turoBookingId: string) {
    const { data: trip, error } = await supabase
        .from('turo_bookings')
        .select('id, car_id, start_time, end_time, turo_trip_id, renter_name, swap_accepted_at, swap_car_confirmed_at')
        .eq('id', turoBookingId)
        .maybeSingle()
    if (error) throw new Error(error.message)
    if (!trip) throw new Error('That Turo trip is no longer on the calendar.')
    return trip
}

/** What the trip would clash with on `carId`, described for the dialog. */
function clashesOn(
    carId: number,
    trip: { id: string; start_time: string; end_time: string },
    schedule: Awaited<ReturnType<typeof loadUpcomingSchedule>>,
    now: Date,
): string[] {
    const self: ScheduleTrip = { source: 'turo', id: trip.id, car_id: carId, start_time: trip.start_time, end_time: trip.end_time }
    const others = schedule.trips.filter(t => t.car_id === carId && tripKey(t) !== tripKey(self))
    return findScheduleOverlaps([self, ...others], now)
        .filter(o => o.trips.some(t => tripKey(t) === tripKey(self)))
        .map(o => {
            const other = otherTrip(o, self)
            const details = schedule.details.get(tripKey(other))
            return `${details?.reference ?? 'A trip'} · ${details?.who ?? ''} · ${shortRange(other.start_time, other.end_time)}`
        })
}

/** Every car the trip could be on: active cars, plus the current one whatever its state. */
export async function turoSwapOptions(supabase: Db, turoBookingId: string, now: Date = new Date()) {
    const trip = await loadTrip(supabase, turoBookingId)
    const [{ data: cars, error }, schedule] = await Promise.all([
        supabase
            .from('cars')
            .select('id, make, model, year, trim, license_plate, is_available')
            .order('make')
            .order('model'),
        loadUpcomingSchedule(supabase, now),
    ])
    if (error) throw new Error(error.message)

    const options: TuroSwapCarOption[] = (cars ?? [])
        .filter(car => car.is_available || car.id === trip.car_id)
        .map(car => ({
            id: car.id,
            make: car.make,
            model: car.model,
            year: car.year,
            trim: car.trim,
            license_plate: car.license_plate,
            isCurrent: car.id === trip.car_id,
            clashes: clashesOn(car.id, trip, schedule, now),
        }))
        // The current car first, the way the reservation page's swap dialog
        // puts the original car at the top.
        .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent))

    return { options }
}

/**
 * Moves the trip onto `carId` and settles the swap. Turo has already committed
 * the guest to that car, so a clash doesn't stop it: the clashes come back for
 * the dialog, and the overlap alert goes out like any other.
 */
export async function assignTuroTripCar(
    supabase: Db,
    { turoBookingId, carId }: { turoBookingId: string; carId: number },
    now: Date = new Date(),
) {
    const trip = await loadTrip(supabase, turoBookingId)

    const { data: car, error: carError } = await supabase
        .from('cars')
        .select('id')
        .eq('id', carId)
        .maybeSingle()
    if (carError) throw new Error(carError.message)
    if (!car) throw new Error('That car no longer exists.')

    const { error } = await supabase
        .from('turo_bookings')
        .update({ car_id: carId, swap_car_confirmed_at: now.toISOString() })
        .eq('id', trip.id)
    if (error) throw new Error(error.message)

    const clashes = clashesOn(carId, trip, await loadUpcomingSchedule(supabase, now), now)

    // Never fails the save: the car is moved either way, and the calendar flags
    // any overlap whether or not the email went out.
    let alertError: string | null = null
    try {
        await alertNewOverlaps(supabase, now)
    } catch (err: unknown) {
        alertError = err instanceof Error ? err.message : 'unknown error'
        console.error('Overlap alert after a Turo swap failed:', alertError)
    }

    return { clashes, alertError }
}
