// Timezone-safe date display — the single place that turns a stored instant
// into something a human reads.
//
// ── The two mistakes this module exists to prevent ────────────────────────────
//
// 1. `new Date('2026-08-20')` — a date-only string is parsed as UTC midnight,
//    so `.toLocaleDateString()` renders it as Aug 19 for anyone west of
//    Greenwich. Use formatDateKey for 'YYYY-MM-DD' values; it never builds an
//    instant out of a value that doesn't have one.
//
// 2. Reading a calendar day off a stored timestamp with `.getDate()`, or with
//    `.split('T')[0]`. Both answer "which day is this?" in the wrong zone —
//    the browser's and UTC's respectively. A 10pm Central return is 03:00Z the
//    NEXT day, so both give the day after the one on the reservation. Use
//    businessDateKey, which asks in the business's zone.
//
// Every booking timestamp in this app means a wall-clock time at the lot in
// Saint Paul: `start_time` was written by wallClockToUtcIso from a date key and
// an 'HH:mm' the customer picked off a dropdown. Rendering it in the viewer's
// zone re-interprets it as a time that was never agreed to — a customer in
// California would see their 10am pickup as 8am. So every formatter here pins
// the zone to BUSINESS_TIMEZONE rather than defaulting to the host's, and the
// output is identical in the browser, in SSR, and on a server running in UTC.

import { BUSINESS_TIMEZONE, dateKeyToLocalDate } from './pricing'

// Accepts either the ISO string Supabase hands back or an already-parsed Date,
// since callers have one or the other depending on whether they also needed to
// do instant math (isActive checks and the like).
export type Instant = string | Date

function toDate(value: Instant): Date {
    return value instanceof Date ? value : new Date(value)
}

// ── Deriving a calendar day from an instant ──────────────────────────────────

// The business-timezone calendar day of an instant, as 'YYYY-MM-DD'.
//
// This is the correct counterpart to wallClockToUtcIso: it round-trips a
// timestamp back to the date key the customer originally picked. 'en-CA' is
// used for the same reason todayInBusinessTz uses it — it formats as
// zero-padded YYYY-MM-DD, which is exactly the key format the rest of the app
// (price overrides, blocked dates, the admin calendar) is written in.
export function businessDateKey(value: Instant): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: BUSINESS_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(toDate(value))
}

// The business-timezone wall clock of an instant, as 'HH:mm'.
//
// Round-trips the time half of wallClockToUtcIso, so it's what to use when
// rebuilding the startTime/endTime search params of an existing booking.
// hourCycle 'h23' rather than hour12:false: the latter renders midnight as
// '24:00' in some engines, which is not a value any of the time dropdowns has.
export function businessWallClockTime(value: Instant): string {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: BUSINESS_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).format(toDate(value))
}

// That instant's business calendar day, as a Date at LOCAL midnight.
//
// For grouping, sorting and day-difference math against other local-midnight
// Dates (`new Date()` with the clock zeroed, which is how the admin calendar
// builds its column range). The Date is a positioning device, not an instant —
// don't format it directly, and don't send it anywhere. Format the key.
export function businessDayStart(value: Instant): Date {
    return dateKeyToLocalDate(businessDateKey(value)) ?? new Date(0)
}

// ── Formatting ───────────────────────────────────────────────────────────────

const DEFAULT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
}

const DEFAULT_TIME_FORMAT: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
}

// An instant's date, in business time.
export function formatBusinessDate(
    value: Instant,
    options: Intl.DateTimeFormatOptions = DEFAULT_DATE_FORMAT,
): string {
    return toDate(value).toLocaleDateString('en-US', {
        ...options,
        timeZone: BUSINESS_TIMEZONE,
    })
}

// An instant's time of day, in business time.
export function formatBusinessTime(
    value: Instant,
    options: Intl.DateTimeFormatOptions = DEFAULT_TIME_FORMAT,
): string {
    return toDate(value).toLocaleTimeString('en-US', {
        ...options,
        timeZone: BUSINESS_TIMEZONE,
    })
}

// Both halves, e.g. "Aug 20, 10:00 AM".
export function formatBusinessDateTime(
    value: Instant,
    dateOptions: Intl.DateTimeFormatOptions = DEFAULT_DATE_FORMAT,
    timeOptions: Intl.DateTimeFormatOptions = DEFAULT_TIME_FORMAT,
): string {
    return `${formatBusinessDate(value, dateOptions)}, ${formatBusinessTime(value, timeOptions)}`
}

// A 'YYYY-MM-DD' key, formatted for display.
//
// Deliberately NOT timezone-pinned, because a bare date key has no instant in
// it to convert — it's already the answer. It's rendered off local midnight so
// no zone conversion can move it, which is why this is safe to call with a URL
// search param or a blocked-date row and get the day that was actually stored.
// Anything with a time in it belongs in formatBusinessDate instead.
export function formatDateKey(
    dateKey: string | undefined | null,
    options: Intl.DateTimeFormatOptions = DEFAULT_DATE_FORMAT,
): string {
    const date = dateKeyToLocalDate(dateKey?.slice(0, 10))
    return date ? date.toLocaleDateString('en-US', options) : ''
}

// True when the instant falls on today's business date. Used for the "Today"
// heading on the admin trip lists, which was previously decided by comparing
// the viewer's calendar day against a UTC-derived one.
export function isBusinessToday(value: Instant, now: Date = new Date()): boolean {
    return businessDateKey(value) === businessDateKey(now)
}