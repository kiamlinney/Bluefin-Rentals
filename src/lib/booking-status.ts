// What a checkout payment succeeding means for the booking it paid for.
//
// Three paths act on it — the webhook (confirmCheckout), confirmBooking and the
// trip page's revival in getTripForGuest — and before this they each had their
// own idea. confirmBooking had none at all: it confirmed whatever row matched,
// so a refunded, cancelled trip could be flipped back to confirmed by calling
// it directly. Pure and isomorphic so scripts/verify-booking-status.ts can check
// every status against it.

/** Statuses a successful checkout payment turns into `confirmed`. */
export const CONFIRMABLE_BY_PAYMENT = ['pending', 'expired', 'failed'] as const

export type CheckoutPaymentEffect =
    /** Still waiting on this payment: confirm it. `expired` is a late card
     * payment on an abandoned checkout — a paid trip is a real trip. `failed`
     * is a retry after a decline. */
    | 'confirm'
    /** Already confirmed: nothing to change, but the follow-ups still run (each
     * claims itself), since another path may have died before finishing them. */
    | 'already-confirmed'
    /** canceled or completed: the trip has moved on. A refunded trip is never
     * talked back into confirmed. */
    | 'leave'

/**
 * Whether a deposit hold that has just landed on the card may stay there.
 *
 * A confirmed trip is what it's for; a completed one keeps its hold through
 * the inspection window. Anything else — above all a trip cancelled while the
 * hold was being placed — has it released at once, without the "hold placed"
 * email (applyDepositEffects).
 */
export function depositHoldBelongs(status: string): boolean {
    return status === 'confirmed' || status === 'completed'
}

export function checkoutPaymentEffect(
    status: string,
    options: { refunded?: boolean } = {},
): CheckoutPaymentEffect {
    if (status === 'confirmed') return 'already-confirmed'
    // A checkout whose payment was already handed back — a late payment for
    // dates someone else had taken by then — is finished, whatever its status.
    if (options.refunded) return 'leave'
    if ((CONFIRMABLE_BY_PAYMENT as readonly string[]).includes(status)) return 'confirm'
    return 'leave'
}

/**
 * Whether a checkout's hold on the car had already lapsed by `now`: marked
 * `expired` (or `failed`) by the hourly job, or still `pending` but older than
 * the hold. Every other booking stopped respecting its dates at that point, so a
 * payment arriving now can't assume they're still free. `holdMs` is passed in
 * (PENDING_HOLD_MS lives in a server-only module).
 */
export function holdHasLapsed(status: string, createdAt: string | Date, now: Date, holdMs: number): boolean {
    if (status === 'expired' || status === 'failed') return true
    if (status !== 'pending') return false
    return now.getTime() - new Date(createdAt).getTime() > holdMs
}

/**
 * Where a trip is in its life, for every page that shows it.
 *
 * Status alone isn't enough: a trip stays `confirmed` after it ends until the
 * hourly job marks it `completed` (up to an hour, or 48 with an extension
 * request waiting). And time alone isn't enough: a cancelled trip still has
 * future dates. Before this existed each page decided for itself, and they
 * disagreed: in that hour the owner's page said "Booked trip" while the guest's
 * said "Past trip" under a CONFIRMED badge with nothing else to say, and the
 * owner's trip list read "Ending at 3:43 pm" at 4:45 pm (found in rehearsal
 * Test 18, 2026-10-08). It's the same mistake as the cancelled trip that kept
 * counting down to pickup.
 */
export type TripPhase =
    | 'awaiting-payment' // pending: a checkout not paid yet
    | 'upcoming'         // paid, not started
    | 'in-progress'      // paid, started, not ended
    | 'ended'            // over: completed, or confirmed and past its end
    | 'canceled'
    | 'not-paid'         // expired or failed: an abandoned checkout, never a trip

export function tripPhase(
    booking: { status: string; start_time: string; end_time: string },
    now: Date = new Date(),
): TripPhase {
    switch (booking.status) {
        case 'canceled': return 'canceled'
        case 'pending': return 'awaiting-payment'
        case 'expired':
        case 'failed': return 'not-paid'
        case 'completed': return 'ended'
    }
    // confirmed (or anything new): the clock decides.
    if (now >= new Date(booking.end_time)) return 'ended'
    return now >= new Date(booking.start_time) ? 'in-progress' : 'upcoming'
}

/** The word a guest or owner sees for each phase. */
export const TRIP_PHASE_LABEL: Record<TripPhase, string> = {
    'awaiting-payment': 'Awaiting payment',
    upcoming: 'Upcoming',
    'in-progress': 'In progress',
    ended: 'Completed',
    canceled: 'Canceled',
    'not-paid': 'Not paid',
}

/**
 * Whether a cancellation is the business calling a trip off (full refund, "we
 * had to cancel" email) rather than the guest.
 *
 * Decided by who the trip belongs to, not by whether the caller is an admin: an
 * owner cancelling a booking they made for themselves is the guest on it, and
 * gets the guest's terms. Found 2026-10-08 in the rehearsal, where an owner's own
 * non-refundable test booking was refunded in full. Same rule startExtension
 * uses for who is present.
 */
export function cancelsAsBusiness(callerIsAdmin: boolean, callerId: string, bookingUserId: string): boolean {
    return callerIsAdmin && callerId !== bookingUserId
}

/**
 * Whether the owners may bill a trip after checkout (damage, tolls, mileage…).
 *
 * A confirmed or completed trip, and a cancelled one only if it was cancelled
 * once it had started: the guest had the car, and that cancellation refunds
 * nothing, so damage or tolls from it are still owed. A trip cancelled before
 * pickup, an unpaid hold or an abandoned checkout never had the car.
 */
export function ownerChargeAllowed(status: string, startTime: string, canceledAt: string | null): boolean {
    if (status === 'confirmed' || status === 'completed') return true
    if (status === 'canceled' && canceledAt) return new Date(canceledAt) >= new Date(startTime)
    return false
}
