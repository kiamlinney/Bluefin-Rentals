// The Turo email sync: reads Turo's trip emails from Gmail and mirrors each
// trip into turo_bookings, so a car rented on Turo blocks the site's calendar.
// What each email means is decided in turo-email.ts; this file fetches, writes,
// and raises the owner alerts (a Turo vehicle swap, trips overlapping).
//
// Server-only, and deliberately NOT in db.ts. db.ts is imported by pages that
// run in the browser; the build strips the bodies of its createServerFn
// handlers for the client, but keeps plain exported functions. runTuroSync used
// to be one of those, which dragged googleapis (and node-fetch under it) into
// the browser bundle and failed `vite build` outright. Here it's only reachable
// from server code: the syncTuroBookings handler and the cron route.
//
// It has no auth of its own — callers own that. Both pass a service-role
// client: the cron route after checking CRON_SECRET (a scheduled request has
// no session), syncTuroBookings after checking is_admin. The overlap alerts
// table has no policies, so an admin's own session can't write it.

import { google } from 'googleapis'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TablesUpdate } from './database.types'
import {
    matchCar,
    parseCarLine,
    parseRenterName,
    parseReservationId,
    parseTripTimes,
    turoEmailKind,
    turoGmailQuery,
    widenForRequest,
} from './turo-email'
import { isTuroSwapPending } from './turo-swap'
import { alertNewOverlaps, describeTuroTrip, type ScheduleCar } from './schedule-alerts.server'
import { sendTuroSwapAlert } from './turo-alert-email'

// How far back a Turo sync searches Gmail, in days. The scheduled run uses a
// short window, since it runs every 15 minutes — see
// supabase/migrations/20260915130000_schedule_turo_sync.sql for why it's a day
// rather than minutes. The catch-up (the admin's Sync button, or the cron
// route's ?days=) looks further back, for when the scheduled runs couldn't
// reach the site: the 2026-10 domain suspension stopped them for two days, and
// every trip booked in that gap was already outside the 1-day window by the
// time they resumed. 30 days covers any outage someone would notice; trips
// that have already ended are skipped anyway.
export const TURO_SYNC_CATCHUP_LOOKBACK_DAYS = 30
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

type Db = SupabaseClient<Database>
type SyncCar = ScheduleCar & { is_available: boolean | null }

// One email, read and understood, waiting to be applied.
type TuroEvent =
    | {
          kind: 'trip' | 'request'
          messageId: string
          sentAt: string
          subject: string
          turoTripId: string | null
          carId: number
          startTime: string
          endTime: string
          renterName: string | null
      }
    | { kind: 'cancel'; messageId: string; sentAt: string; turoTripId: string }
    | { kind: 'swap'; messageId: string; sentAt: string; turoTripId: string }

type ReadResult = { event: TuroEvent } | { skip: true } | { error: string }

export type TuroSyncResult = {
    synced: number
    skipped: number
    canceled: number
    /** Swaps flagged (and emailed about) this run. */
    swapsFlagged: number
    /** Overlaps newly emailed this run. */
    overlapsAlerted: number
    errors: string[]
}

const ms = (iso: string) => new Date(iso).getTime()

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

export async function runTuroSync(supabase: Db, lookbackDays: number): Promise<TuroSyncResult> {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
    )
    oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN })
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

    const { data: carRows } = await supabase
        .from('cars')
        .select('id, make, model, year, is_available, license_plate')
    if (!carRows) throw new Error('Could not load cars')
    const cars: SyncCar[] = carRows
    const carsById = new Map(cars.map(car => [car.id, car]))

    // A trip row keeps the id of the newest email applied to it, so those are
    // never fetched again. Older emails about a stored trip, and emails that are
    // never stored (reminders, swaps, cancellations), are re-read each run while
    // they're in the window; applying them is a no-op the second time.
    const { data: existing } = await supabase.from('turo_bookings').select('gmail_message_id')
    const alreadySynced = new Set(existing?.map(r => r.gmail_message_id) ?? [])

    // Paginated: a single list() call only returns one page, and anything past
    // it used to be silently dropped.
    const messageIds: string[] = []
    let pageToken: string | undefined = undefined
    do {
        // Typed loosely (matches findPlainText/payload) — the googleapis Gmail
        // client's overloads otherwise fight TS across this loop.
        const listRes: any = await withRateLimitRetry(() => gmail.users.messages.list({
            userId: 'me',
            q: turoGmailQuery(lookbackDays),
            pageToken,
        }))
        const ids: string[] = (listRes.data.messages ?? [])
            .map((m: { id?: string }) => m.id)
            .filter((id: string | undefined): id is string => !!id)
        messageIds.push(...ids)
        pageToken = listRes.data.nextPageToken ?? undefined
    } while (pageToken)

    const newIds = messageIds.filter(id => !alreadySynced.has(id))
    const results: TuroSyncResult = {
        synced: 0,
        skipped: messageIds.length - newIds.length,
        canceled: 0,
        swapsFlagged: 0,
        overlapsAlerted: 0,
        errors: [],
    }

    // ── 1. Read every new email ───────────────────────────────────────────────
    const events: TuroEvent[] = []
    for (const messageId of newIds) {
        try {
            const read = await readMessage(gmail, messageId, cars)
            if ('event' in read) events.push(read.event)
            else if ('error' in read) results.errors.push(`${messageId}: ${read.error}`)
            else results.skipped++
        } catch (err: unknown) {
            if (isRateLimited(err)) {
                // Still limited after withRateLimitRetry's backoff. Every email
                // after this would fail the same way, so stop reading here and
                // apply what was read.
                const remaining = newIds.length - newIds.indexOf(messageId)
                results.errors.push(`Stopped: Gmail rate limit still exceeded after retrying; ${remaining} emails left for the next run.`)
                break
            }
            results.errors.push(`${messageId}: ${err instanceof Error ? err.message : 'unknown error'}`)
        }
    }

    // ── 2. Apply them in the order Turo sent them ─────────────────────────────
    // Gmail lists newest first. A catch-up run can hold a booking, a change
    // request and its confirmation all at once, and the request has to land on
    // the booking, not before it.
    events.sort((a, b) => ms(a.sentAt) - ms(b.sentAt))

    // Cancellations are applied once, after everything else, so a booking and
    // its cancellation in the same run always end with the trip gone.
    const canceledTripIds: string[] = []

    for (const event of events) {
        try {
            if (event.kind === 'cancel') canceledTripIds.push(event.turoTripId)
            else if (event.kind === 'swap') await applySwap(supabase, event, carsById, results)
            else await applyTrip(supabase, event, results)
        } catch (err: unknown) {
            results.errors.push(`${event.messageId}: ${err instanceof Error ? err.message : 'unknown error'}`)
        }
    }

    if (canceledTripIds.length > 0) {
        const { data: removed, error: cancelErr } = await supabase
            .from('turo_bookings')
            .delete()
            .in('turo_trip_id', canceledTripIds)
            .select('id')

        if (cancelErr) results.errors.push(`Failed to remove canceled bookings: ${cancelErr.message}`)
        else results.canceled = removed?.length ?? 0
    }

    // ── 3. Overlaps ────────────────────────────────────────────────────────────
    // Every run, not only when something changed above: a Bluefin trip can be
    // confirmed onto a car between runs too.
    try {
        results.overlapsAlerted = await alertNewOverlaps(supabase)
    } catch (err: unknown) {
        results.errors.push(`Overlap check failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    }

    return results
}

async function readMessage(
    gmail: ReturnType<typeof google.gmail>,
    messageId: string,
    cars: SyncCar[],
): Promise<ReadResult> {
    const message = await withRateLimitRetry(() => gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
    }))

    const headers = message.data.payload?.headers ?? []
    const headerValue = (name: string) => headers.find((h: any) => h.name === name)?.value ?? null

    const subject = headerValue('Subject') ?? ''
    const notificationName = headerValue('Notification-Name')
    const kind = turoEmailKind(notificationName, subject)

    if (kind === 'ignore') return { skip: true }
    if (kind === 'unknown') {
        // Reported rather than stored: guessing is how a Turo-initiated
        // cancellation once became a booking.
        return { error: `unrecognised Turo email (${notificationName ?? 'no Notification-Name'}) "${subject}", not stored` }
    }

    // When Turo sent it: Gmail's receive time, in epoch milliseconds.
    const sentAt = new Date(Number(message.data.internalDate)).toISOString()
    const body = findPlainText(message.data.payload)
    // The Reservation-ID header ties every email about one trip together. Some
    // cancellations have been sent without it; the body names it too.
    const turoTripId = parseReservationId(headerValue('Reservation-ID'), body)

    if (kind === 'cancel' || kind === 'swap') {
        if (!turoTripId) return { error: `${kind} email missing Reservation-ID (header + body)` }
        return { event: { kind, messageId, sentAt, turoTripId } }
    }

    if (!body) return { error: 'no plain text body found' }
    const times = parseTripTimes(body)
    if (!times) return { error: 'could not parse trip dates' }

    // Already over: nothing left to block, and a catch-up mostly finds old trips.
    if (ms(times.endTime) < Date.now()) return { skip: true }

    const match = matchCar(cars, parseCarLine(body))
    if ('error' in match) return { error: match.error }

    return {
        event: {
            kind,
            messageId,
            sentAt,
            subject,
            turoTripId,
            carId: match.car.id,
            startTime: times.startTime,
            endTime: times.endTime,
            renterName: parseRenterName(subject),
        },
    }
}

const TRIP_COLUMNS =
    'id, car_id, email_sent_at, renter_name, start_time, end_time, turo_trip_id, swap_accepted_at, swap_car_confirmed_at'

// ── One row per trip ──────────────────────────────────────────────────────────
// Turo emails about a trip more than once, so the row is keyed on turo_trip_id
// (unique) and the most recently SENT email wins. That is what lets a changed
// trip replace its original dates instead of blocking the car on both. Send
// time is compared, not processing order, because a later run can meet an
// email older than the one already stored.
async function applyTrip(
    supabase: Db,
    event: Extract<TuroEvent, { kind: 'trip' | 'request' }>,
    results: TuroSyncResult,
) {
    if (event.turoTripId) {
        const { data: current, error } = await supabase
            .from('turo_bookings')
            .select(TRIP_COLUMNS)
            .eq('turo_trip_id', event.turoTripId)
            .maybeSingle()
        if (error) throw new Error(error.message)

        if (current) {
            if (current.email_sent_at && ms(current.email_sent_at) >= ms(event.sentAt)) {
                // An older email about a trip already stored from a newer one.
                results.skipped++
                return
            }

            const update: TablesUpdate<'turo_bookings'> = {
                gmail_message_id: event.messageId,
                raw_subject: event.subject || null,
                email_sent_at: event.sentAt,
                // Keep a name already on file if this subject didn't yield one.
                renter_name: event.renterName ?? current.renter_name,
            }

            if (event.kind === 'request') {
                // Not a change until we confirm it, and the confirmation is its
                // own email. Until then, block both versions; a request never
                // moves the car.
                Object.assign(update, widenForRequest(current, event))
            } else {
                update.start_time = event.startTime
                update.end_time = event.endTime
                // An email sent before a swap still names the old car, so it
                // keeps the dates and leaves the car alone. One sent after it
                // names the new car, which settles a swap still waiting on us.
                const sentBeforeSwap = current.swap_accepted_at != null && ms(event.sentAt) < ms(current.swap_accepted_at)
                if (!sentBeforeSwap) {
                    update.car_id = event.carId
                    if (isTuroSwapPending(current)) update.swap_car_confirmed_at = event.sentAt
                }
            }

            const { error: updateError } = await supabase
                .from('turo_bookings')
                .update(update)
                .eq('id', current.id)
            if (updateError) throw new Error(updateError.message)
            results.synced++
            return
        }
    }

    // A new trip. For a request with no stored trip (its booking email has
    // already left every window) the requested times are the only ones known.
    // A unique violation means another run inserted it in the meantime.
    const { error } = await supabase.from('turo_bookings').insert({
        car_id: event.carId,
        gmail_message_id: event.messageId,
        renter_name: event.renterName,
        start_time: event.startTime,
        end_time: event.endTime,
        turo_trip_id: event.turoTripId,
        raw_subject: event.subject || null,
        email_sent_at: event.sentAt,
    })
    if (!error) results.synced++
    else if (error.code === '23505') results.skipped++
    else throw new Error(error.message)
}

// ── Vehicle swap ──────────────────────────────────────────────────────────────
// The acceptance email names the trip but not the new car, so the trip is
// flagged for an owner to pick it (/admin/calendar) and the owners are emailed.
// The row's car is left alone: the original car stays blocked until then.
//
// The flag is claimed on swap_accepted_at, conditional on the value just read,
// so the email goes out once however many runs, or overlapping runs, see the
// same acceptance. Settled swaps can't be re-opened by an old email either:
// only an acceptance newer than the stored one claims.
async function applySwap(
    supabase: Db,
    event: Extract<TuroEvent, { kind: 'swap' }>,
    carsById: Map<number, ScheduleCar>,
    results: TuroSyncResult,
) {
    const outcome = await flagTuroSwap(supabase, { turoTripId: event.turoTripId, acceptedAt: event.sentAt }, carsById)
    if (outcome.result === 'flagged') results.swapsFlagged++
    else if (outcome.result === 'skipped') results.skipped++
    else results.errors.push(`Swap alert for Turo trip ${event.turoTripId} did not send: ${outcome.error}`)
}

export type FlagSwapOutcome =
    | { result: 'flagged' }
    /** No such trip, already over, or this acceptance (or a newer one) was already handled. */
    | { result: 'skipped' }
    /** The email failed, so the flag was put back for the next run to try again. */
    | { result: 'emailFailed'; error: string }

/**
 * Records that Turo trip `turoTripId` had a swap accepted at `acceptedAt`, and
 * emails the owners, once. What the sync does on a VehicleSwapAccepted email,
 * and what the admin's dev-only "Preview a Turo swap" runs, so the preview
 * shows exactly what a real swap does.
 */
export async function flagTuroSwap(
    supabase: Db,
    { turoTripId, acceptedAt }: { turoTripId: string; acceptedAt: string },
    carsById: Map<number, ScheduleCar>,
): Promise<FlagSwapOutcome> {
    const { data: current, error } = await supabase
        .from('turo_bookings')
        .select(TRIP_COLUMNS)
        .eq('turo_trip_id', turoTripId)
        .maybeSingle()
    if (error) throw new Error(error.message)

    // Not stored (it ended before we started syncing, or was cancelled), or
    // already over: there is no car left to block.
    if (!current || ms(current.end_time) <= Date.now()) return { result: 'skipped' }

    const previous = current.swap_accepted_at
    if (previous && ms(previous) >= ms(acceptedAt)) return { result: 'skipped' }

    const claim = supabase
        .from('turo_bookings')
        .update({ swap_accepted_at: acceptedAt })
        .eq('id', current.id)
    const { data: claimed, error: claimError } = await (previous
        ? claim.eq('swap_accepted_at', previous)
        : claim.is('swap_accepted_at', null)
    ).select('id')
    if (claimError) throw new Error(claimError.message)
    // Another run claimed it a moment ago and is sending the email.
    if (!claimed?.length) return { result: 'skipped' }

    try {
        await sendTuroSwapAlert(describeTuroTrip(current), carsById.get(current.car_id) ?? null)
        return { result: 'flagged' }
    } catch (err: unknown) {
        // Put the claim back so the next run flags it and sends the email again.
        await supabase
            .from('turo_bookings')
            .update({ swap_accepted_at: previous })
            .eq('id', current.id)
            .eq('swap_accepted_at', acceptedAt)
        return { result: 'emailFailed', error: err instanceof Error ? err.message : 'unknown error' }
    }
}
