// Trip receipt — what a booking actually cost
//
// Pure and isomorphic like pricing.ts / distance.ts / cancellation-policy.ts:
// no React, no Supabase, no Node/browser globals. It takes a stored booking and
// hands back everything the receipt document prints.
//
// ── Read the snapshot, never recompute it ────────────────────────────────────
// bookings.price_quote is the TripQuote the guest was charged against, frozen at
// checkout. Its migration says so outright (20260828234500_bookings_price_quote):
// "Never recompute or backfill — refunds and receipts are derived from it."
//
// That rule has teeth. Re-running calculateTripPrice here would price the trip
// against *today's* per-day overrides and today's base rate, so an admin editing
// a September price in the calendar would silently rewrite a receipt for a trip
// that was booked, paid for and driven in August. The receipt would then show
// rows that no longer sum to bookings.total_price — the one number a receipt
// exists to explain. So a booking with no snapshot gets no itemisation, not a
// reconstructed one.

import type { TripQuote } from './pricing.ts'
import { getTripDurationMinutes } from './pricing.ts'
import { businessDateKey, businessWallClockTime } from './dates.ts'
import { distanceFeeForTrip, maxDistanceFee, milesIncluded } from './distance.ts'
import type { Car } from '@/types.ts'


export type ReceiptBooking = {
    start_time: string
    end_time: string
    total_price: number | string
    refunded_amount: number | string | null
    price_quote: unknown
}

export type BookingReceipt = {
    /** The snapshot the guest was charged against. Null on rows predating the column. */
    quote: TripQuote | null
    billableDays: number
    milesIncluded: number
    perMileFee: number
    /** bookings.total_price — what the PaymentIntent was created for. */
    totalCharged: number
    /** bookings.refunded_amount, 0 when nothing was sent back. */
    refundedAmount: number
    /** What the guest is out of pocket once a refund is accounted for. */
    netCharged: number
}

// Same rule as pricing.ts and distance.ts: round as the value is produced, so
// what's printed is what's owed.
function roundMoney(amount: number): number {
    return Math.round(amount * 100) / 100
}

// Postgres `numeric` reaches us as either a number or a string depending on how
// PostgREST serializes it — the same hazard buildOverrideMap and maxDistanceFee
// guard against. A string would make the subtraction below concatenate.
function toMoney(value: number | string | null | undefined): number {
    const amount = Number(value)
    return Number.isFinite(amount) ? roundMoney(amount) : 0
}

/**
 * Narrows the `price_quote` jsonb column to a TripQuote.
 *
 * The column is typed `Json | null` and is null for every booking made before
 * it existed, so this returns null rather than throwing — a legacy row still
 * has a receipt, it just has one line on it. The `billableDays` check is a
 * shape guard, not a validation: rows are written by createCheckoutSession from
 * a real quote, so the only realistic failure is the column being absent.
 */
export function storedQuote(booking: Pick<ReceiptBooking, 'price_quote'>): TripQuote | null {
    const quote = booking.price_quote as (TripQuote & { version?: number }) | null
    if (!quote || typeof quote !== 'object') return null
    return typeof quote.billableDays === 'number' ? quote : null
}

/**
 * How many days the trip bills.
 *
 * Off the snapshot when there is one. Otherwise from the stored timestamps —
 * which is safe where recomputing a *price* isn't, because this is calendar
 * arithmetic with no money in it: the same ceil(duration / 24h) rule
 * calculateTripPrice applies, so a legacy row still gets the right distance
 * allowance.
 *
 * The timestamps are UTC instants and getTripDurationMinutes wants wall-clock
 * strings, hence businessDateKey/businessWallClockTime — the same pair the
 * admin reservation page and buildCheckoutSearch use. Slicing the ISO string
 * would take the UTC day, which is the next day for a late-evening Central
 * return and would bill an extra 200 miles.
 */
function billableDaysFor(booking: ReceiptBooking, quote: TripQuote | null): number {
    if (quote) return quote.billableDays

    const start = new Date(booking.start_time)
    const end = new Date(booking.end_time)
    const minutes = getTripDurationMinutes(
        businessDateKey(start),
        businessWallClockTime(start),
        businessDateKey(end),
        businessWallClockTime(end),
    )
    return Number.isFinite(minutes) && minutes > 0 ? Math.ceil(minutes / (24 * 60)) : 0
}

export function buildReceipt(booking: ReceiptBooking, car: Car): BookingReceipt {
    const quote = storedQuote(booking)
    const billableDays = billableDaysFor(booking, quote)

    // With a snapshot the rate is the one this trip's own pricing implies. With
    // none there's nothing to take a ratio against, so the car's ceiling stands
    // — the documented "most this car's rate will ever be", and the same value
    // distanceFeeForTrip itself falls back to for an empty quote.
    const perMileFee = quote
        ? distanceFeeForTrip(car, quote, Number(car.price_per_day))
        : maxDistanceFee(car)

    const totalCharged = toMoney(booking.total_price)
    const refundedAmount = toMoney(booking.refunded_amount)

    return {
        quote,
        billableDays,
        milesIncluded: milesIncluded(billableDays),
        perMileFee,
        totalCharged,
        refundedAmount,
        // Clamped at zero: a refund can't exceed the charge, and a negative
        // "net charged" on a receipt would read as the business owing money.
        netCharged: Math.max(0, roundMoney(totalCharged - refundedAmount)),
    }
}