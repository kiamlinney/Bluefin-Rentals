// Moving a booked trip onto another car — the shapes and limits both sides use.
//
// Isomorphic: the admin swap dialog and the trip pages import these, and the
// server functions in db.ts enforce the same limit. The rules themselves live
// in vehicle-swap.server.ts.

// Matches the check constraint on booking_vehicle_swaps.reason.
export const SWAP_REASON_MAX = 1000

export type SwapCar = { id: number; make: string; model: string; year: number }

/** One row of booking_vehicle_swaps, with both cars named. */
export type VehicleSwap = {
    id: string
    created_at: string
    reason: string
    from_car: SwapCar | null
    to_car: SwapCar | null
}

/** A car the swap dialog offers: free for the whole trip, turnaround included. */
export type SwapCandidate = SwapCar & {
    trim: string | null
    license_plate: string | null
    /** Average star rating, null when the car has no reviews yet. */
    rating: number | null
    reviewCount: number
    completedTrips: number
}

/**
 * The car the trip was booked on, once it has been swapped away. Always shown
 * at the top of the swap dialog; `unavailableReason` is set when it can't be
 * picked (taken by another trip, or unlisted).
 */
export type OriginalSwapCar = SwapCandidate & { unavailableReason: string | null }

/** Trims the reason and returns an error message, or null when it's usable. */
export function swapReasonError(reason: string): string | null {
    const trimmed = reason.trim()
    if (!trimmed) return 'Write a reason. It is emailed to the guest.'
    if (trimmed.length > SWAP_REASON_MAX) return `Keep the reason under ${SWAP_REASON_MAX} characters.`
    return null
}
