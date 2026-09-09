// Mileage allowance and the per-mile overage rate — what a trip includes, and
// what driving past it costs.
//
// Pure and isomorphic for the same reason src/lib/pricing.ts and
// src/lib/pickup.ts are: no React, no Supabase, no Node/browser globals. The
// car page, the checkout summary and the admin reservation page all derive
// these numbers here, so the allowance a customer is shown while booking is the
// allowance the host is shown when the car comes back.
//
// ── Why this isn't part of TripQuote ─────────────────────────────────────────
// The allowance is not a charge. calculateTripPrice sums a total out of
// already-rounded money lines and that total is what bookings.total_price and
// the Stripe PaymentIntent are created for — nothing in this file may move it.
// So this module *consumes* a TripQuote rather than living inside one. The
// overage is settled after the trip, against a real odometer reading, and is a
// separate transaction that doesn't exist yet.

import type { TripQuote } from './pricing.ts'
import type { Car } from '@/types.ts'

// ── Config ───────────────────────────────────────────────────────────────────

// Fleet-wide, not per-car: every vehicle includes the same distance per day and
// only the overage *rate* varies by car. 
export const MILES_INCLUDED_PER_DAY = 200

// Used if a car's `distance_fee` is null 
export const DEFAULT_DISTANCE_FEE = 0.35

// ── Money ────────────────────────────────────────────────────────────────────

// Same rule as pricing.ts: round as the value is produced, so what's printed is
// what's owed. Duplicated rather than exported from there because it's four
// characters of arithmetic and importing it would couple two modules that
// otherwise share only a type.
function roundMoney(amount: number): number {
    return Math.round(amount * 100) / 100
}

// ── The rate ─────────────────────────────────────────────────────────────────

// The stored ceiling: what a 2-day trip costs per extra mile, which is the most
// this car's rate can ever be. "from $0.34/mi"
//
// Number() because Postgres `numeric` reaches us as either a number or a string
// depending on how PostgREST serializes it — the same hazard buildOverrideMap
// guards against in pricing.ts. A string would make the multiplication in
// distanceFeeForTrip concatenate instead of multiply.
export function maxDistanceFee(car: Pick<Car, 'distance_fee'>): number {
    const fee = Number(car.distance_fee)
    return Number.isFinite(fee) && fee > 0 ? fee : DEFAULT_DISTANCE_FEE
}

// The rate for one specific trip, which falls as the trip gets longer.
//
// ── Where this curve comes from ──────────────────────────────────────────────
// The Turo listing this replaces quoted a rate that declined with trip length —
// for the Corolla: 0.34, 0.30, 0.29, 0.28, 0.28, flat for a long stretch, then
// back up to 0.29 for one single length before settling to 0.28 and eventually
// 0.27. That one-cent bump upward is the informative part: no function of
// day-count alone is non-monotonic. It's the signature of a rate derived from
// the trip's *average daily price* — the rate slides down as duration discounts
// accumulate, but when the range grows to swallow one expensive calendar day
// that day pulls the average back up and the rate follows it.
//
// So that's what this computes. The ratio is measured against the car's base
// day rate, which makes the stored `distance_fee` exactly right for the case it
// was recorded from: a 2-day trip takes no discount tier and, absent overrides,
// averages precisely basePricePerDay, so the ratio is 1 and the fee is the
// stored value untouched.
//
// Consequence worth knowing: there is only one duration curve in this codebase.
// Add a tier to DISCOUNT_TIERS in pricing.ts and the mileage rate follows it
// for free — which also means it steps at 3/7/14/21 days rather than sliding
// every single day the way Turo's did. Deliberate: it lands in the same place
// at both ends, and a second hand-tuned curve would be one more thing to keep
// in step with the first.
export function distanceFeeForTrip(
    car: Pick<Car, 'distance_fee'>,
    quote: TripQuote,
    basePricePerDay: number,
): number {
    const maxFee = maxDistanceFee(car)

    // No trip to measure — an empty quote (no dates yet) or a car with a
    // nonsense base rate. Show the ceiling rather than NaN or a free $0.00.
    if (quote.billableDays <= 0 || !Number.isFinite(basePricePerDay) || basePricePerDay <= 0) {
        return maxFee
    }

    // Discounts only. The same-day surcharge and the pickup/delivery fee are
    // both deliberately excluded
    const discounted = quote.subtotal - quote.discountAmount - quote.extraDiscountAmount
    const avgDailyPrice = discounted / quote.billableDays

    // Capped, never scaled past the ceiling: price overrides can push a trip's
    // average *above* the base rate, and the stored value is documented as the
    // most this car's rate will ever be.
    return Math.min(maxFee, roundMoney(maxFee * (avgDailyPrice / basePricePerDay)))
}

// ── The allowance ────────────────────────────────────────────────────────────

// Always fed quote.billableDays, never a locally recomputed day count. That's
// the number the trip is actually billed on — partial days round up, so a
// 2.5-day trip bills 3 days and therefore includes 600 miles, not 500.
export function milesIncluded(billableDays: number): number {
    return Math.max(0, billableDays) * MILES_INCLUDED_PER_DAY
}

export type Overage = {
    milesOver: number
    amount: number
}

const NO_OVERAGE: Overage = { milesOver: 0, amount: 0 }

// What the guest owes for driving past the allowance. Both fields are 0 when
// they didn't, which is what lets call sites gate the whole row on
// `milesOver > 0` rather than rendering a "0 miles over · $0.00 due" line.
export function calculateOverage(
    milesDriven: number,
    included: number,
    feePerMile: number,
): Overage {
    if (!Number.isFinite(milesDriven) || !Number.isFinite(included)) return NO_OVERAGE

    const milesOver = Math.max(0, Math.round(milesDriven - included))
    if (milesOver === 0) return NO_OVERAGE

    return { milesOver, amount: roundMoney(milesOver * feePerMile) }
}

// ── Display ──────────────────────────────────────────────────────────────────

// "2,800". Pinned locale rather than the host's, so a long trip's allowance
// renders identically on the server and in the browser and doesn't flip
// separators during hydration.
export function formatMiles(miles: number): string {
    return Math.round(miles).toLocaleString('en-US')
}