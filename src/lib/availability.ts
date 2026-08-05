// Trip availability — pure day-level "is this range bookable" math.
//
// This module is deliberately day-granular, matching what the calendar renders:
// a day is unavailable if any booking, admin block, or Turo trip touches that
// calendar day at all. That makes it *stricter* than the server's instant-level
// overlap check (assertCarIsAvailable in src/lib/db.ts), and that asymmetry is
// the point — the booking widget must never let a customer reach checkout on a
// range the calendar already greys out. Before this existed, a start before a
// booked block and an end after it sailed past Continue and only failed at the
// Stripe payment step, after driver info and identity verification.
//
// Pure and isomorphic like src/lib/pricing.ts — no Supabase, no React — so the
// server can adopt it later as a cheap pre-check.

import { addDays, daysBetween, toDateKey } from './pricing.ts'

// An inclusive span of local calendar days: both `from` and `to` are blocked.
// Matches the shape the booking widget builds from getBookedDates.
export type DateSpan = { from: Date; to: Date }

// Nothing legitimate spans more than a couple of years. This only exists so a
// single corrupt row can't spin the expansion loop forever.
const MAX_SPAN_DAYS = 800

// Expands inclusive spans into the set of 'YYYY-MM-DD' keys they cover.
// Malformed or absurd spans are skipped rather than throwing: an unbookable
// calendar is a better failure than a blank page.
export function spansToDateKeys(spans: DateSpan[]): Set<string> {
    const keys = new Set<string>()

    for (const span of spans) {
        if (!span?.from || !span?.to) continue

        const from = toDateKey(span.from)
        const length = daysBetween(from, toDateKey(span.to))
        if (!Number.isFinite(length) || length < 0 || length > MAX_SPAN_DAYS) continue

        for (let i = 0; i <= length; i++) keys.add(addDays(from, i))
    }

    return keys
}

// Every calendar day a trip touches, start and end INCLUSIVE.
//
// Deliberately not quote.days from calculateTripPrice, which drops the final
// partial day because it isn't billed. The calendar disables the final day's
// cell if it's booked, so the check has to cover the same days the customer
// can actually see.
export function tripDateKeys(startKey: string, endKey: string): string[] {
    const length = daysBetween(startKey, endKey)
    if (!Number.isFinite(length) || length < 0 || length > MAX_SPAN_DAYS) return []
    return Array.from({ length: length + 1 }, (_, i) => addDays(startKey, i))
}

// The blocked days the trip would cover, in chronological order. An empty
// result means the range is bookable.
export function findUnavailableDays(
    startKey: string,
    endKey: string,
    blocked: Set<string>,
): string[] {
    return tripDateKeys(startKey, endKey).filter(key => blocked.has(key))
}

export function isRangeAvailable(
    startKey: string,
    endKey: string,
    blocked: Set<string>,
): boolean {
    return findUnavailableDays(startKey, endKey, blocked).length === 0
}
