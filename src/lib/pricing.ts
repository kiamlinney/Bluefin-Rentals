// Trip pricing — the single source of truth for what a booking costs.
//
// This module is deliberately pure and isomorphic: no Supabase, no React, no
// Node/browser globals. Both the booking widget (src/routes/fleet/$carId.tsx)
// and the server (createCheckoutSession in src/lib/db.ts) import
// calculateTripPrice, so the price the customer is quoted and the price Stripe
// charges are computed by the same code and cannot drift apart.
//
// ── Why everything is a string ────────────────────────────────────────────────
// All day math here runs on 'YYYY-MM-DD' strings plus minutes-since-midnight,
// never on a raw Date whose calendar day depends on the host timezone. The
// server may run in UTC while the customer and the business are in Central; if
// we derived a day key from `new Date(iso).toLocaleDateString()` on the server,
// a 10pm pickup would resolve to the *next* day there and charge the wrong
// price override. String math has no such failure mode.

import {
    DEFAULT_BOOKING_RATE,
    REFUNDABLE_SURCHARGE,
    type BookingRate,
} from './booking-rate.ts'

export const BUSINESS_TIMEZONE = 'America/Chicago'

// ── Config ───────────────────────────────────────────────────────────────────

export type DiscountTier = {
    minDays: number
    percent: number
    label: string
}

// Longest qualifying tier wins — keep this sorted descending by minDays, since
// findDiscountTier returns the first match. Exactly one tier ever applies.
// To add another band later, add one line here; nothing else needs to change.
export const DISCOUNT_TIERS: DiscountTier[] = [
    { minDays: 21, percent: 0.20, label: '3-week discount' },
    { minDays: 14, percent: 0.15, label: '2-week discount' },
    { minDays: 7,  percent: 0.10, label: 'Weekly discount' },
    { minDays: 3,  percent: 0.05, label: '3-day discount' },

]

// Stacks on top of the tier above rather than replacing it, and is taken off
// the already-discounted price — so a month-long trip is 20% off, then a
// further 5% off that, for an effective 24%.
export const LONG_DURATION_DISCOUNT = {
    minDays: 30,
    percent: 0.05,
    label: 'Long trip discount',
}

// Applied when the trip starts on today's date (in the business's timezone).
export const SAME_DAY_SURCHARGE = { percent: 0.05, label: 'Same-day booking' }

// Note on the pickup fee, which is the fourth adjustment this module applies:
// unlike the three above it isn't configured here. It arrives as a plain number
// on TripQuoteInput because *what* it costs is a property of the location the
// customer chose, and that table lives in src/lib/pickup.ts. This module only
// knows where in the arithmetic it belongs — see calculateTripPrice.

// ── Date helpers ─────────────────────────────────────────────────────────────

// Today's date key in the business's timezone. Returns the same answer whether
// it's called in the browser or on a server running in UTC, which is what makes
// the same-day surcharge decidable on both sides.
export function todayInBusinessTz(now: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: BUSINESS_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now)
}

// A Date's local calendar day as 'YYYY-MM-DD'. Matches the key convention the
// admin calendar already writes with (CalendarGrid.tsx, SelectionPanel.tsx), so
// override lookups line up with the rows those screens create.
export function toDateKey(date: Date): string {
    return date.toLocaleDateString('en-CA')
}

// The inverse of toDateKey: 'YYYY-MM-DD' -> that calendar day at LOCAL
// midnight. Never `new Date(dateKey)` — that parses as UTC midnight and lands
// on the previous day for anyone west of Greenwich (see PriceBreakdown.tsx).
// Unlike the rest of this module this is UI-only: on the server "local" is
// whatever the host is set to, so use it for what the customer is looking at,
// not for anything billed.
export function dateKeyToLocalDate(dateKey: string | undefined | null): Date | null {
    if (!dateKey) return null
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
    if (!match) return null
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    return Number.isNaN(date.getTime()) ? null : date
}

// 'YYYY-MM-DD' -> epoch ms at UTC midnight. Anchoring to UTC (rather than
// local) means adding 86400000 always lands on the next calendar day, with no
// DST-shortened-day surprises.
function dateKeyToUtcMs(dateKey: string): number {
    const [year, month, day] = dateKey.split('-').map(Number)
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

function utcMsToDateKey(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10)
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

// 'YYYY-MM-DD' plus n days.
export function addDays(dateKey: string, n: number): string {
    return utcMsToDateKey(dateKeyToUtcMs(dateKey) + n * MS_PER_DAY)
}

// Whole calendar days from one date key to another (negative if b precedes a).
export function daysBetween(a: string, b: string): number {
    return Math.round((dateKeyToUtcMs(b) - dateKeyToUtcMs(a)) / MS_PER_DAY)
}

// 'H:mm' -> minutes since midnight. Same lenient parsing as the time dropdown
// in $carId.tsx, which emits values like '9:30' and '14:00'.
export function timeToMinutes(time: string): number {
    const parts = time.split(':')
    return Number(parts[0] ?? 0) * 60 + Number(parts[1] ?? 0)
}

// How long a trip lasts, in minutes, computed entirely from calendar days plus
// wall-clock times so it never depends on the host timezone. Used both for
// billing and for the booking widget's 24-hour minimum, so the two agree.
export function getTripDurationMinutes(
    startDate: string,
    startTime: string,
    endDate: string,
    endTime: string,
): number {
    if (!startDate || !endDate) return 0
    return (
        daysBetween(startDate, endDate) * 24 * 60 +
        (timeToMinutes(endTime) - timeToMinutes(startTime))
    )
}

// ── Wall-clock -> instant ────────────────────────────────────────────────────

// The UTC offset of a timezone at a given instant, in milliseconds. Derived by
// formatting the instant in that zone and reading the result back as if it were
// UTC — the gap between the two is the offset.
function timeZoneOffsetMs(instant: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(instant)

    const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)

    // hour formats as 24 rather than 0 for midnight in some environments.
    const hour = get('hour') % 24

    const asIfUtc = Date.UTC(
        get('year'), get('month') - 1, get('day'),
        hour, get('minute'), get('second'),
    )
    return asIfUtc - instant.getTime()
}

// Turns a wall-clock date + time into the UTC instant it refers to *in the
// business's timezone*, as an ISO string.
//
// This is what a pickup time actually means: "10:00" is 10am at the lot in
// Saint Paul, not 10am wherever the customer happens to be browsing from. Using
// the browser's own offset would book a Californian's 10am pickup as noon
// Central.
export function wallClockToUtcIso(
    dateKey: string,
    time: string,
    timeZone: string = BUSINESS_TIMEZONE,
): string {
    const [year, month, day] = dateKey.split('-').map(Number)
    const minutes = timeToMinutes(time)

    const naiveUtc = Date.UTC(
        year ?? 1970, (month ?? 1) - 1, day ?? 1,
        Math.floor(minutes / 60), minutes % 60,
    )
    if (!Number.isFinite(naiveUtc)) throw new Error(`Invalid date/time: ${dateKey} ${time}`)

    // Subtracting the offset at the guessed instant lands on the right moment
    // everywhere except within an hour of a DST transition, where the offset
    // there differs from the offset here — so re-read it once and correct.
    const firstGuess = naiveUtc - timeZoneOffsetMs(new Date(naiveUtc), timeZone)
    const corrected = naiveUtc - timeZoneOffsetMs(new Date(firstGuess), timeZone)

    return new Date(corrected).toISOString()
}

// ── Money ────────────────────────────────────────────────────────────────────

// Every money value is rounded to cents as it's produced, and the total is
// summed from the already-rounded lines. That guarantees the rows a customer
// reads in the breakdown add up to the total they're charged.
function roundMoney(amount: number): number {
    return Math.round(amount * 100) / 100
}

// ── Quote ────────────────────────────────────────────────────────────────────

// 'YYYY-MM-DD' -> price for that day.
export type PriceOverrides = Record<string, number>

export type QuoteDay = {
    date: string
    price: number
    isOverride: boolean
}

export type TripQuote = {
    days: QuoteDay[]
    billableDays: number
    subtotal: number
    // The duration tier — at most one of DISCOUNT_TIERS, off the subtotal.
    discountPercent: number
    discountLabel: string | null
    discountAmount: number
    // LONG_DURATION_DISCOUNT — stacks on top, off the already-discounted price.
    extraDiscountPercent: number
    extraDiscountLabel: string | null
    extraDiscountAmount: number
    surchargePercent: number
    surchargeLabel: string | null
    surchargeAmount: number
    // Which cancellation terms the trip was priced under, and what the flexible
    // option cost. Zero (and null) for the non-refundable anchor rate.
    bookingRate: BookingRate
    refundableSurchargeAmount: number
    refundableSurchargeLabel: string | null
    // A flat amount for delivering the car, added last and never discounted.
    pickupFee: number
    pickupFeeLabel: string | null
    total: number
}

export type TripQuoteInput = {
    startDate: string   // 'YYYY-MM-DD', the customer's local calendar day
    startTime: string   // 'H:mm'
    endDate: string
    endTime: string
    basePricePerDay: number
    overrides?: PriceOverrides
    today?: string      // defaults to today in the business's timezone
    // Comes from resolvePickup() in src/lib/pickup.ts. Optional so every existing
    // caller — and every future one quoting a plain home-base pickup — keeps
    // working untouched, defaulting to the free case.
    pickupFee?: number
    pickupFeeLabel?: string | null
    // Optional for the same reason pickupFee is: every existing caller — and
    // any request still in flight across a deploy — keeps working untouched and
    // gets the anchor rate, which is what the site charged before the choice
    // existed. Never silently upgrades anyone to the pricier option.
    bookingRate?: BookingRate
}

const EMPTY_QUOTE: TripQuote = {
    days: [],
    billableDays: 0,
    subtotal: 0,
    discountPercent: 0,
    discountLabel: null,
    discountAmount: 0,
    extraDiscountPercent: 0,
    extraDiscountLabel: null,
    extraDiscountAmount: 0,
    surchargePercent: 0,
    surchargeLabel: null,
    surchargeAmount: 0,
    // Same reasoning as pickupFee below — no trip, so nothing to make flexible.
    bookingRate: DEFAULT_BOOKING_RATE,
    refundableSurchargeAmount: 0,
    refundableSurchargeLabel: null,
    // Zero rather than the caller's pickupFee on purpose: EMPTY_QUOTE is returned
    // when there's no trip yet (no dates, or a non-positive duration), and a
    // $120 delivery line under a $0 total would be a price for nothing.
    pickupFee: 0,
    pickupFeeLabel: null,
    total: 0,
}

// Returns the longest-duration tier the trip qualifies for, or null.
export function findDiscountTier(billableDays: number): DiscountTier | null {
    return DISCOUNT_TIERS.find(tier => billableDays >= tier.minDays) ?? null
}

// Converts the rows returned by getCarPriceOverrides into a lookup map.
// Prices come back from Postgres as `numeric`, which PostgREST may serialize as
// either a number or a string — Number() normalizes both.
export function buildOverrideMap(
    rows: { date: string; price: number | string }[]
): PriceOverrides {
    const map: PriceOverrides = {}
    for (const row of rows) {
        const price = Number(row.price)
        if (Number.isFinite(price)) map[row.date] = price
    }
    return map
}

export function calculateTripPrice(input: TripQuoteInput): TripQuote {
    const {
        startDate,
        startTime,
        endDate,
        endTime,
        basePricePerDay,
        overrides = {},
        today = todayInBusinessTz(),
        pickupFee: rawPickupFee = 0,
        pickupFeeLabel = null,
        bookingRate = DEFAULT_BOOKING_RATE,
    } = input

    if (!startDate || !endDate) return EMPTY_QUOTE

    const durationMinutes = getTripDurationMinutes(startDate, startTime, endDate, endTime)
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return EMPTY_QUOTE

    // Partial days round up, preserving the existing rule that a 2.5-day trip
    // bills 3 days. The billed dates are then that many consecutive calendar
    // days starting at the pickup date: Aug 3 10:00 -> Aug 5 22:00 bills
    // Aug 3, Aug 4, Aug 5.
    const billableDays = Math.ceil(durationMinutes / (24 * 60))

    const days: QuoteDay[] = []
    let subtotal = 0
    for (let i = 0; i < billableDays; i++) {
        const date = addDays(startDate, i)
        const override = overrides[date]
        const price = roundMoney(override ?? basePricePerDay)
        days.push({ date, price, isOverride: override !== undefined })
        subtotal += price
    }
    subtotal = roundMoney(subtotal)

    // The duration tier comes off the subtotal.
    const tier = findDiscountTier(billableDays)
    const discountPercent = tier?.percent ?? 0
    const discountAmount = roundMoney(subtotal * discountPercent)

    // The long-trip discount then comes off what's left, so the two compound:
    // 30 days is 20% off, then 5% off that. Deliberately different from the
    // tier above, which is always a straight percentage of the subtotal.
    const qualifiesForLongTrip = billableDays >= LONG_DURATION_DISCOUNT.minDays
    const extraDiscountPercent = qualifiesForLongTrip ? LONG_DURATION_DISCOUNT.percent : 0
    const extraDiscountAmount = roundMoney((subtotal - discountAmount) * extraDiscountPercent)

    // The surcharge stays a percentage of the undiscounted subtotal — it's a
    // premium on the rate, not something the discounts should shrink.
    const isSameDay = startDate === today
    const surchargePercent = isSameDay ? SAME_DAY_SURCHARGE.percent : 0
    const surchargeAmount = roundMoney(subtotal * surchargePercent)

    // The pickup fee is the one adjustment that touches neither the subtotal nor
    // any percentage — it's a flat service charge bolted on at the very end.
    //
    // This is a sibling rule to the surcharge above, and the two are deliberately
    // different for the same underlying reason: what a percentage should be a
    // percentage *of*. The surcharge is a premium on the rate, so it scales with
    // the rate but is measured against the undiscounted subtotal. Delivery isn't
    // part of the rate at all — driving the car across town costs the host the
    // same effort whether the trip that follows is one day or twenty-one. Folding
    // it into the subtotal would hand a 21-day renter a 20% discount on the
    // driving, which is a discount on a cost that never shrank.
    //
    // Rounded here for the same reason every other line is: the total below is
    // summed from already-rounded parts, so the rows in the price breakdown add
    // up to the number on the card.
    const pickupFee = roundMoney(rawPickupFee)

    // What the trip itself costs, before the flat delivery charge. This is the
    // base the refundable premium is a percentage *of*.
    const tripPrice = subtotal - discountAmount - extraDiscountAmount + surchargeAmount
    
    // Excluded from that base, deliberately: the pickup fee
    const isRefundable = bookingRate === 'refundable'
    const refundableSurchargeAmount = isRefundable
        ? roundMoney(tripPrice * REFUNDABLE_SURCHARGE.percent)
        : 0

    return {
        days,
        billableDays,
        subtotal,
        discountPercent,
        discountLabel: tier?.label ?? null,
        discountAmount,
        extraDiscountPercent,
        extraDiscountLabel: qualifiesForLongTrip ? LONG_DURATION_DISCOUNT.label : null,
        extraDiscountAmount,
        surchargePercent,
        surchargeLabel: isSameDay ? SAME_DAY_SURCHARGE.label : null,
        surchargeAmount,
        bookingRate,
        refundableSurchargeAmount,
        // Labelled only when there's something to charge, so the breakdown can
        // gate its row on the amount — same convention as pickupFeeLabel.
        refundableSurchargeLabel: refundableSurchargeAmount > 0
            ? REFUNDABLE_SURCHARGE.label
            : null,
        pickupFee,
        // Only labelled when there's actually something to charge, so the
        // breakdown can gate its row on the amount and never render a $0 line.
        pickupFeeLabel: pickupFee > 0 ? pickupFeeLabel : null,
        total: roundMoney(tripPrice + refundableSurchargeAmount + pickupFee),
    }
}

// ── Display ──────────────────────────────────────────────────────────────────

// Consecutive days that cost the same, collapsed into one row.
//
// A 21-day trip is 21 identical lines in a breakdown, which is a wall of
// "$56.00" that buries the one day that isn't. Collapsing runs puts the
// exception in front of the reader: a uniform trip is a single range, and a day
// with its own price is a row of its own because it can't merge with either
// neighbour.
export type QuoteDayGroup = {
    /** First and last day of the run. Equal when the run is a single day. */
    start: string
    end: string
    days: number
    /** The per-day price every day in this run shares. */
    price: number
    /** price × days. */
    subtotal: number
    /** True only when every day in the run came from a price override, so a
     *  merged run can't be badged "special rate" on the strength of one day. */
    isOverride: boolean
}

// Grouped on price alone, not on (price, isOverride). An override set to the
// same number as the base rate is not a different price to the person paying
// it, and splitting the run there would print three rows showing one figure —
// the noise this function exists to remove.
//
// Adjacency is re-checked with addDays rather than assumed from array order.
// calculateTripPrice does build `days` as consecutive calendar days, but this
// also takes quotes read back out of bookings.price_quote, which are whatever
// was written months ago — a gap there should end a run, not silently print one
// range across it.
export function groupQuoteDays(days: QuoteDay[]): QuoteDayGroup[] {
    const groups: QuoteDayGroup[] = []

    for (const day of days) {
        const current = groups[groups.length - 1]
        const continues =
            current !== undefined &&
            current.price === day.price &&
            addDays(current.end, 1) === day.date

        if (continues) {
            current.end = day.date
            current.days += 1
            current.subtotal = roundMoney(current.price * current.days)
            current.isOverride = current.isOverride && day.isOverride
            continue
        }

        groups.push({
            start: day.date,
            end: day.date,
            days: 1,
            price: day.price,
            subtotal: day.price,
            isOverride: day.isOverride,
        })
    }

    return groups
}
