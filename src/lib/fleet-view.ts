// How the admin pages search, sort and describe the fleet: the calendar's
// toolbar and the Vehicles pages both go through here, so "booked days" or
// "on a trip" can't mean one thing on one page and another on the next.
//
// Pure and isomorphic like pricing.ts: no React, no Supabase.

import { businessDateKey } from './dates.ts'
import { addDays } from './pricing.ts'

/** The car columns these helpers read. */
export type FleetCar = {
    id: number
    make: string
    model: string
    year: number
    trim?: string | null
    license_plate: string | null
    is_available: boolean | null
}

/** Any trip that holds a car: a Bluefin booking or a Turo trip. */
export type TripSpan = { start_time: string; end_time: string }

const DAY_MS = 24 * 60 * 60 * 1000

// ── Listing status ───────────────────────────────────────────────────────────

export const LISTING_STATUSES = { listed: 'Listed', unlisted: 'Unlisted' } as const
export type ListingStatus = keyof typeof LISTING_STATUSES

/** `null` (never set) counts as listed, as everywhere else that reads `is_available`. */
export function listingStatusOf(car: Pick<FleetCar, 'is_available'>): ListingStatus {
    return car.is_available === false ? 'unlisted' : 'listed'
}

/** Nothing chosen means no filter. */
export function passesListingFilter(car: Pick<FleetCar, 'is_available'>, statuses: readonly ListingStatus[]): boolean {
    return statuses.length === 0 || statuses.includes(listingStatusOf(car))
}

// ── Search ───────────────────────────────────────────────────────────────────

const compact = (s: string) => s.toLowerCase().replace(/[\s-]+/g, '')

/**
 * Every word of the query has to appear in the car's make, model, year, trim or
 * plate. Spaces and dashes are ignored as well, so "cr v" finds a CR-V and
 * "abc 123" finds plate ABC123.
 */
export function matchesCarSearch(car: FleetCar, query: string): boolean {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) return true
    const haystack = [car.make, car.model, String(car.year), car.trim ?? '', car.license_plate ?? '']
        .join(' ')
        .toLowerCase()
    const squashed = compact(haystack)
    return words.every(w => haystack.includes(w) || squashed.includes(compact(w)))
}

// ── Sorting ──────────────────────────────────────────────────────────────────

export const BOOKED_DAYS_WINDOW = 30

export const CAR_SORTS = {
    'name-asc': { label: 'Make/model/year (A–Z)' },
    'name-desc': { label: 'Make/model/year (Z–A)' },
    'plate-asc': { label: 'License plate (A–Z)' },
    'plate-desc': { label: 'License plate (Z–A)' },
    'price-desc': { label: 'Today’s price (High to low)' },
    'price-asc': { label: 'Today’s price (Low to high)' },
    'booked-desc': { label: 'Booked days (Most to least)', hint: `Based on next ${BOOKED_DAYS_WINDOW} days` },
    'booked-asc': { label: 'Booked days (Least to most)', hint: `Based on next ${BOOKED_DAYS_WINDOW} days` },
} as const satisfies Record<string, { label: string; hint?: string }>
export type CarSort = keyof typeof CAR_SORTS
export const DEFAULT_CAR_SORT: CarSort = 'name-asc'

export function isCarSort(value: unknown): value is CarSort {
    return typeof value === 'string' && value in CAR_SORTS
}

/** Make, then model, then year: the order the fleet is named in everywhere. */
export function compareCarNames(a: FleetCar, b: FleetCar): number {
    return (
        a.make.localeCompare(b.make, 'en', { sensitivity: 'base' }) ||
        a.model.localeCompare(b.model, 'en', { sensitivity: 'base' }) ||
        a.year - b.year
    )
}

export type SortContext = {
    /** Today's daily price for the car. */
    todaysPrice: (car: FleetCar) => number
    /** Booked days in the next BOOKED_DAYS_WINDOW days. */
    bookedDays: (car: FleetCar) => number
}

/**
 * A sorted copy. Ties fall back to the name, then the id, so the order never
 * shuffles between renders. Cars with no plate sort last in both directions.
 */
export function sortCars<T extends FleetCar>(cars: readonly T[], sort: CarSort, ctx: SortContext): T[] {
    const byName = (a: T, b: T) => compareCarNames(a, b) || a.id - b.id
    const primary = (a: T, b: T): number => {
        switch (sort) {
            case 'name-asc': return 0
            case 'name-desc': return -compareCarNames(a, b)
            case 'plate-asc':
            case 'plate-desc': {
                const [pa, pb] = [a.license_plate?.trim() || null, b.license_plate?.trim() || null]
                if (pa === null || pb === null) return pa === pb ? 0 : pa === null ? 1 : -1
                const c = pa.localeCompare(pb, 'en', { sensitivity: 'base', numeric: true })
                return sort === 'plate-asc' ? c : -c
            }
            case 'price-desc': return ctx.todaysPrice(b) - ctx.todaysPrice(a)
            case 'price-asc': return ctx.todaysPrice(a) - ctx.todaysPrice(b)
            case 'booked-desc': return ctx.bookedDays(b) - ctx.bookedDays(a)
            case 'booked-asc': return ctx.bookedDays(a) - ctx.bookedDays(b)
        }
    }
    return [...cars].sort((a, b) => primary(a, b) || byName(a, b))
}

// ── Booked days ──────────────────────────────────────────────────────────────

/**
 * The dates a trip is billed for, by the same rule as calculateTripPrice: a
 * partial day rounds up, counted from the pickup date. Fri 10am → Sun 10am is
 * Fri and Sat. Fri 10am → Sun 8pm is Fri, Sat and Sun.
 */
export function billedDateKeys(trip: TripSpan): string[] {
    const ms = new Date(trip.end_time).getTime() - new Date(trip.start_time).getTime()
    if (!Number.isFinite(ms) || ms <= 0) return []
    const start = businessDateKey(trip.start_time)
    return Array.from({ length: Math.ceil(ms / DAY_MS) }, (_, i) => addDays(start, i))
}

/**
 * How many of the `days` dates starting `today` some trip holds. Overlapping
 * trips (a Bluefin booking and a Turo trip on the same dates) count once.
 */
export function bookedDaysAhead(trips: readonly TripSpan[], today: string, days = BOOKED_DAYS_WINDOW): number {
    const last = addDays(today, days - 1)
    const booked = new Set<string>()
    for (const trip of trips) {
        for (const key of billedDateKeys(trip)) {
            if (key >= today && key <= last) booked.add(key)
        }
    }
    return booked.size
}

// ── What a car is doing ──────────────────────────────────────────────────────

export type VehicleTripStatus<T extends TripSpan = TripSpan> =
    | { kind: 'on-trip'; trip: T }
    | { kind: 'next'; trip: T }
    | { kind: 'last'; trip: T }
    | { kind: 'none' }

/**
 * The one line a vehicle card shows: on a trip now, else the next trip, else
 * the last one. Pass only trips that really hold the car (confirmed or
 * completed Bluefin trips, Turo trips), not cancelled ones.
 */
export function vehicleTripStatus<T extends TripSpan>(trips: readonly T[], now: Date = new Date()): VehicleTripStatus<T> {
    const t = now.getTime()
    const start = (trip: T) => new Date(trip.start_time).getTime()
    const end = (trip: T) => new Date(trip.end_time).getTime()

    const current = trips.filter(trip => start(trip) <= t && t < end(trip)).sort((a, b) => start(a) - start(b))[0]
    if (current) return { kind: 'on-trip', trip: current }

    const next = trips.filter(trip => start(trip) > t).sort((a, b) => start(a) - start(b))[0]
    if (next) return { kind: 'next', trip: next }

    const last = trips.filter(trip => end(trip) <= t).sort((a, b) => end(b) - end(a))[0]
    if (last) return { kind: 'last', trip: last }

    return { kind: 'none' }
}

// ── How many trips a car has done ────────────────────────────────────────────

export type TripCount = {
    total: number
    /** The Turo count an owner entered (cars.turo_trip_count), null until they do. */
    turoBaseline: number | null
    turoBaselineAt: string | null
    /** Turo trips the email sync saw end after the baseline was entered. */
    turoSince: number
    /** Completed Bluefin trips, all of them: Turo's own count never includes these. */
    bluefin: number
}

/**
 * Lifetime trips across Turo and Bluefin. An owner enters each car's Turo count
 * once, from the listing, with the moment they did (cars.turo_trip_count and
 * turo_trip_count_at). From then on every Turo trip that ends after that
 * moment is added from turo_bookings, and every completed Bluefin trip is
 * added. A Turo trip that had already ended was in the number entered, so it
 * isn't counted again, and one still under way then is counted when it ends.
 * Cancelled Turo trips are deleted from turo_bookings, so they never count.
 *
 * Until the Turo count is entered, it's Bluefin trips only: adding the Turo
 * trips we happen to have synced would give a number that's neither.
 */
export function tripCount(input: {
    turoBaseline: number | null | undefined
    turoBaselineAt: string | null | undefined
    turoTrips: readonly TripSpan[]
    bluefinCompleted: number
    now?: Date
}): TripCount {
    const now = (input.now ?? new Date()).getTime()
    const at = input.turoBaselineAt ? new Date(input.turoBaselineAt).getTime() : NaN
    const hasBaseline = input.turoBaseline !== null && input.turoBaseline !== undefined && Number.isFinite(at)
    if (!hasBaseline) {
        return { total: input.bluefinCompleted, turoBaseline: null, turoBaselineAt: null, turoSince: 0, bluefin: input.bluefinCompleted }
    }
    const turoSince = input.turoTrips.filter(t => {
        const end = new Date(t.end_time).getTime()
        return end > at && end <= now
    }).length
    const baseline = Number(input.turoBaseline)
    return {
        total: baseline + turoSince + input.bluefinCompleted,
        turoBaseline: baseline,
        turoBaselineAt: input.turoBaselineAt!,
        turoSince,
        bluefin: input.bluefinCompleted,
    }
}

export const VEHICLE_TRIP_STATUS_LABEL: Record<VehicleTripStatus['kind'], string> = {
    'on-trip': 'On a trip',
    next: 'Next trip',
    last: 'Last trip',
    none: 'No trips yet',
}

// ── Editing a car ────────────────────────────────────────────────────────────

// Typo guards, not prices: an extra zero, or a fee typed in cents. The owners
// set the actual figures.
export const MAX_PRICE_PER_DAY = 5000
export const MAX_DISTANCE_FEE = 5
export const MAX_LOCKBOX_CODE = 32

/** The base daily price: whole dollars, above zero. */
export function validatePricePerDay(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
    const n = Number(value)
    if (value === '' || value === null || value === undefined || !Number.isFinite(n)) return { ok: false, error: 'Enter a daily price.' }
    if (!Number.isInteger(n)) return { ok: false, error: 'The daily price is in whole dollars.' }
    if (n < 1) return { ok: false, error: 'The daily price has to be at least $1.' }
    if (n > MAX_PRICE_PER_DAY) return { ok: false, error: `That’s over $${MAX_PRICE_PER_DAY} a day. Check for an extra zero.` }
    return { ok: true, value: n }
}

/**
 * The most per extra mile (what a 2-day trip pays). Above zero: a stored 0
 * would not mean free miles, because maxDistanceFee treats anything that
 * isn't positive as "unset" and charges DEFAULT_DISTANCE_FEE instead.
 */
export function validateDistanceFee(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
    const n = Number(value)
    if (value === '' || value === null || value === undefined || !Number.isFinite(n)) return { ok: false, error: 'Enter a per-mile fee.' }
    if (n <= 0) return { ok: false, error: 'The per-mile fee has to be more than $0.' }
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { ok: false, error: 'The per-mile fee is in whole cents, like 0.35.' }
    if (n > MAX_DISTANCE_FEE) return { ok: false, error: `That’s over $${MAX_DISTANCE_FEE} a mile. Did you mean ${(n / 100).toFixed(2)}?` }
    return { ok: true, value: Math.round(n * 100) / 100 }
}

/** Trimmed; empty means "no code". */
export function normalizeLockboxCode(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
    const code = String(value ?? '').trim()
    if (!code) return { ok: true, value: null }
    if (code.length > MAX_LOCKBOX_CODE) return { ok: false, error: `Keep the code under ${MAX_LOCKBOX_CODE} characters.` }
    return { ok: true, value: code }
}

/** What the change log calls each field. */
export const CHANGE_FIELD_LABEL: Record<string, string> = {
    is_available: 'Listing',
    price_per_day: 'Daily price',
    distance_fee: 'Per-mile fee',
    lockbox_code: 'Lockbox code',
    'pricing.busy_multiplier': 'Busy multiplier',
    'pricing.slow_multiplier': 'Slow multiplier',
    'pricing.weekend_multiplier': 'Weekend multiplier',
    'pricing.weekend_days': 'Weekend days',
    'pricing.period': 'Busy/slow period',
}

/**
 * NHTSA's recall lookup for one vehicle: open safety recalls not yet repaired
 * on that exact car. Federal law generally bars renting out a car with one.
 */
export function recallLookupUrl(vin: string): string {
    return `https://www.nhtsa.gov/recalls?vin=${encodeURIComponent(vin)}`
}
