// Extending a trip: when it's automatic, when it's a request, and what it costs.
//
// Pure and isomorphic like pricing.ts, for the same reason: the trip page shows
// the guest a price before they confirm, and requestExtension re-derives it on
// the server without trusting anything the browser sent. Two implementations
// would eventually disagree, and that bug is a guest shown one price and
// charged another.
//
// The policy, written for review: ImportantFiles/extensions.md.

import {
    addDays,
    findDiscountTier,
    getTripDurationMinutes,
    LONG_DURATION_DISCOUNT,
    roundMoney,
    type PriceOverrides,
    type QuoteDay,
} from './pricing.ts'
import { DEFAULT_BOOKING_RATE, REFUNDABLE_SURCHARGE, type BookingRate } from './booking-rate.ts'
import { EXTRAS, resolveExtras, type QuoteExtra } from './extras.ts'

// ── When an extension needs a person ─────────────────────────────────────────
//
// Decided by the owners on 2026-09-25: an extension is automatic as long as
// every added minute is free, except inside the last hour of the trip, where it
// becomes a request an owner approves. That close to a return, the owners may
// already be planning around the car coming back, and an automatic answer
// could strand the next thing they'd arranged.
export const EXTENSION_REQUEST_CUTOFF_MINUTES = 60

export type ExtensionMode =
    /** Charged and applied on the spot. */
    | 'instant'
    /** Card held; an owner approves or declines. */
    | 'request'
    /** The trip has ended — that's a late return, not an extension. */
    | 'closed'

export function extensionMode(currentEnd: Date, now: Date = new Date()): ExtensionMode {
    const minutesLeft = (currentEnd.getTime() - now.getTime()) / 60_000
    if (minutesLeft <= 0) return 'closed'
    return minutesLeft <= EXTENSION_REQUEST_CUTOFF_MINUTES ? 'request' : 'instant'
}

// ── The price ────────────────────────────────────────────────────────────────
//
// Decided by the owners on 2026-09-25: an extension pays for the billable days
// it ADDS, at current prices for those dates, discounted at the tier for the
// NEW total trip length.
//
// Billable days are the same ceil(duration / 24h) rule calculateTripPrice uses,
// counted from the trip's start. So the added days are simply
//     ceil(start -> new end) - ceil(start -> current end)
// and they're the dates at those indices from the start date, exactly the dates
// calculateTripPrice would have billed had the trip been booked this long.
//
// Consequences worth knowing (all stated in extensions.md):
//   - Adding time inside a day that's already been rounded up adds no billable
//     day, and costs nothing. [Proposed, awaiting review.]
//   - Crossing into a bigger discount tier discounts only the added days. The
//     days already paid for keep the price on their receipt — a receipt is never
//     rewritten.
//   - The trip's own booking rate applies: a refundable trip's extension carries
//     the refundable premium, because it's refundable on the same terms.
//     [Proposed, awaiting review.]
//   - Per-day extras on the trip (unlimited mileage) extend with it. Per-trip
//     extras and the pickup or delivery fee are not charged again. No same-day surcharge:
//     that's a premium on booking at short notice, and this isn't a booking.
//     [Proposed, awaiting review.]

export type ExtensionQuote = {
    /** Billable days already paid for. */
    fromBillableDays: number
    /** Billable days once extended. */
    toBillableDays: number
    /** The added days, dated and priced. Empty for a $0 extension. */
    days: QuoteDay[]
    subtotal: number
    discountPercent: number
    discountLabel: string | null
    discountAmount: number
    extraDiscountPercent: number
    extraDiscountLabel: string | null
    extraDiscountAmount: number
    bookingRate: BookingRate
    refundableSurchargeAmount: number
    refundableSurchargeLabel: string | null
    extras: QuoteExtra[]
    extrasTotal: number
    /** Pre-tax. Tax is added by the caller from src/lib/tax.ts. */
    total: number
}

export type ExtensionQuoteInput = {
    /** The trip's start, as business-timezone wall clock ('YYYY-MM-DD', 'H:mm'). */
    startDate: string
    startTime: string
    currentEndDate: string
    currentEndTime: string
    newEndDate: string
    newEndTime: string
    basePricePerDay: number
    overrides?: PriceOverrides
    bookingRate?: BookingRate
    /** Every extra currently on the trip; only the per-day ones are extended. */
    tripExtraIds?: string[]
}

export function billableDaysBetween(
    startDate: string,
    startTime: string,
    endDate: string,
    endTime: string,
): number {
    const minutes = getTripDurationMinutes(startDate, startTime, endDate, endTime)
    return Number.isFinite(minutes) && minutes > 0 ? Math.ceil(minutes / (24 * 60)) : 0
}

export function calculateExtensionPrice(input: ExtensionQuoteInput): ExtensionQuote {
    const {
        startDate,
        startTime,
        overrides = {},
        bookingRate = DEFAULT_BOOKING_RATE,
        tripExtraIds = [],
    } = input

    const fromBillableDays = billableDaysBetween(startDate, startTime, input.currentEndDate, input.currentEndTime)
    const toBillableDays = billableDaysBetween(startDate, startTime, input.newEndDate, input.newEndTime)
    const added = Math.max(0, toBillableDays - fromBillableDays)

    const days: QuoteDay[] = []
    let subtotal = 0
    for (let i = fromBillableDays; i < fromBillableDays + added; i++) {
        const date = addDays(startDate, i)
        const override = overrides[date]
        const price = roundMoney(override ?? input.basePricePerDay)
        days.push({ date, price, isOverride: override !== undefined })
        subtotal += price
    }
    subtotal = roundMoney(subtotal)

    // The tier for the whole trip's new length, applied to the added days only.
    const tier = added > 0 ? findDiscountTier(toBillableDays) : null
    const discountPercent = tier?.percent ?? 0
    const discountAmount = roundMoney(subtotal * discountPercent)

    // Compounds on top, exactly as in calculateTripPrice.
    const qualifiesForLongTrip = added > 0 && toBillableDays >= LONG_DURATION_DISCOUNT.minDays
    const extraDiscountPercent = qualifiesForLongTrip ? LONG_DURATION_DISCOUNT.percent : 0
    const extraDiscountAmount = roundMoney((subtotal - discountAmount) * extraDiscountPercent)

    const tripPrice = subtotal - discountAmount - extraDiscountAmount

    const refundableSurchargeAmount = bookingRate === 'refundable'
        ? roundMoney(tripPrice * REFUNDABLE_SURCHARGE.percent)
        : 0

    // Only per-day extras grow with the trip. resolveExtras canonicalises and
    // drops unknown ids, and gives a per-day extra `added` units.
    const perDayIds = tripExtraIds.filter(id =>
        EXTRAS.some(extra => extra.id === id && extra.billing === 'per-day'))
    const { items: extras, total: extrasTotal } = resolveExtras(perDayIds, added)

    return {
        fromBillableDays,
        toBillableDays,
        days,
        subtotal,
        discountPercent,
        discountLabel: tier?.label ?? null,
        discountAmount,
        extraDiscountPercent,
        extraDiscountLabel: qualifiesForLongTrip ? LONG_DURATION_DISCOUNT.label : null,
        extraDiscountAmount,
        bookingRate,
        refundableSurchargeAmount,
        refundableSurchargeLabel: refundableSurchargeAmount > 0 ? REFUNDABLE_SURCHARGE.label : null,
        extras,
        extrasTotal,
        total: roundMoney(tripPrice + refundableSurchargeAmount + extrasTotal),
    }
}