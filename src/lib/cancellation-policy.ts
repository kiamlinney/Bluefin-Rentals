// What a cancellation costs — the money half of the cancellation rules.
//
// booking-rate.ts owns *when* the free window closes, because that date is shown
// at checkout before any of this matters. This module owns what happens on
// either side of it, which is a different question and a much larger one now
// that missing the window is a partial refund rather than a flat no.
//
// Pure and isomorphic like pricing.ts and availability.ts, and for the same
// reason: the cancel dialog has to tell the guest the exact figure *before* they
// confirm, and cancelBooking has to arrive at that figure independently on the
// server without trusting anything the browser sent. Two implementations of this
// arithmetic would eventually disagree, and the shape of that bug is a customer
// being shown one refund and given another.
//
// ── Where the rules come from ────────────────────────────────────────────────
//
// Modelled on Turo's published guest cancellation policy (ClaudeFiles/
// turocancellationpolicy.pdf, revised 2026-04-14), since that's what the
// business is migrating off and what its customers already expect.
//
// Carried over verbatim: the 24-hour free window before trip start; the one-hour
// grace for trips booked inside that window; the 24-hour post-booking grace on
// non-refundable trips; "no credits/refunds issued for non-refundable trips
// canceled after the grace period"; the one-day / half-day cancellation fee split
// at two days; and full refunds for host-initiated cancellations.
//
// Deliberately not carried over:
//   - Turo's trip fee, protection plan, Extras, security deposit and young
//     driver fee. None exist here.
//   - Turo's host cancellation fees ($50 / $25). Those are a platform charging
//     its host. BlueFin *is* the host; there is nobody to charge.
//   - Guest no-show tiers (two days' cost, or 75% of one day). Detecting a
//     no-show needs a check-in concept, and there isn't one — a trip that starts
//     without a cancellation simply runs.
//   - Trip modifications resetting the window. There is no modification feature.
//
// One deliberate divergence: Turo refunds *half* of any delivery fee on a
// partial refund. This refunds it in full, because the car was never delivered
// and keeping money for work not done is harder to defend than the $-value is
// worth.

import type { BookingRate } from './booking-rate.ts'
import { freeCancellationDeadline } from './booking-rate.ts'
import type { TripQuote } from './pricing.ts'

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR

// A trip booked this close to its own start doesn't get the full 24-hour window
// — there isn't one left — so it gets a short grace period from the booking
// instead. Without this rule, booking 6 hours before pickup would mean the free
// window closed 18 hours before the booking existed.
export const LATE_BOOKING_WINDOW_HOURS = 24
export const LATE_BOOKING_GRACE_HOURS = 1

// Trips of this length or shorter are charged half a day rather than a full one.
// Turo's boundary, kept because the reasoning holds: on a two-day trip a
// full-day fee is half the booking.
export const SHORT_TRIP_DAYS = 2

export type RefundReason =
    /** Cancelled inside the free window. */
    | 'within-free-window'
    /** Booked close to pickup, cancelled inside the short grace that buys. */
    | 'late-booking-grace'
    /** Non-refundable, cancelled inside the 24h post-booking grace. */
    | 'non-refundable-grace'
    /** Host cancelled. Always whole, whatever the rate says. */
    | 'admin-initiated'
    /** Refundable rate, past the window: the one-day / half-day fee applies. */
    | 'late-cancellation'
    /** Non-refundable past its grace. Nothing comes back. */
    | 'non-refundable'
    /** The trip had already begun. */
    | 'after-trip-start'

export type RefundOutcome = {
    kind: 'full' | 'partial' | 'none'
    /** What actually returns to the card. */
    refundAmount: number
    /** The one-day / half-day fee retained. Zero unless `kind` is 'partial'. */
    cancellationFee: number
    /**
     * The refundable premium retained, itemised separately because it is
     * retained for a different reason than the fee: the guest bought these very
     * terms with it, and is now using them. Zero on the non-refundable rate,
     * which never paid one.
     */
    retainedPremium: number
    reason: RefundReason
    /**
     * True when there was no stored price_quote and the fee had to be derived
     * from the total. Legacy bookings only — surface it rather than presenting a
     * guess as the quoted figure.
     */
    estimated: boolean
}

export type RefundInput = {
    rate: BookingRate
    bookedAt: Date
    tripStart: Date
    tripEnd: Date
    /** The snapshot taken at booking. Null for rows predating price_quote. */
    quote: TripQuote | null
    /** Authoritative charged amount — the clamp ceiling, never exceeded. */
    totalPaid: number
    now?: Date
    byAdmin?: boolean
}

function roundMoney(amount: number): number {
    return Math.round(amount * 100) / 100
}

/**
 * When the guest's free cancellation window closes.
 *
 * Wraps freeCancellationDeadline rather than restating it, so the date the
 * checkout page promised (BookingRateSection) and the date enforced here cannot
 * drift. Three adjustments sit on top, and the third is the subtle one.
 *
 * ── Why non-refundable is capped by the refundable deadline ──────────────────
 *
 * The two rates measure their free window from opposite ends: non-refundable
 * runs 24h forward from BOOKING, refundable runs 24h back from TRIP START. Both
 * are faithful to Turo's published policy, which states them in different
 * sections and never reconciles them.
 *
 * They cross over. Whenever booking and trip start are less than ~48h apart, the
 * non-refundable grace outlives the refundable deadline, and the guest who paid
 * REFUNDABLE_SURCHARGE for flexibility gets less back than the one who didn't:
 *
 *     booked 30h ahead, cancelled 10h later
 *       non-refundable  paid $120.00 -> $120.00 back (100%)
 *       refundable      paid $132.00 ->  $60.00 back  (45%)
 *
 * That inverts the entire point of selling the two rates, and it isn't a rare
 * corner: it covers every same-day booking, which is exactly when someone is
 * most likely to change their mind.
 *
 * So the free window never extends past the point where a refundable booking of
 * the same trip would have lost its own. A non-refundable guest can lose the
 * window earlier than the flat "24 hours" suggests — which is why the checkout
 * copy says "for 24 hours, or until 24 hours before pickup, whichever comes
 * first" — but the ordering the pricing promises always holds.
 */
export function effectiveFreeCancellationDeadline(
    rate: BookingRate,
    { bookedAt, tripStart }: { bookedAt: Date; tripStart: Date },
): Date {
    const bookedWithinWindow =
        tripStart.getTime() - bookedAt.getTime() < LATE_BOOKING_WINDOW_HOURS * MS_PER_HOUR

    // A trip booked closer to its own start than the standard window buys a
    // short grace from the booking instead. Applies to both rates: it answers
    // "there is no 24-hour window left to give you", which is about the booking,
    // not about which rate was chosen.
    const base = bookedWithinWindow
        ? new Date(bookedAt.getTime() + LATE_BOOKING_GRACE_HOURS * MS_PER_HOUR)
        : freeCancellationDeadline(rate, { bookedAt, tripStart })

    const limits = [base.getTime(), tripStart.getTime()]

    if (rate === 'non-refundable') {
        // The cap described above. Compared against the refundable rule for this
        // same trip, so the two can never cross.
        limits.push(
            bookedWithinWindow
                ? base.getTime()
                : freeCancellationDeadline('refundable', { bookedAt, tripStart }).getTime(),
        )
    }

    // Nothing may land after the trip has started: a non-refundable trip booked
    // two hours before pickup would otherwise carry a grace period reaching a
    // day past its own start time.
    return new Date(Math.min(...limits))
}

/**
 * The billable-day count and the price the cancellation fee is a fraction of.
 *
 * `tripPrice` mirrors the identically-named value in calculateTripPrice — the
 * trip itself, after discounts and surcharge, before the refundable premium and
 * the delivery fee. Using the total instead would charge a fraction of the
 * delivery fee as part of the penalty, and a fraction of the premium the guest
 * bought precisely to have these terms.
 */
type FeeBasis = {
    tripPrice: number
    days: number
    /** Refunded in full — the deliberate divergence from Turo's half. */
    pickupFee: number
    /**
     * Refunded in full, for the same reason the delivery fee is: a prepaid tank,
     * a child seat and a cleaning are all services rendered *during* a trip, so
     * a trip that never happens bought none of them.
     */
    extras: number
    /** Retained. */
    premium: number
    estimated: boolean
}

function feeBasis(input: RefundInput): FeeBasis {
    const { quote } = input
    if (quote && quote.billableDays > 0) {
        return {
            tripPrice:
                quote.subtotal -
                quote.discountAmount -
                quote.extraDiscountAmount +
                quote.surchargeAmount,
            days: quote.billableDays,
            pickupFee: quote.pickupFee,
            // `?? 0` because a quote snapshotted before extras existed has no
            // such key. Belt and braces: storedQuote() normalises it too, but
            // this is the function that decides how much money goes back, so it
            // does not depend on a caller having narrowed correctly.
            extras: quote.extrasTotal ?? 0,
            premium: quote.refundableSurchargeAmount,
            estimated: false,
        }
    }

    // No snapshot: a booking made before price_quote existed. The total is all
    // there is, so the fee comes out of that and the outcome says so. Nothing
    // can be split back out, so the delivery fee and premium are folded in —
    // which favours the guest on the delivery fee and costs them nothing on the
    // premium, the right way round for a number we're admitting is a guess.
    const spanDays = Math.ceil((input.tripEnd.getTime() - input.tripStart.getTime()) / MS_PER_DAY)
    return {
        tripPrice: input.totalPaid,
        days: Math.max(1, spanDays),
        pickupFee: 0,
        extras: 0,
        premium: 0,
        estimated: true,
    }
}

/**
 * What this cancellation refunds, and why.
 *
 * The order of the checks is the order the rules override each other: a host
 * cancellation beats every rate rule, a trip that already started beats the free
 * window, and only then does the rate decide.
 */
export function refundForCancellation(input: RefundInput): RefundOutcome {
    const now = input.now ?? new Date()
    const ceiling = Math.max(0, input.totalPaid)

    const full = (reason: RefundReason): RefundOutcome => ({
        kind: 'full',
        refundAmount: roundMoney(ceiling),
        cancellationFee: 0,
        retainedPremium: 0,
        reason,
        estimated: false,
    })
    const none = (reason: RefundReason): RefundOutcome => ({
        kind: 'none',
        refundAmount: 0,
        cancellationFee: 0,
        retainedPremium: 0,
        reason,
        estimated: false,
    })

    // The host cancelling is not the guest failing to meet a deadline, so none
    // of the rate rules apply. Turo refunds these in full and so do we.
    if (input.byAdmin) return full('admin-initiated')

    // Once the trip is under way there is nothing left to cancel out of. This
    // sits above the window check because a long-booked refundable trip is still
    // inside no window by the time it starts.
    if (now.getTime() >= input.tripStart.getTime()) return none('after-trip-start')

    const deadline = effectiveFreeCancellationDeadline(input.rate, {
        bookedAt: input.bookedAt,
        tripStart: input.tripStart,
    })

    if (now.getTime() <= deadline.getTime()) {
        if (input.rate === 'non-refundable') return full('non-refundable-grace')
        const bookedWithinWindow =
            input.tripStart.getTime() - input.bookedAt.getTime() <
            LATE_BOOKING_WINDOW_HOURS * MS_PER_HOUR
        return full(bookedWithinWindow ? 'late-booking-grace' : 'within-free-window')
    }

    // Past the deadline. Non-refundable means exactly that — Turo's wording is
    // "no credits/refunds issued for non-refundable trips canceled after the
    // grace period", and it's what BookingRateInfoModal promised at checkout.
    if (input.rate === 'non-refundable') return none('non-refundable')

    const { tripPrice, days, pickupFee, extras, premium, estimated } = feeBasis(input)
    const dayRate = tripPrice / days
    const rawFee = days > SHORT_TRIP_DAYS ? dayRate : dayRate / 2

    // Clamped against the trip price, not the total: the fee is a fraction of
    // the trip, and letting it grow into the delivery fee or the extras would
    // quietly undo the decision to refund those in full.
    const cancellationFee = roundMoney(Math.min(Math.max(rawFee, 0), tripPrice))

    // The rule, stated directly: the trip price back minus the fee, plus the
    // delivery fee and the extras that bought nothing, keeping the premium.
    const rawRefund = tripPrice - cancellationFee + pickupFee + extras
    const refundAmount = roundMoney(Math.min(Math.max(rawRefund, 0), ceiling))
    const retainedPremium = roundMoney(Math.min(premium, Math.max(ceiling - refundAmount, 0)))

    // A fee that swallowed everything is a no-refund outcome however it arose;
    // saying 'partial' while returning $0 would read as a bug to anyone
    // reconciling the email against the Stripe dashboard.
    if (refundAmount <= 0) {
        return { ...none('late-cancellation'), cancellationFee, retainedPremium, estimated }
    }

    return {
        kind: 'partial',
        refundAmount,
        cancellationFee,
        retainedPremium,
        reason: 'late-cancellation',
        estimated,
    }
}

/** One line of guest-facing explanation. Shared by the dialog and both emails. */
export function refundExplanation(outcome: RefundOutcome): string {
    switch (outcome.reason) {
        case 'within-free-window':
        case 'late-booking-grace':
        case 'non-refundable-grace':
            return 'This cancellation is within the free cancellation window, so the full amount is refunded.'
        case 'admin-initiated':
            return 'Bluefin Rentals cancelled this trip, so the full amount is refunded.'
        case 'late-cancellation':
            return 'This cancellation is past the free cancellation window, so a cancellation fee is retained and the rest is refunded.'
        case 'non-refundable':
            return 'This trip was booked at the non-refundable rate and cancelled after the 24-hour grace period, so no amount is refunded.'
        case 'after-trip-start':
            return 'This trip had already started, so no amount is refunded.'
    }
}