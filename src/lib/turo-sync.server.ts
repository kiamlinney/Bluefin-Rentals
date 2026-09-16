// The Turo email sync: reads Turo's trip emails from Gmail and mirrors each
// trip into turo_bookings, so a car rented on Turo blocks the site's calendar.
//
// Server-only, and deliberately NOT in db.ts. db.ts is imported by pages that
// run in the browser; the build strips the bodies of its createServerFn
// handlers for the client, but keeps plain exported functions. runTuroSync used
// to be one of those, which dragged googleapis (and node-fetch under it) into
// the browser bundle and failed `vite build` outright. Here it's only reachable
// from server code: the syncTuroBookings handler and the cron route.
//
// It has no auth of its own — callers own that. syncTuroBookings passes an
// admin's session client after checking is_admin; src/routes/api/cron/sync-turo.ts
// passes a service-role client after checking CRON_SECRET, because a scheduled
// request has no session and turo_bookings is admin-only under RLS.

import { google } from 'googleapis'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { wallClockToUtcIso } from './pricing'

// How far back a Turo sync searches Gmail, in days. A manual run uses the full
// window as a catch-up; the scheduled run uses a short one, since it runs every
// 15 minutes — see supabase/migrations/20260915130000_schedule_turo_sync.sql for
// why it's a day rather than minutes.
export const TURO_SYNC_MAX_LOOKBACK_DAYS = 400
export const TURO_SYNC_SCHEDULED_LOOKBACK_DAYS = 1

// Gmail caps how many API units one user can spend per minute, and a catch-up
// over months of email hits that within seconds. Pausing and retrying lets the
// run finish; if it still can't, the run stops rather than recording every
// remaining email as a failure (they're unstored, so the next run retries them).
const RATE_LIMIT_BACKOFF_MS = [10_000, 30_000, 60_000]

function isRateLimited(err: unknown): boolean {
    const e = err as { code?: number; message?: string } | null
    return e?.code === 429 || /quota exceeded|rate limit/i.test(e?.message ?? '')
}

async function withRateLimitRetry<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await call()
        } catch (err) {
            if (!isRateLimited(err) || attempt >= RATE_LIMIT_BACKOFF_MS.length) throw err
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_BACKOFF_MS[attempt]))
        }
    }
}

// Turo emails that are about a trip but never change when or which car it is,
// so there's nothing to store. Skipped quietly — anything NOT listed here that
// lacks trip dates still surfaces as an error, which is how a new kind of Turo
// email that does matter would get noticed.
function isIgnoredNotification(name: string | null): boolean {
    return (
        // "X has an upcoming trip with your Y": repeats the booking email.
        !!name?.startsWith('ReservationReminder') ||
        // "X has added another driver to their trip with your Y": no dates.
        name === 'AddDriverToTripOwner'
    )
}

export async function runTuroSync(supabase: SupabaseClient<Database>, lookbackDays: number) {
    // Initialize Gmail client using stored refresh token
    const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
    )
    oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN })
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

    // Fetch all cars so we can match email car names to car IDs
    const { data: cars } = await supabase.from('cars').select('id, make, model, year, is_available')
    if (!cars) throw new Error('Could not load cars')

    // Fetch already-synced message IDs so we never insert duplicates.
    // The gmail_message_id unique constraint handles this at the DB level too,
    // but checking here avoids unnecessary API calls for emails we've seen.
    const { data: existing } = await supabase
        .from('turo_bookings')
        .select('gmail_message_id')
    const alreadySynced = new Set(existing?.map(r => r.gmail_message_id) ?? [])

    // Search for Turo booking + cancellation emails from the past
    // `lookbackDays` days (~13 months on a manual run).
    // "trip with your" matches both "X's trip with your Y is booked!" and
    // "X has cancelled their trip with your Y" — which type each message
    // actually is gets decided below via its Notification-Name header.
    // (Previously also required "Cha-ching" in the body, which matched
    // booking emails only and silently excluded every cancellation.)
    // Paginated via pageToken since a single list() call only returns one
    // page — without this, any matches past the first page were silently
    // dropped. alreadySynced (above) keeps this cheap: we only ever fetch
    // and parse the bodies of messages we haven't stored yet.
    const messageIds: string[] = []
    let pageToken: string | undefined = undefined
    do {
        // Typed loosely (matches findPlainText/payload below) — the googleapis
        // Gmail client's overloads otherwise fight TS across this loop.
        const listRes: any = await withRateLimitRetry(() => gmail.users.messages.list({
            userId: 'me',
            q: `from:@turo.com subject:"trip with your" newer_than:${lookbackDays}d`,
            pageToken,
        }))
        const ids: string[] = (listRes.data.messages ?? [])
            .map((m: { id?: string }) => m.id)
            .filter((id: string | undefined): id is string => !!id)
        messageIds.push(...ids)
        pageToken = listRes.data.nextPageToken ?? undefined
    } while (pageToken)

    // Filter out already-synced messages before fetching their content
    const newIds = messageIds.filter(id => !alreadySynced.has(id!)) as string[]

    if (newIds.length === 0) {
        return { synced: 0, skipped: messageIds.length, canceled: 0, errors: [] as string[] }
    }

    const results = { synced: 0, skipped: messageIds.length - newIds.length, canceled: 0, errors: [] as string[] }

    // Reservation IDs seen as canceled during this run. Deletions are applied
    // in one batch AFTER the loop below (not inline as each cancellation email
    // is seen) so that a booking and its cancellation landing in the same sync
    // run — e.g. on a big catch-up run — can't race: the cancellation always
    // wins regardless of which of the two messages Gmail happens to return first.
    const canceledTripIds: string[] = []

    // ── Convert parsed date parts to UTC ISO string ───────────────
    // Input: month, day, 2-digit year, hour, minute, am/pm
    // Output: UTC ISO string suitable for Supabase timestamptz column
    function toISO(month: string, day: string, year2: string, hour: string, min: string, ampm: string): string {
        let h = parseInt(hour)
        if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12
        if (ampm.toLowerCase() === 'am' && h === 12) h = 0
        const fullYear = 2000 + parseInt(year2)

        // Turo prints times in the host's local timezone, i.e. business time.
        //
        // This used to build a suffix-less string and hand it to `new Date()`,
        // relying on the host interpreting it as CST/CDT. That holds on a
        // developer's laptop and is wrong everywhere this actually runs: a
        // server function runs on the server, whose clock is UTC in
        // production, so every synced Turo trip was stored 5–6 hours early.
        // wallClockToUtcIso names the zone instead of inheriting it, and
        // gives the same answer wherever it runs.
        const dateKey = `${fullYear}-${String(parseInt(month)).padStart(2,'0')}-${String(parseInt(day)).padStart(2,'0')}`
        return wallClockToUtcIso(dateKey, `${String(h).padStart(2,'0')}:${min}`)
    }

    // Recursively find the plain text MIME part.
    // Gmail emails are a tree of MIME parts — an email might be:
    // multipart/mixed → multipart/alternative → text/plain
    //                                         → text/html
    // We walk the tree until we find mimeType === 'text/plain'
    function findPlainText(payload: any): string | null {
        if (!payload) return null
        if (payload.mimeType === 'text/plain' && payload.body?.data) {
            // Gmail encodes bodies as base64url — Buffer decodes it
            return Buffer.from(payload.body.data, 'base64').toString('utf-8')
        }
        for (const part of (payload.parts ?? [])) {
            const found = findPlainText(part)
            if (found) return found
        }
        return null
    }

    for (const messageId of newIds) {
        try {
            // Fetch the full email content for this message
            const message = await withRateLimitRetry(() => gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'full',
            }))

            const headers = message.data.payload?.headers ?? []
            const headerValue = (name: string) => headers.find((h: any) => h.name === name)?.value ?? null

            // Turo tags every trip-related email with this header — it's how we
            // tell a booking confirmation apart from a cancellation notice
            // without depending on subject-line wording.
            const notificationName = headerValue('Notification-Name')

            // Reminders and added-driver notices carry nothing to store (see
            // isIgnoredNotification). Storing reminders is how one trip used to
            // end up with two rows.
            if (isIgnoredNotification(notificationName)) {
                results.skipped++
                continue
            }

            if (notificationName === 'CancelledReservationOwner') {
                // Cancellations carry the same Reservation-ID header as the
                // original booking email, which is what ties the two together
                // (they're otherwise unrelated Gmail messages with different IDs).
                let turoTripId = headerValue('Reservation-ID')

                // Some cancellation emails don't carry that header — fall back
                // to the same "Reservation ID #12345" body text the booking
                // path already parses, rather than silently dropping the
                // cancellation and leaving a stale booking on the calendar.
                if (!turoTripId) {
                    const body = findPlainText(message.data.payload)
                    const reservationMatch = body?.match(/Reservation ID #(\d+)/)
                    turoTripId = reservationMatch?.[1] ?? null
                }

                if (!turoTripId) {
                    results.errors.push(`${messageId}: cancellation missing Reservation-ID (header + body)`)
                    continue
                }
                canceledTripIds.push(turoTripId)
                continue
            }

            const body = findPlainText(message.data.payload)
            if (!body) {
                results.errors.push(`${messageId}: no plain text body found`)
                continue
            }

            if (!body.includes('Trip start:') || !body.includes('Trip end:')) {
                results.errors.push(`${messageId}: missing date fields, skipping`)
                continue
            }

            // ── Parse start time ──────────────────────────────────────────
            // Matches: "Trip start: 8/23/26 9:30 am"
            const startMatch = body.match(
                /Trip start:\s*(\d{1,2})\/(\d{1,2})\/(\d{2})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i
            )
            // ── Parse end time ────────────────────────────────────────────
            // Matches: "Trip end: 8/26/26 9:00 pm"
            const endMatch = body.match(
                /Trip end:\s*(\d{1,2})\/(\d{1,2})\/(\d{2})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i
            )

            if (!startMatch || !endMatch) {
                results.errors.push(`${messageId}: could not parse dates`)
                continue
            }

            const startTime = toISO(startMatch[1]!, startMatch[2]!, startMatch[3]!, startMatch[4]!, startMatch[5]!, startMatch[6]!)
            const endTime = toISO(endMatch[1]!, endMatch[2]!, endMatch[3]!, endMatch[4]!, endMatch[5]!, endMatch[6]!)

            // Trip already over — nothing left to block on the calendar, and
            // widening the search window (400d) means most results are now
            // old completed trips, so skip storing them rather than let
            // turo_bookings accumulate rows nothing ever reads again.
            if (new Date(endTime).getTime() < Date.now()) {
                results.skipped++
                continue
            }

            // ── Parse car name ────────────────────────────────────────────
            // Matches a line like "Toyota Prius 2014" — make model year
            // The \d{4} anchors the match to lines containing a 4-digit year
            const carMatch = body.match(/^\s*((?:[\w-]+\s+)+\d{4})\s*$/m)
            const carString = carMatch?.[1]?.trim() ?? ''

            // Match the extracted car string to a car: year, make AND model. This
            // used to check year + make only and take the first hit, which put a
            // Turo trip on the active 2018 Jeep Cherokee onto the retired one —
            // leaving the active Jeep bookable on the site while it was out.
            //
            // The email names no trim or plate, so cars sharing a year, make and
            // model can't be told apart from it. A retired car (is_available
            // false) can't be on a new Turo trip, so active cars win; anything
            // still ambiguous is reported rather than guessed.
            const yearMatch = carString.match(/(\d{4})/)
            const year = yearMatch ? parseInt(yearMatch[1]!) : 0
            const namePart = carString.replace(/\d{4}/, '').trim().toLowerCase()

            const candidates = cars.filter(car =>
                car.year === year &&
                namePart.includes(car.make.toLowerCase()) &&
                namePart.includes(car.model.toLowerCase())
            )
            const active = candidates.filter(car => car.is_available !== false)
            const pool = active.length > 0 ? active : candidates

            if (pool.length !== 1) {
                results.errors.push(
                    pool.length === 0
                        ? `${messageId}: could not match car "${carString}"`
                        : `${messageId}: "${carString}" matches more than one car (ids ${pool.map(c => c.id).join(', ')}), not stored`,
                )
                continue
            }
            const matchedCar = pool[0]!

            // ── Parse renter name ─────────────────────────────────────────
            const subject = message.data.payload?.headers
                ?.find((h: any) => h.name === 'Subject')?.value ?? ''

            // "Zachary's trip with your …" on a booking email, "Zachary has
            // changed their trip with your …" on an AutoApprovedTripChangeHost.
            const renterMatch = subject.match(/^(.+?)(?:[’']s trip with your| has changed their trip with your)/)
            const renterName = renterMatch?.[1]?.trim() ?? null

            // ── Parse reservation ID ──────────────────────────────────────
            // The Reservation-ID header first — every Turo trip email checked
            // carries it — with the body text as the fallback, same as the
            // cancellation path above.
            const turoTripId =
                headerValue('Reservation-ID') ?? body.match(/Reservation ID #(\d+)/)?.[1] ?? null

            // When Turo sent this email. internalDate is Gmail's receive time
            // in epoch milliseconds.
            const emailSentAt = new Date(Number(message.data.internalDate)).toISOString()

            const row = {
                car_id: matchedCar.id,
                gmail_message_id: messageId,
                renter_name: renterName,
                start_time: startTime,
                end_time: endTime,
                turo_trip_id: turoTripId,
                raw_subject: subject || null,
                email_sent_at: emailSentAt,
            }

            // ── One row per trip ──────────────────────────────────────────
            // Turo emails about a trip more than once, so the row is keyed on
            // turo_trip_id (unique) and the most recently SENT email wins. That
            // is what lets a changed trip replace its original dates instead of
            // blocking the car on both. Send time is compared rather than
            // trusting processing order: Gmail returns messages in no promised
            // order, and a catch-up run can meet a change before the booking
            // it modifies.
            if (turoTripId) {
                const { data: current, error: lookupError } = await supabase
                    .from('turo_bookings')
                    .select('id, email_sent_at, renter_name')
                    .eq('turo_trip_id', turoTripId)
                    .maybeSingle()

                if (lookupError) {
                    results.errors.push(`${messageId}: ${lookupError.message}`)
                    continue
                }

                if (current) {
                    const currentSentAt = current.email_sent_at ? new Date(current.email_sent_at).getTime() : -Infinity
                    if (currentSentAt >= new Date(emailSentAt).getTime()) {
                        // An older email about a trip already stored from a newer one.
                        results.skipped++
                        continue
                    }

                    const { error: updateError } = await supabase
                        .from('turo_bookings')
                        // Keep a name already on file if this email's subject didn't yield one.
                        .update({ ...row, renter_name: renterName ?? current.renter_name })
                        .eq('id', current.id)

                    if (updateError) {
                        results.errors.push(`${messageId}: ${updateError.message}`)
                    } else {
                        results.synced++
                    }
                    continue
                }
            }

            // A new trip. A unique violation here means another sync run
            // inserted the same email or trip in the meantime — nothing to do.
            const { error } = await supabase
                .from('turo_bookings')
                .insert(row)

            if (error) {
                if (error.code === '23505') {
                    results.skipped++
                } else {
                    results.errors.push(`${messageId}: ${error.message}`)
                }
            } else {
                results.synced++
            }

        } catch (err: unknown) {
            if (isRateLimited(err)) {
                // Still limited after withRateLimitRetry's backoff. Every email
                // after this would fail the same way, so stop here instead.
                const remaining = newIds.length - newIds.indexOf(messageId)
                results.errors.push(`Stopped: Gmail rate limit still exceeded after retrying; ${remaining} emails left for the next run.`)
                break
            }
            results.errors.push(`${messageId}: ${err instanceof Error ? err.message : 'unknown error'}`)
        }
    }

    // Remove any booking whose reservation was canceled — applied once, after
    // the loop above, so cancellations always win over a same-run insert.
    if (canceledTripIds.length > 0) {
        const { data: removed, error: cancelErr } = await supabase
            .from('turo_bookings')
            .delete()
            .in('turo_trip_id', canceledTripIds)
            .select('id')

        if (cancelErr) {
            results.errors.push(`Failed to remove canceled bookings: ${cancelErr.message}`)
        } else {
            results.canceled = removed?.length ?? 0
        }
    }

    return results
}