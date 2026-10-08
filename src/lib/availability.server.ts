// The server's authority on whether a car is free — moved out of db.ts so trip
// extensions (src/lib/payments.ts) enforce exactly the same rule checkout does.
//
// Server-only for the same reason as access.server.ts: it's a plain exported
// function using the service-role client, and db.ts is imported by browser pages.
//
// ── The pending-hold rule ────────────────────────────────────────
// Three places must agree on what "held" means: assertCarIsAvailable here (the
// enforcement point), loadUnavailabilityRows in db.ts (what the calendar and the
// homepage grey out), and expire_stale_pending_bookings (housekeeping). An
// extension that's being paid for, or waiting on an owner, holds its added time
// the same way — extensionHoldRows below is read by the first two.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getServiceRoleClient } from './access.server'
import { TURNAROUND_HOURS } from './availability'
import { businessDateKey, formatBusinessDateTime } from './dates'

const MS_PER_HOUR = 60 * 60 * 1000

// The hold length lives in the pure availability.ts, so the terms page can state
// it. Re-exported here for the server code that has always imported it from here.
import { PENDING_HOLD_MS } from './availability'
export { PENDING_HOLD_MS }

/**
 * The added time of every extension that currently holds a car:
 * - `requested` — the card is held and an owner hasn't answered yet, and
 * - `pending`   — being paid for right now, while still inside PENDING_HOLD_MS.
 *
 * Returned in the same start/end shape as a booking, because that's what it is
 * to everyone else: the car is spoken for over that range.
 */
export async function extensionHoldRows(
    supabaseAdmin: SupabaseClient<any, any, any>,
    carId: number,
    options: { windowStart?: string; windowEnd?: string; excludeBookingId?: string } = {},
): Promise<{ start_time: string; end_time: string }[]> {
    const holdCutoff = new Date(Date.now() - PENDING_HOLD_MS).toISOString()

    let query = supabaseAdmin
        .from('booking_extensions')
        .select('from_end_time, to_end_time, booking_id, bookings!inner(car_id)')
        .eq('bookings.car_id', carId)
        .or(`status.eq.requested,and(status.eq.pending,created_at.gte.${holdCutoff})`)
    if (options.windowEnd) query = query.lt('from_end_time', options.windowEnd)
    if (options.windowStart) query = query.gt('to_end_time', options.windowStart)
    if (options.excludeBookingId) query = query.neq('booking_id', options.excludeBookingId)

    const { data, error } = await query
    if (error) throw new Error(error.message)

    return (data ?? []).map((row: any) => ({
        start_time: row.from_end_time as string,
        end_time: row.to_end_time as string,
    }))
}

// Authoritative server-side conflict check for a car/date-range, checked before
// a new booking is created or a trip is extended. Uses the service-role client
// because a regular customer's RLS-scoped client can't see other users'
// bookings, or car_blocked_dates/turo_bookings at all (those are admin-only).
//
// Trips need TURNAROUND_HOURS of clearance on both sides for cleaning and
// inspection, so the overlap windows are widened by that buffer rather than
// being a bare intersection test. Widening the *query* rather than filtering
// afterwards keeps the work in Postgres.
//
// `excludeBookingId` is for the resume-payment paths in createCheckoutSession —
// re-validating an existing pending booking would otherwise find that booking
// itself and refuse to let the customer pay for it — and for extensions, where
// the trip being extended is obviously not a conflict with itself (nor are its
// own extensions).
//
// `viewerId` widens that same idea from one row to one customer. A pending row
// is a soft hold on an unfinished checkout, and holding a car against the very
// person trying to book it is never useful: change the dates by an hour and the
// abandoned row refuses the new range, with the turnaround buffer making it
// refuse three hours either side too. The dedup query in createCheckoutSession
// only rescues the case where the range matches exactly. Other customers' holds
// still block, and `confirmed` still blocks unconditionally — including the
// viewer's own, since a paid trip is a real trip no matter who booked it.
export async function assertCarIsAvailable(
    carId: number,
    startTime: string,
    endTime: string,
    options: { excludeBookingId?: string; viewerId?: string } = {},
) {
    const conflict = await findCarConflict(carId, startTime, endTime, options)
    if (conflict) throw new Error(conflict)
}

/**
 * The same check as assertCarIsAvailable, returning the conflict as a message
 * (null when the car is free) instead of throwing it. It still throws when the
 * database can't be read, so a caller acting on a conflict (refunding a late
 * payment, say) can never mistake an outage for "the dates are taken".
 */
export async function findCarConflict(
    carId: number,
    startTime: string,
    endTime: string,
    options: { excludeBookingId?: string; viewerId?: string } = {},
): Promise<string | null> {
    const supabaseAdmin = getServiceRoleClient()

    const bufferMs = TURNAROUND_HOURS * MS_PER_HOUR
    const windowStart = new Date(new Date(startTime).getTime() - bufferMs).toISOString()
    const windowEnd = new Date(new Date(endTime).getTime() + bufferMs).toISOString()

    // Other site bookings: confirmed always blocks; pending only blocks while
    // still "live", and never against the customer who owns it (see viewerId).
    const holdCutoff = new Date(Date.now() - PENDING_HOLD_MS).toISOString()
    const liveHold = options.viewerId
        ? `and(created_at.gte.${holdCutoff},user_id.neq.${options.viewerId})`
        : `created_at.gte.${holdCutoff}`
    let bookingQuery = supabaseAdmin
        .from('bookings')
        .select('start_time, end_time')
        .eq('car_id', carId)
        .in('status', ['pending', 'confirmed'])
        .lt('start_time', windowEnd)
        .gt('end_time', windowStart)
        .or(`status.eq.confirmed,${liveHold}`)
    if (options.excludeBookingId) bookingQuery = bookingQuery.neq('id', options.excludeBookingId)

    const { data: conflictingBookings, error: bErr } = await bookingQuery
    if (bErr) throw new Error(bErr.message)
    if (conflictingBookings?.length) return conflictMessage(conflictingBookings, startTime, endTime)

    // Another trip's extension that is being paid for or awaiting an owner. It
    // holds its added time exactly like a booking does, buffer included.
    const extensionHolds = await extensionHoldRows(supabaseAdmin, carId, {
        windowStart,
        windowEnd,
        excludeBookingId: options.excludeBookingId,
    })
    if (extensionHolds.length) return conflictMessage(extensionHolds, startTime, endTime)

    // Blocked dates are date-only and unbuffered: a block means the car is
    // spoken for those whole days, and the day after it ends is bookable from
    // opening. businessDateKey rather than startTime.slice(0, 10) — the slice
    // takes the UTC day, and a 10pm Central start is already the next day there,
    // which pushed this comparison a day off.
    const startDate = businessDateKey(startTime)
    const endDate = businessDateKey(endTime)
    const { data: conflictingBlocks, error: blErr } = await supabaseAdmin
        .from('car_blocked_dates')
        .select('id')
        .eq('car_id', carId)
        .lte('start_date', endDate)
        .gte('end_date', startDate)
    if (blErr) throw new Error(blErr.message)
    if (conflictingBlocks?.length) return 'This car is not available for the selected dates'

    // Turo trips are real trips, so they get the same buffer as site bookings.
    const { data: conflictingTuro, error: tErr } = await supabaseAdmin
        .from('turo_bookings')
        .select('start_time, end_time')
        .eq('car_id', carId)
        .lt('start_time', windowEnd)
        .gt('end_time', windowStart)
    if (tErr) throw new Error(tErr.message)
    if (conflictingTuro?.length) return conflictMessage(conflictingTuro, startTime, endTime)
    return null
}

// Turns a conflicting row into something the customer can act on. A trip that
// merely lands inside the turnaround buffer is a different problem from one that
// genuinely overlaps — the first is fixed by nudging a dropdown a few hours, and
// saying "no longer available" would send them hunting for another car instead.
function conflictMessage(
    conflicts: { start_time: string; end_time: string }[],
    startTime: string,
    endTime: string,
): string {
    const start = new Date(startTime).getTime()
    const end = new Date(endTime).getTime()

    const bufferOnly = conflicts.find(c => {
        const cStart = new Date(c.start_time).getTime()
        const cEnd = new Date(c.end_time).getTime()
        return cStart >= end || cEnd <= start
    })

    if (!bufferOnly) return 'This car is no longer available for the selected dates'

    const endsBeforeUs = new Date(bufferOnly.end_time).getTime() <= start
    return endsBeforeUs
        ? `This car is being returned at ${formatBusinessDateTime(bufferOnly.end_time)}. ` +
          `Trips need at least ${TURNAROUND_HOURS} hours between them, so please start later.`
        : `Another trip starts at ${formatBusinessDateTime(bufferOnly.start_time)}. ` +
          `Trips need at least ${TURNAROUND_HOURS} hours between them, so please return earlier.`
}