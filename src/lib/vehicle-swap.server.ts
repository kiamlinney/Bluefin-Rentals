// Moving a booked trip onto another car, before it starts.
//
// Server-only (.server.ts) for the same reason as payments.server.ts: these are
// plain exported functions using the service-role client, and db.ts — which
// wraps them in server functions — is imported by browser pages.
//
// What a swap is, decided 2026-10-06 (ImportantFiles/decisions-log.md):
// - Only a confirmed trip that hasn't started, and only onto a car that is free
//   for the whole trip by the same rule checkout uses (assertCarIsAvailable —
//   other trips, live holds, Turo trips, blocked dates, the turnaround buffer).
// - The price doesn't change: no charge, no refund, price_quote untouched.
// - The per-mile overage rate stays the quoted car's. That's what `pricingCar`
//   is for — the first swap's from_car_id is the car the trip was priced on.
// - The guest is emailed the reason; the normal cancellation policy applies.
//
// bookings.car_id is the only thing that moves. The deposit, extras, drivers,
// photos, extension holds and the calendar all hang off the booking, so they
// follow it without being touched.

import type { SupabaseClient } from '@supabase/supabase-js'
import { assertCarIsAvailable, PENDING_HOLD_MS } from './availability.server'
import { TURNAROUND_HOURS } from './availability'
import { summarizeRatings } from './reviews'
import { sendVehicleSwapEmail } from './swap-email'
import {
    swapReasonError,
    type OriginalSwapCar,
    type SwapCandidate,
    type SwapCar,
    type VehicleSwap,
} from './vehicle-swap'
import type { Car } from '@/types'

type AdminClient = SupabaseClient<any, any, any>

const SWAP_CAR_COLUMNS = 'id, make, model, year'

/**
 * A trip's swap history, oldest first, and the car its price was quoted on
 * (null when it has never been swapped, i.e. the current car).
 */
export async function loadVehicleSwaps(
    supabaseAdmin: AdminClient,
    bookingId: string,
): Promise<{ swaps: VehicleSwap[]; pricingCar: Car | null }> {
    const { data: rows, error } = await supabaseAdmin
        .from('booking_vehicle_swaps')
        .select('id, created_at, reason, from_car_id, to_car_id')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: true })

    if (error) throw new Error(error.message)
    if (!rows?.length) return { swaps: [], pricingCar: null }

    // The car columns carry no foreign key (see the migration), so the cars are
    // fetched separately rather than embedded.
    const carIds = [...new Set(rows.flatMap(r => [r.from_car_id, r.to_car_id]))]
    const { data: cars, error: carErr } = await supabaseAdmin
        .from('cars')
        .select('*')
        .in('id', carIds)
    if (carErr) throw new Error(carErr.message)

    const byId = new Map<number, Car>((cars ?? []).map((car: Car) => [car.id, car]))
    const named = (id: number): SwapCar | null => {
        const car = byId.get(id)
        return car ? { id: car.id, make: car.make, model: car.model, year: car.year } : null
    }

    return {
        swaps: rows.map(r => ({
            id: r.id,
            created_at: r.created_at,
            reason: r.reason,
            from_car: named(r.from_car_id),
            to_car: named(r.to_car_id),
        })),
        pricingCar: byId.get(rows[0]!.from_car_id) ?? null,
    }
}

/** The booking row plus its swap history, for the trip and reservation loaders. */
export async function withVehicleSwaps<T extends { id: string }>(
    supabaseAdmin: AdminClient,
    booking: T,
): Promise<T & { vehicle_swaps: VehicleSwap[]; pricing_car: Car | null }> {
    const { swaps, pricingCar } = await loadVehicleSwaps(supabaseAdmin, booking.id)
    return { ...booking, vehicle_swaps: swaps, pricing_car: pricingCar }
}

type SwappableBooking = {
    id: string
    car_id: number
    status: string
    start_time: string
    end_time: string
}

/**
 * Why this trip can't be swapped, or null when it can. One rule for the dialog
 * and the swap itself: confirmed, and not started yet.
 */
function notSwappableReason(booking: SwappableBooking, now: Date): string | null {
    if (booking.status !== 'confirmed') return 'Only a confirmed trip can be swapped.'
    if (new Date(booking.start_time) <= now) return 'This trip has already started, so its vehicle can no longer be swapped.'
    return null
}

/**
 * The latest the new car has to be free until.
 *
 * Usually the trip's end. An extension waiting on an owner, or one being paid
 * for right now, holds time past it — and that hold moves with the booking
 * (extensionHoldRows joins on bookings.car_id), so the new car has to be free
 * for that too or the swap would land the request on top of someone's trip.
 */
async function effectiveTripEnd(supabaseAdmin: AdminClient, booking: SwappableBooking): Promise<string> {
    const holdCutoff = new Date(Date.now() - PENDING_HOLD_MS).toISOString()
    const { data, error } = await supabaseAdmin
        .from('booking_extensions')
        .select('to_end_time')
        .eq('booking_id', booking.id)
        .or(`status.eq.requested,and(status.eq.pending,created_at.gte.${holdCutoff})`)
    if (error) throw new Error(error.message)

    return (data ?? []).reduce(
        (latest: string, row: { to_end_time: string }) =>
            new Date(row.to_end_time) > new Date(latest) ? row.to_end_time : latest,
        booking.end_time,
    )
}

async function loadSwappableBooking(supabaseAdmin: AdminClient, bookingId: string): Promise<SwappableBooking> {
    const { data, error } = await supabaseAdmin
        .from('bookings')
        .select('id, car_id, status, start_time, end_time')
        .eq('id', bookingId)
        .single()
    if (error || !data) throw new Error('Booking not found')
    return data as SwappableBooking
}

/**
 * Every listed car this trip could move to, plus the car it was booked on.
 *
 * Other cars that aren't free are left out rather than shown greyed: the owners
 * only want the ones they can pick. The original car is the exception. Swapping
 * back is the one move an owner expects to be there, so it's always returned
 * once the trip has left it, with the reason when it can't be picked. Without
 * that it silently vanished whenever someone else had booked it in the
 * meantime, which read as a bug.
 */
export async function findSwapCandidates(
    supabaseAdmin: AdminClient,
    bookingId: string,
): Promise<{ candidates: SwapCandidate[]; original: OriginalSwapCar | null; blockedReason: string | null }> {
    const booking = await loadSwappableBooking(supabaseAdmin, bookingId)
    const blockedReason = notSwappableReason(booking, new Date())
    if (blockedReason) return { candidates: [], original: null, blockedReason }

    // The first swap's from_car_id is the car the trip was booked on. Null when
    // the trip has never been swapped, or has already been swapped back.
    const { data: firstSwap, error: swapErr } = await supabaseAdmin
        .from('booking_vehicle_swaps')
        .select('from_car_id')
        .eq('booking_id', booking.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
    if (swapErr) throw new Error(swapErr.message)
    const originalId: number | null =
        firstSwap && firstSwap.from_car_id !== booking.car_id ? firstSwap.from_car_id : null

    // Listed cars, and the original even if it has since been unlisted, so it
    // can say why it isn't offered.
    const { data: cars, error } = await supabaseAdmin
        .from('cars')
        .select('id, make, model, year, trim, license_plate, is_available')
        .or(originalId === null ? 'is_available.eq.true' : `is_available.eq.true,id.eq.${originalId}`)
        .neq('id', booking.car_id)
        .order('make', { ascending: true })
        .order('model', { ascending: true })
        .order('year', { ascending: true })
    if (error) throw new Error(error.message)
    if (!cars?.length) return { candidates: [], original: null, blockedReason: null }

    const tripEnd = await effectiveTripEnd(supabaseAdmin, booking)

    // assertCarIsAvailable throws on any conflict, so "free" is "didn't throw".
    // The same check the swap re-runs, so the list can't offer a car the swap
    // would then refuse — barring something being booked in between.
    const free = await Promise.all(cars.map(async car => {
        if (!car.is_available) return false
        try {
            await assertCarIsAvailable(car.id, booking.start_time, tripEnd, { excludeBookingId: booking.id })
            return true
        } catch {
            return false
        }
    }))
    const shown = cars.filter((car, i) => free[i] || car.id === originalId)
    if (!shown.length) return { candidates: [], original: null, blockedReason: null }

    const ids = shown.map(car => car.id)
    const [reviewsRes, completedRes, turoRes] = await Promise.all([
        supabaseAdmin.from('reviews').select('car_id, rating').in('car_id', ids).is('removed_at', null),
        supabaseAdmin.from('bookings').select('car_id').in('car_id', ids).eq('status', 'completed'),
        // Turo trips are this car's history too — most of it, during the
        // migration — so a car isn't shown as untried because it rented on Turo.
        supabaseAdmin.from('turo_bookings').select('car_id').in('car_id', ids).lt('end_time', new Date().toISOString()),
    ])
    for (const res of [reviewsRes, completedRes, turoRes]) {
        if (res.error) throw new Error(res.error.message)
    }

    const countFor = (rows: { car_id: number }[] | null, carId: number) =>
        (rows ?? []).filter(row => row.car_id === carId).length

    const withStats = (car: (typeof cars)[number]): SwapCandidate => {
        const summary = summarizeRatings(
            (reviewsRes.data ?? []).filter(r => r.car_id === car.id).map(r => Number(r.rating)),
        )
        return {
            id: car.id,
            make: car.make,
            model: car.model,
            year: car.year,
            trim: car.trim,
            license_plate: car.license_plate,
            rating: summary.average,
            reviewCount: summary.count,
            completedTrips: countFor(completedRes.data, car.id) + countFor(turoRes.data, car.id),
        }
    }

    const originalIndex = cars.findIndex(car => car.id === originalId)
    const originalCar = originalIndex >= 0 ? cars[originalIndex]! : null
    const original: OriginalSwapCar | null = originalCar
        ? {
            ...withStats(originalCar),
            unavailableReason: !originalCar.is_available
                ? "It's no longer listed, so the trip can't move back to it."
                : free[originalIndex]
                    ? null
                    : `It isn't free for this trip any more: it has another trip, a Turo trip or a blocked date ` +
                      `over these dates or within the ${TURNAROUND_HOURS}-hour turnaround. Check the calendar.`,
        }
        : null

    return {
        blockedReason: null,
        original,
        candidates: cars.filter((car, i) => free[i] && car.id !== originalId).map(withStats),
    }
}

/**
 * Moves the trip onto `toCarId`, records why, and emails the guest.
 *
 * Re-checks everything the dialog showed, because the dialog is only a view and
 * this is callable directly. The move is a conditional update on the car the
 * trip was on when it was read, so a double-click or a second tab can't swap
 * twice — the same claim pattern as cancelBooking.
 *
 * Check-then-write, like checkout: a checkout for the target car landing in the
 * same instant isn't locked out. Accepted for the same reason it is there.
 *
 * The email is sent after the swap is committed and never fails it; the caller
 * is told whether it went, so the owner can tell the guest themselves if not.
 */
export async function performVehicleSwap(
    supabaseAdmin: AdminClient,
    input: { bookingId: string; toCarId: number; reason: string; adminId: string },
): Promise<{ emailSent: boolean }> {
    const reasonError = swapReasonError(input.reason)
    if (reasonError) throw new Error(reasonError)
    const reason = input.reason.trim()

    const booking = await loadSwappableBooking(supabaseAdmin, input.bookingId)
    const blockedReason = notSwappableReason(booking, new Date())
    if (blockedReason) throw new Error(blockedReason)
    if (booking.car_id === input.toCarId) throw new Error('The trip is already on that car.')

    const { data: target, error: carErr } = await supabaseAdmin
        .from('cars')
        .select(`${SWAP_CAR_COLUMNS}, is_available`)
        .eq('id', input.toCarId)
        .maybeSingle()
    if (carErr) throw new Error(carErr.message)
    if (!target || !target.is_available) throw new Error('That car is not listed, so a trip cannot be moved onto it.')

    const tripEnd = await effectiveTripEnd(supabaseAdmin, booking)
    await assertCarIsAvailable(input.toCarId, booking.start_time, tripEnd, { excludeBookingId: booking.id })

    const fromCarId = booking.car_id
    const { data: moved, error: moveErr } = await supabaseAdmin
        .from('bookings')
        .update({ car_id: input.toCarId })
        .eq('id', booking.id)
        .eq('car_id', fromCarId)
        .eq('status', 'confirmed')
        .gt('start_time', new Date().toISOString())
        .select('id')
        .maybeSingle()
    if (moveErr) throw new Error(moveErr.message)
    if (!moved) throw new Error('This trip changed while you were looking at it. Reload the page and try again.')

    const { error: recordErr } = await supabaseAdmin
        .from('booking_vehicle_swaps')
        .insert({
            booking_id: booking.id,
            from_car_id: fromCarId,
            to_car_id: input.toCarId,
            reason,
            swapped_by: input.adminId,
        })
    if (recordErr) {
        // No record means no quoted car for the mileage rate and no history, so
        // the swap is put back rather than left half-done.
        await supabaseAdmin
            .from('bookings')
            .update({ car_id: fromCarId })
            .eq('id', booking.id)
            .eq('car_id', input.toCarId)
        throw new Error(`Could not record the swap, so nothing was changed: ${recordErr.message}`)
    }

    const { data: fromCar } = await supabaseAdmin
        .from('cars')
        .select(SWAP_CAR_COLUMNS)
        .eq('id', fromCarId)
        .maybeSingle()

    try {
        const sent = await sendVehicleSwapEmail(supabaseAdmin, booking.id, (fromCar as SwapCar | null) ?? null, reason)
        return { emailSent: sent }
    } catch (err: any) {
        console.error(`[email] vehicle swap email failed for ${booking.id}:`, err?.message || err)
        return { emailSent: false }
    }
}
