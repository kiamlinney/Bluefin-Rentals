// A Turo vehicle swap waiting for us to say which car the trip is on now.
// Pure and isomorphic: the calendar and the Booked tab decide what to flag with
// it, and the server decides what to list.
//
// Turo's "X accepted your vehicle swap request" email names the reservation but
// not the replacement car, so the sync can only record that a swap happened
// (swap_accepted_at). It is settled when an owner picks the car, or a later Turo
// email about the trip names it (swap_car_confirmed_at). Until then the trip
// stays on the original car, which keeps that car blocked; the new one isn't.

export function isTuroSwapPending(trip: {
    swap_accepted_at: string | null
    swap_car_confirmed_at: string | null
}): boolean {
    if (!trip.swap_accepted_at) return false
    if (!trip.swap_car_confirmed_at) return true
    return new Date(trip.swap_car_confirmed_at).getTime() < new Date(trip.swap_accepted_at).getTime()
}

/** Identifies one acceptance: a later swap on the same trip gets a new key. */
export function turoSwapKey(trip: { id: string; swap_accepted_at: string | null }): string {
    return `${trip.id}:${trip.swap_accepted_at}`
}

/**
 * The pending swap the dialog should open by itself for, skipping swaps this
 * page has already settled. The skip is what stops a settled swap reopening:
 * the dialog closes a moment before the page's reloaded data arrives, and
 * until then the old copy of the trip still reads as pending.
 */
export function nextSwapToPrompt<T extends { id: string; swap_accepted_at: string | null; swap_car_confirmed_at: string | null }>(
    turoBookings: T[],
    settledKeys: ReadonlySet<string>,
): T | null {
    return turoBookings.find(trip => isTuroSwapPending(trip) && !settledKeys.has(turoSwapKey(trip))) ?? null
}

export function turoReservationUrl(turoTripId: string): string {
    return `https://turo.com/us/en/reservation/${turoTripId}`
}
