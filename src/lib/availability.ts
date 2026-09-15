// Trip availability — pure "when is this car free" math.
//
// ── Why this is a window per day, not a set of dead days ─────────────────────
//
// This module used to answer one question — "is this calendar day touched by
// anything?" — and the booking widget greyed the day out if so. That made
// same-day handoff impossible: a trip returning at 10am killed the whole day,
// even though the car sits on the lot from 10am onward and the next renter
// could collect it at 1pm.
//
// So a day is no longer a boolean. It carries two minute-of-day marks:
//
//   earliestStart — the earliest a NEW trip may begin that day
//   latestEnd     — the latest a NEW trip may end that day
//
// A fully-occupied day is just the degenerate case where those cross over, and
// the fold in buildAvailabilityMap produces it without a special branch.
//
// ── The two rules this encodes ───────────────────────────────────────────────
//
// 1. TURNAROUND. Real trips (site bookings and Turo bookings alike) need
//    TURNAROUND_HOURS of clearance on both sides for cleaning and inspection.
//    The gap is symmetric on purpose: a gap between two trips is one gap, and
//    enforcing it in only one direction would let whoever books second return
//    the car minutes before the next renter arrives.
//
//    Admin blocks are NOT buffered. A block means "the car is spoken for these
//    days"; the day after it ends is bookable from opening, with no carry-over.
//
// 2. LEAD TIME. A trip may not start sooner than MIN_LEAD_TIME_HOURS from now.
//    That rule needs a clock rather than a calendar, so it lives in
//    earliestStartMinutesToday / earliestStartMinutesFor rather than in the map.
//
// Pure and isomorphic like src/lib/pricing.ts — no Supabase, no React — because
// the server enforces the same two rules in src/lib/db.ts and the constants must
// not be able to drift apart. src/lib/dates.ts is imported for the instant ->
// business-wall-clock conversion; it's pure for the same reason.

import { addDays, daysBetween, timeToMinutes, todayInBusinessTz } from './pricing.ts'
import { businessDateKey, businessWallClockTime } from './dates.ts'

// ── Constants ────────────────────────────────────────────────────────────────

// Clearance required between two trips, and between now and a trip's start.
// Separate constants because they answer different questions and could
// plausibly diverge, even though both are 3 today.
export const TURNAROUND_HOURS = 3
export const MIN_LEAD_TIME_HOURS = 3

export const BUSINESS_OPEN_MINUTES = 600 // 10:00 AM
export const BUSINESS_CLOSE_MINUTES = 1350 // 10:30 PM
export const SLOT_MINUTES = 30

const MINUTES_PER_DAY = 1440

// Sentinels for "occupied from before this day began" and "occupied past this
// day's end". Outside the 0..1440 range so they always lose/win the min/max in
// buildAvailabilityMap without needing a branch for interior days.
const OCCUPIED_FROM_DAY_START = -1
const OCCUPIED_PAST_DAY_END = MINUTES_PER_DAY + 1

// An inclusive span of local calendar days: both `from` and `to` are blocked.
// The shape TripCalendar wants for its disabled-day matchers.
export type DateSpan = { from: Date; to: Date }

// Nothing legitimate spans more than a couple of years. This only exists so a
// single corrupt row can't spin the expansion loop forever.
const MAX_SPAN_DAYS = 800

// ── Occupied spans ───────────────────────────────────────────────────────────

// One stretch of time the car isn't available, in business-timezone terms.
// `buffered` is what separates a real trip from an admin block — see rule 1.
export type OccupiedSpan = {
    startKey: string
    startMinutes: number
    endKey: string
    endMinutes: number
    buffered: boolean
}

// The rows getBookedDates returns. Tagged because the widget has to buffer
// bookings and Turo trips but not blocks, and an untagged list of
// {start_time, end_time} can't be told apart after the fact.
export type UnavailabilityRow =
    | { kind: 'booking' | 'turo'; start_time: string; end_time: string }
    | { kind: 'block'; start_date: string; end_date: string }

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

// Normalizes those rows into spans. Malformed rows are skipped rather than
// thrown on: one bad row shouldn't blank the calendar.
//
// Blocks are date-only in the database, so they're modelled as running from
// midnight on start_date to midnight on the day AFTER end_date — which is what
// makes end_date itself fully blocked and the following day fully open.
export function toOccupiedSpans(rows: readonly UnavailabilityRow[]): OccupiedSpan[] {
    const spans: OccupiedSpan[] = []

    for (const row of rows ?? []) {
        if (!row) continue

        if (row.kind === 'block') {
            if (!DATE_KEY.test(row.start_date ?? '') || !DATE_KEY.test(row.end_date ?? '')) continue
            spans.push({
                startKey: row.start_date,
                startMinutes: 0,
                endKey: addDays(row.end_date, 1),
                endMinutes: 0,
                buffered: false,
            })
            continue
        }

        const start = new Date(row.start_time)
        const end = new Date(row.end_time)
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue

        // businessDateKey/businessWallClockTime, not getDate()/getHours(): a
        // 10pm Central return is 03:00Z the next day, so reading the day or the
        // hour off the instant in the viewer's zone lands on the wrong one.
        spans.push({
            startKey: businessDateKey(start),
            startMinutes: timeToMinutes(businessWallClockTime(start)),
            endKey: businessDateKey(end),
            endMinutes: timeToMinutes(businessWallClockTime(end)),
            buffered: true,
        })
    }

    return spans
}

// ── The availability map ─────────────────────────────────────────────────────

export type DayWindow = {
    /** Earliest minute-of-day a new trip may begin. 0 = unrestricted. */
    earliestStart: number
    /** Latest minute-of-day a new trip may end. 1440 = unrestricted. */
    latestEnd: number
}

export type AvailabilityMap = Map<string, DayWindow>

const UNRESTRICTED: DayWindow = { earliestStart: 0, latestEnd: MINUTES_PER_DAY }

// A day absent from the map is untouched by anything, hence unrestricted.
export function dayWindow(map: AvailabilityMap, dateKey: string): DayWindow {
    return map.get(dateKey) ?? UNRESTRICTED
}

// True when nothing at all constrains this day, which is what an interior day of
// a trip has to be — the car is held for the full 24 hours.
function isFullyFree(window: DayWindow): boolean {
    return window.earliestStart <= 0 && window.latestEnd >= MINUTES_PER_DAY
}

// Folds every occupied span into a per-day window.
//
// For each day the span touches, the span occupies [occupiedFrom, occupiedUntil]
// once widened by the turnaround buffer. A new trip therefore has to end before
// the occupied stretch begins, or start after it ends:
//
//   latestEnd     = min(latestEnd,     occupiedFrom)
//   earliestStart = max(earliestStart, occupiedUntil)
//
// Interior days use the sentinels, which drives both marks out of the bookable
// range — the fully-dead day, with no branch of its own.
export function buildAvailabilityMap(spans: readonly OccupiedSpan[]): AvailabilityMap {
    const map: AvailabilityMap = new Map()

    for (const span of spans ?? []) {
        if (!span) continue

        const length = daysBetween(span.startKey, span.endKey)
        if (!Number.isFinite(length) || length < 0 || length > MAX_SPAN_DAYS) continue

        const buffer = span.buffered ? TURNAROUND_HOURS * 60 : 0

        for (let i = 0; i <= length; i++) {
            const key = addDays(span.startKey, i)

            const occupiedFrom =
                key === span.startKey ? span.startMinutes - buffer : OCCUPIED_FROM_DAY_START
            const occupiedUntil =
                key === span.endKey ? span.endMinutes + buffer : OCCUPIED_PAST_DAY_END

            // A span can end at minute 0 of its final day and so occupy none of
            // it. That's every admin block: they're date-only, so they run to
            // midnight on the day after end_date, and that day is free. Without
            // this the day after a block picked up the interior-day sentinel and
            // read as occupied — which is exactly the day a trip should be able
            // to start on, the moment the block is done.
            if (key === span.endKey && key !== span.startKey && occupiedUntil <= 0) continue

            const existing = map.get(key)
            const window = existing ?? { earliestStart: 0, latestEnd: MINUTES_PER_DAY }

            window.latestEnd = Math.min(window.latestEnd, occupiedFrom)
            window.earliestStart = Math.max(window.earliestStart, occupiedUntil)

            if (!existing) map.set(key, window)
        }
    }

    return map
}

// ── Lead time ────────────────────────────────────────────────────────────────

function roundUpToSlot(minutes: number): number {
    return Math.ceil(minutes / SLOT_MINUTES) * SLOT_MINUTES
}

// The earliest slot a trip could start today, or null once the lead time pushes
// past closing and today is spent.
//
// The current time is read in the business's zone rather than the viewer's, so a
// customer in California gets the lot's clock and the same answer the server
// will enforce.
export function earliestStartMinutesToday(now: Date = new Date()): number | null {
    const nowMinutes = timeToMinutes(businessWallClockTime(now))
    const earliest = Math.max(
        BUSINESS_OPEN_MINUTES,
        roundUpToSlot(nowMinutes + MIN_LEAD_TIME_HOURS * 60),
    )
    return earliest > BUSINESS_CLOSE_MINUTES ? null : earliest
}

// The earliest slot a trip may start on a given day, combining the lead time
// with whatever the map says. Null means the day can't host a start at all.
export function earliestStartMinutesFor(
    dateKey: string,
    map: AvailabilityMap,
    now: Date = new Date(),
): number | null {
    const todayKey = todayInBusinessTz(now)
    // Date keys are zero-padded YYYY-MM-DD, so string order is date order.
    if (dateKey < todayKey) return null

    const leadFloor =
        dateKey === todayKey ? earliestStartMinutesToday(now) : BUSINESS_OPEN_MINUTES
    if (leadFloor === null) return null

    const earliest = Math.max(dayWindow(map, dateKey).earliestStart, leadFloor)
    return earliest > BUSINESS_CLOSE_MINUTES ? null : earliest
}

// The latest slot a trip may end on a given day. Null means the day can't host
// an end at all. No lead-time component: an end is always in the future of a
// start that already passed the lead-time check.
export function latestEndMinutesFor(dateKey: string, map: AvailabilityMap): number | null {
    const latest = Math.min(dayWindow(map, dateKey).latestEnd, BUSINESS_CLOSE_MINUTES)
    return latest < BUSINESS_OPEN_MINUTES ? null : latest
}

// How many of the `days` days starting at `fromKey` could host the start of a
// new trip. Used to rank cars by near-term availability (the homepage's
// featured cars), and built on earliestStartMinutesFor so it applies exactly the
// turnaround and lead-time rules the calendar does.
export function startableDayCount(
    map: AvailabilityMap,
    fromKey: string,
    days: number,
    now: Date = new Date(),
): number {
    let count = 0
    for (let i = 0; i < days; i++) {
        if (earliestStartMinutesFor(addDays(fromKey, i), map, now) !== null) count++
    }
    return count
}

// ── Whole-trip validation ────────────────────────────────────────────────────

// Every calendar day a trip touches, start and end INCLUSIVE.
//
// Deliberately not quote.days from calculateTripPrice, which drops the final
// partial day because it isn't billed. The calendar disables the final day's
// cell if it's booked, so the check has to cover the same days the customer can
// actually see.
export function tripDateKeys(startKey: string, endKey: string): string[] {
    const length = daysBetween(startKey, endKey)
    if (!Number.isFinite(length) || length < 0 || length > MAX_SPAN_DAYS) return []
    return Array.from({ length: length + 1 }, (_, i) => addDays(startKey, i))
}

// Structured rather than a string so the widget owns the wording and this module
// stays free of display concerns.
export type TripConflict =
    | { kind: 'lead-time'; earliestStart: number | null }
    | { kind: 'start-too-early'; dateKey: string; earliestStart: number }
    | { kind: 'end-too-late'; dateKey: string; latestEnd: number }
    | { kind: 'days-unavailable'; dateKeys: string[] }

// The first thing wrong with this trip, or null if it's bookable.
//
// One conflict at a time, most-actionable first: a start that's merely too early
// is fixed by nudging a dropdown, while a range straddling a booked block needs
// different dates entirely — so the interior-day check comes last.
export function findTripConflict(
    startKey: string,
    startTime: string,
    endKey: string,
    endTime: string,
    map: AvailabilityMap,
    now: Date = new Date(),
): TripConflict | null {
    const startMinutes = timeToMinutes(startTime)
    const endMinutes = timeToMinutes(endTime)
    const todayKey = todayInBusinessTz(now)

    // Lead time is checked against the raw clock rather than against
    // earliestStartMinutesFor's combined floor, so a same-day trip that's too
    // soon says so instead of blaming another booking.
    if (startKey < todayKey) {
        return { kind: 'lead-time', earliestStart: earliestStartMinutesToday(now) }
    }
    if (startKey === todayKey) {
        const leadFloor = earliestStartMinutesToday(now)
        if (leadFloor === null || startMinutes < leadFloor) {
            return { kind: 'lead-time', earliestStart: leadFloor }
        }
    }

    const earliestStart = dayWindow(map, startKey).earliestStart
    if (startMinutes < earliestStart) {
        return earliestStart > BUSINESS_CLOSE_MINUTES
            ? { kind: 'days-unavailable', dateKeys: [startKey] }
            : { kind: 'start-too-early', dateKey: startKey, earliestStart }
    }

    const latestEnd = dayWindow(map, endKey).latestEnd
    if (endMinutes > latestEnd) {
        return latestEnd < BUSINESS_OPEN_MINUTES
            ? { kind: 'days-unavailable', dateKeys: [endKey] }
            : { kind: 'end-too-late', dateKey: endKey, latestEnd }
    }

    // Interior days are held for the full 24 hours, so any restriction at all
    // rules them out. Both endpoints are excluded — they were just checked
    // against the customer's actual times, which is the looser, correct test.
    const interior = tripDateKeys(startKey, endKey)
        .slice(1, -1)
        .filter(key => !isFullyFree(dayWindow(map, key)))

    return interior.length > 0 ? { kind: 'days-unavailable', dateKeys: interior } : null
}