// What a Turo email means, and what it says. Pure, so the rules can be tested
// against real email text without Gmail; runTuroSync (turo-sync.server.ts) does
// the fetching and the writing.
//
// Every Turo email carries a Notification-Name header naming its template.
// That header, not the subject or the body, decides what the sync does with the
// email. Before 2026-10-12 the rule was "anything with trip dates is a booking",
// which stored a Turo-initiated cancellation as a new trip (its body has dates
// too) and applied a renter's change request before we had answered it.

import { wallClockToUtcIso } from './pricing'

export type TuroEmailKind =
    /** Says when the trip is and which car. Stored; the newest one wins. */
    | 'trip'
    /** A renter asking to change the dates. Not a change until we confirm it. */
    | 'request'
    /** The trip is off. */
    | 'cancel'
    /** The renter accepted our vehicle swap. Names the trip, not the new car. */
    | 'swap'
    /** About a trip, but changes nothing we store. */
    | 'ignore'
    /** Not recognised: reported, never stored. */
    | 'unknown'

const TRIP_NOTIFICATIONS = new Set([
    // "X's trip with your Y is booked!"
    'ReservationBookedOwner',
    // "X has changed their trip with your Y (id)": a change Turo approved itself.
    'AutoApprovedTripChangeHost',
    // "You've confirmed X's change request with your Y": the final dates.
    'ApprovedChangeRequestBookedOwner',
])

const CANCEL_NOTIFICATIONS = new Set([
    // "X has canceled their trip with your Y"
    'CancelledReservationOwner',
    // "Turo has canceled X's trip with your Y"
    'TuroCancelledReservationOwner',
    'TuroAdminCancelReservationHost',
])

export function turoEmailKind(notificationName: string | null, subject: string): TuroEmailKind {
    const name = notificationName ?? ''
    if (TRIP_NOTIFICATIONS.has(name)) return 'trip'
    if (name === 'RenterChangedRequestOwner') return 'request'
    if (name === 'VehicleSwapAccepted') return 'swap'
    // A cancellation template we haven't seen yet is still a cancellation.
    // Keeping a cancelled trip on the calendar only loses a booking; treating it
    // as a booking is what used to happen, and is worse.
    if (CANCEL_NOTIFICATIONS.has(name) || /cancel/i.test(name)) return 'cancel'
    // "X has an upcoming trip with your Y" repeats the booking email; "X has
    // added another driver" has no dates.
    if (name.startsWith('ReservationReminder') || name === 'AddDriverToTripOwner') return 'ignore'
    // If Turo ever renames the booking template, a new booking still lands.
    // Losing new bookings silently is the failure this whole sync exists to
    // prevent, and this subject has only ever meant one thing.
    if (/[’']s trip with your .+ is booked!?$/i.test(subject)) return 'trip'
    return 'unknown'
}

// Every subject the sync acts on. "trip with your" covers bookings, changes,
// requests and cancellations; the other two are subjects that don't contain it:
// "You've confirmed X's change request with your Y" and "X accepted your
// vehicle swap request". The confirmation going unfetched is how a declined
// request used to stay on the calendar.
export function turoGmailQuery(lookbackDays: number): string {
    return (
        'from:@turo.com ' +
        '(subject:"trip with your" OR subject:"change request" OR subject:"vehicle swap request") ' +
        `newer_than:${lookbackDays}d`
    )
}

// ── Parsing ──────────────────────────────────────────────────────────────────

// Turo prints times in the host's local timezone, i.e. business time.
// wallClockToUtcIso names the zone rather than inheriting the server's, which
// is UTC in production: inheriting it once stored every synced trip 5-6 hours
// early.
function toIso(month: string, day: string, year2: string, hour: string, min: string, ampm: string): string {
    let h = parseInt(hour)
    if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12
    if (ampm.toLowerCase() === 'am' && h === 12) h = 0
    const dateKey = `${2000 + parseInt(year2)}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    return wallClockToUtcIso(dateKey, `${String(h).padStart(2, '0')}:${min}`)
}

const TIME = String.raw`(\d{1,2})\/(\d{1,2})\/(\d{2})\s+(\d{1,2}):(\d{2})\s*(am|pm)`

/**
 * "Trip start: 8/23/26 9:30 am" / "Trip end: 8/26/26 9:00 pm", as UTC ISO.
 * On a change request these are the requested times: the old ones follow on
 * a line of their own, without the label.
 */
export function parseTripTimes(body: string): { startTime: string; endTime: string } | null {
    const start = body.match(new RegExp(`Trip start:\\s*${TIME}`, 'i'))
    const end = body.match(new RegExp(`Trip end:\\s*${TIME}`, 'i'))
    if (!start || !end) return null
    const at = (m: RegExpMatchArray) => toIso(m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!)
    return { startTime: at(start), endTime: at(end) }
}

/** The "Toyota Prius 2014" line: make, model, then a four-digit year. */
export function parseCarLine(body: string): string {
    return body.match(/^\s*((?:[\w-]+\s+)+\d{4})\s*$/m)?.[1]?.trim() ?? ''
}

export type MatchableCar = { id: number; make: string; model: string; year: number; is_available: boolean | null }

/**
 * Year, make AND model. The email names no trim or plate, so identical cars
 * can't be told apart: active cars win over retired ones (a retired car can't
 * be on a new Turo trip), and anything still ambiguous is an error rather than
 * a guess. Year + make alone once put trips for the active Jeep on a retired
 * one, leaving the active Jeep bookable while it was out.
 */
export function matchCar<C extends MatchableCar>(
    cars: C[],
    carLine: string,
): { car: C } | { error: string } {
    const year = Number(carLine.match(/(\d{4})/)?.[1] ?? 0)
    const namePart = carLine.replace(/\d{4}/, '').trim().toLowerCase()
    const candidates = cars.filter(car =>
        car.year === year &&
        namePart.includes(car.make.toLowerCase()) &&
        namePart.includes(car.model.toLowerCase()),
    )
    const active = candidates.filter(car => car.is_available !== false)
    const pool = active.length > 0 ? active : candidates
    if (pool.length === 1) return { car: pool[0]! }
    return {
        error: pool.length === 0
            ? `could not match car "${carLine}"`
            : `"${carLine}" matches more than one car (ids ${pool.map(c => c.id).join(', ')}), not stored`,
    }
}

const RENTER_IN_SUBJECT = [
    /^(.+?)[’']s trip with your/,                       // "Zachary's trip with your Y is booked!"
    /^(.+?) has changed their trip with your/,          // AutoApprovedTripChangeHost
    /^(.+?) has requested a change to their trip/,      // RenterChangedRequestOwner
    /^You[’']ve confirmed (.+?)[’']s change request/,   // ApprovedChangeRequestBookedOwner
]

export function parseRenterName(subject: string): string | null {
    for (const pattern of RENTER_IN_SUBJECT) {
        const name = subject.match(pattern)?.[1]?.trim()
        if (name) return name
    }
    return null
}

/**
 * The Reservation-ID header, else the body: "Reservation ID #12345" on trip
 * emails, "the vehicle swap for their trip 12345" on a swap acceptance.
 */
export function parseReservationId(header: string | null, body: string | null): string | null {
    return header || body?.match(/Reservation ID #(\d+)/)?.[1] || body?.match(/for their trip (\d+)/)?.[1] || null
}

/**
 * What a change request does to a stored trip: block both the current and the
 * requested times, never fewer. If we decline, the extra time stays blocked
 * until the trip ends, which costs a booking at most. Narrowing to the request
 * instead (shortening it, say) would free time the renter may still have the
 * car for, and that is a double booking.
 */
export function widenForRequest(
    current: { start_time: string; end_time: string },
    requested: { startTime: string; endTime: string },
): { start_time: string; end_time: string } {
    const earlier = (a: string, b: string) => (new Date(a) <= new Date(b) ? a : b)
    const later = (a: string, b: string) => (new Date(a) >= new Date(b) ? a : b)
    return {
        start_time: earlier(current.start_time, requested.startTime),
        end_time: later(current.end_time, requested.endTime),
    }
}
