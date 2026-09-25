// The two emails a cancellation sends: one to the owners, one to the guest.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from './email'
import type { RefundOutcome } from './cancellation-policy'
import {
    ADMIN_RECIPIENT,
    INK,
    LINE,
    MUTED,
    SHORT_DATE,
    SITE_URL,
    button,
    carCard,
    carName,
    escapeHtml,
    firstName,
    formatBusinessDate,
    formatBusinessTime,
    longDateTime,
    money,
    paragraph,
    section,
    shell,
    statCell,
    ACCENT,
} from './email-template'

export type CancellationEmailRow = {
    id: string
    start_time: string
    end_time: string
    total_price: number | string
    pickup_location: string | null
    cancellation_reason: string | null
    canceled_by: string | null
    cars: { year: number; make: string; model: string; trim: string | null; image_url: string | null } | null
    profiles: { full_name: string | null; email: string | null; phone: string | null; num_trips: number | null } | null
}

export const CANCELLATION_EMAIL_SELECT =
    'id, start_time, end_time, total_price, pickup_location, cancellation_reason, canceled_by, ' +
    'cars(year, make, model, trim, image_url), ' +
    'profiles(full_name, email, phone, num_trips)'

// ── Shared wording ───────────────────────────────────────────────────────────

/** What the owners need to know about the money, in one sentence. */
function hostRefundLine(outcome: RefundOutcome, who: string, totalPaid: number | string): string {
    const kept = money(totalPaid)
    switch (outcome.kind) {
        case 'full':
            return `${who} cancelled within the free cancellation window, so the full ${money(outcome.refundAmount)} has been refunded and you won't receive a payment for this trip.`
        case 'partial':
            return `${who} cancelled outside the free cancellation window. ${money(outcome.refundAmount)} has been refunded and you keep ${money(outcome.cancellationFee + outcome.retainedPremium)}.`
        case 'none':
            return outcome.reason === 'after-trip-start'
                ? `${who} cancelled after the trip had already started, so nothing was refunded and you keep the full ${kept}.`
                : `${who} booked at the non-refundable rate and cancelled after the grace period, so nothing was refunded and you keep the full ${kept}.`
    }
}

/** The same facts from the guest's side. */
function guestRefundLine(outcome: RefundOutcome): string {
    switch (outcome.kind) {
        case 'full':
            return outcome.reason === 'admin-initiated'
                ? `We're sorry — we had to cancel this trip. You've been refunded in full: <strong>${escapeHtml(money(outcome.refundAmount))}</strong>.`
                : `You cancelled within the free cancellation window, so you've been refunded in full: <strong>${escapeHtml(money(outcome.refundAmount))}</strong>.`
        case 'partial':
            return `You cancelled outside the free cancellation window, so a cancellation fee of <strong>${escapeHtml(money(outcome.cancellationFee))}</strong> was kept. You've been refunded <strong>${escapeHtml(money(outcome.refundAmount))}</strong>.`
        case 'none':
            return outcome.reason === 'after-trip-start'
                ? 'This trip had already started when it was cancelled, so no refund was issued.'
                : 'This trip was booked at the non-refundable rate and cancelled after the 24-hour grace period, so no refund was issued.'
    }
}

/** Only shown when money actually moved. */
function settlementNote(outcome: RefundOutcome): string {
    return outcome.refundAmount > 0
        ? 'Refunds are returned to the original card and usually appear within 5–10 business days.'
        : ''
}

// ── Host email ───────────────────────────────────────────────────────────────

/**
 * The bordered quote box holding the guest's reason.
 *
 * Escaped, obviously — this is the one string in the email that a customer
 * typed. Newlines become <br> so a multi-line reason doesn't collapse.
 */
function reasonBox(reason: string | null): string {
    if (!reason?.trim()) return ''
    const html = escapeHtml(reason.trim()).replace(/\r?\n/g, '<br>')
    return `
    <tr><td style="padding:20px 24px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${ACCENT};border-radius:8px">
            <tr><td align="center" style="padding:14px 16px;font:400 15px/1.6 Helvetica,Arial,sans-serif;color:${INK};text-align:center">
                ${html}
            </td></tr>
        </table>
        <div style="font:400 12px/1.4 Helvetica,Arial,sans-serif;color:${MUTED};margin:6px 0 0;text-align:center">Reason given by the guest</div>
    </td></tr>`
}

// Exported so the markup can be rendered and inspected without sending — the
// refund wording has six branches and they are much easier to check side by side
// than one test email at a time.
export function buildHostHtml(booking: CancellationEmailRow, outcome: RefundOutcome): string {
    const car = booking.cars
    const guest = booking.profiles
    const who = firstName(guest?.full_name ?? null)
    const sentAt = String(Date.now())

    const guestLines = [
        escapeHtml(guest?.full_name || who),
        guest?.email
            ? `<a href="mailto:${escapeHtml(guest.email)}" style="color:${ACCENT}">${escapeHtml(guest.email)}</a>`
            : null,
        guest?.phone ? escapeHtml(guest.phone) : null,
        `${guest?.num_trips ?? 0} ${guest?.num_trips === 1 ? 'trip' : 'trips'} with Bluefin`,
    ].filter(Boolean).join('<br>')

    const headline = booking.canceled_by === 'admin'
        ? `${who}'s trip was cancelled`
        : `${who} has cancelled their trip`

    const bodyRows = `
    <tr><td align="center" style="padding:28px 24px 0;text-align:center">
        <h1 style="margin:0 0 16px;font:700 24px/1.3 Helvetica,Arial,sans-serif;color:${INK};text-align:center">${escapeHtml(headline)}</h1>
        ${paragraph(`${escapeHtml(who)} has cancelled this trip with your ${escapeHtml(carName(car))}.`)}
        ${paragraph(escapeHtml(hostRefundLine(outcome, who, booking.total_price)))}
        ${outcome.estimated
            ? paragraph(`<span style="color:${MUTED};font-size:13px">This booking predates itemised pricing, so the refund was calculated from the trip total.</span>`)
            : ''}
    </td></tr>
${reasonBox(booking.cancellation_reason)}
${carCard({
        captionLabel: 'Cancelled trip',
        car,
        sentAt,
        statsRowHtml: `
                    ${statCell('Trip start', formatBusinessDate(booking.start_time, SHORT_DATE), formatBusinessTime(booking.start_time).toLowerCase())}
                    ${statCell('Trip end', formatBusinessDate(booking.end_time, SHORT_DATE), formatBusinessTime(booking.end_time).toLowerCase())}
                    ${statCell('Refunded', money(outcome.refundAmount), outcome.kind === 'none' ? 'nothing returned' : 'to the guest')}`,
    })}
    <tr><td style="padding:24px 24px 0" align="center">${button(`${SITE_URL}/admin/reservation/${booking.id}`, 'View reservation')}</td></tr>

    <tr><td style="padding:24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${section('Reservation ID', `#${escapeHtml(booking.id.slice(0, 8).toUpperCase())}`)}
            ${section('Location', escapeHtml(booking.pickup_location || 'Home base'))}
            ${section('About the guest', guestLines)}
        </table>
    </td></tr>
`

    return shell({ bodyRows, footerNote: 'Sent automatically when a trip is cancelled.' })
}

function buildHostText(booking: CancellationEmailRow, outcome: RefundOutcome): string {
    const who = firstName(booking.profiles?.full_name ?? null)
    const guest = booking.profiles

    return [
        `${who} has cancelled their trip with your ${carName(booking.cars)}.`,
        '',
        hostRefundLine(outcome, who, booking.total_price),
        ...(booking.cancellation_reason?.trim()
            ? ['', 'Reason given by the guest:', `  ${booking.cancellation_reason.trim()}`]
            : []),
        '',
        `Trip start:  ${longDateTime(booking.start_time)}`,
        `Trip end:    ${longDateTime(booking.end_time)}`,
        `Total paid:  ${money(booking.total_price)}`,
        `Refunded:    ${money(outcome.refundAmount)}`,
        `Location:    ${booking.pickup_location || 'Home base'}`,
        '',
        'Guest',
        `  ${guest?.full_name || who}`,
        `  ${guest?.email || 'no email on file'}`,
        `  ${guest?.phone || 'no phone on file'}`,
        '',
        `Reservation #${booking.id}`,
        `${SITE_URL}/admin/reservation/${booking.id}`,
    ].join('\n')
}

// ── Guest email ──────────────────────────────────────────────────────────────

/** Exported alongside buildHostHtml, for the same reason. */
export function buildGuestHtml(booking: CancellationEmailRow, outcome: RefundOutcome): string {
    const car = booking.cars
    const sentAt = String(Date.now())
    const note = settlementNote(outcome)

    // Itemised only when something was withheld — on a full refund there is
    // nothing to explain, and the rows would just be noise.
    const breakdown = outcome.kind === 'partial'
        ? `
    <tr><td style="padding:20px 24px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};font:400 14px/1.8 Helvetica,Arial,sans-serif;color:${INK}">
            <tr><td style="padding-top:12px">Trip total</td><td align="right" style="padding-top:12px">${escapeHtml(money(booking.total_price))}</td></tr>
            <tr><td>Cancellation fee</td><td align="right">−${escapeHtml(money(outcome.cancellationFee))}</td></tr>
            ${outcome.retainedPremium > 0
                ? `<tr><td style="color:${MUTED}">Refundable rate</td><td align="right" style="color:${MUTED}">−${escapeHtml(money(outcome.retainedPremium))}</td></tr>`
                : ''}
            <tr><td style="border-top:1px solid ${LINE};padding-top:8px;font-weight:700">Refunded</td><td align="right" style="border-top:1px solid ${LINE};padding-top:8px;font-weight:700">${escapeHtml(money(outcome.refundAmount))}</td></tr>
        </table>
    </td></tr>`
        : ''

    const bodyRows = `
    <tr><td align="center" style="padding:28px 24px 0;text-align:center">
        <h1 style="margin:0 0 16px;font:700 24px/1.3 Helvetica,Arial,sans-serif;color:${INK};text-align:center">Your trip has been cancelled</h1>
        ${paragraph(`Your trip with the ${escapeHtml(carName(car))} from <strong>${escapeHtml(longDateTime(booking.start_time))}</strong> to <strong>${escapeHtml(longDateTime(booking.end_time))}</strong> has been cancelled.`)}
        ${paragraph(guestRefundLine(outcome))}
        ${note ? paragraph(`<span style="color:${MUTED};font-size:13px">${escapeHtml(note)}</span>`) : ''}
    </td></tr>
${breakdown}
${carCard({
        captionLabel: 'Cancelled trip',
        car,
        sentAt,
        statsRowHtml: `
                    ${statCell('Trip start', formatBusinessDate(booking.start_time, SHORT_DATE), formatBusinessTime(booking.start_time).toLowerCase())}
                    ${statCell('Trip end', formatBusinessDate(booking.end_time, SHORT_DATE), formatBusinessTime(booking.end_time).toLowerCase())}
                    ${statCell('Refunded', money(outcome.refundAmount), outcome.kind === 'none' ? 'no refund' : 'to your card')}`,
    })}
    <tr><td style="padding:24px 24px 0" align="center">${button(`${SITE_URL}/fleet`, 'Book another trip')}</td></tr>

    <tr><td style="padding:24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${section('Reservation ID', `#${escapeHtml(booking.id.slice(0, 8).toUpperCase())}`)}
            ${section('Pickup location', escapeHtml(booking.pickup_location || 'Home base'))}
        </table>
    </td></tr>
`

    return shell({ bodyRows, footerNote: 'Questions about this cancellation? Just reply to this address.' })
}

function buildGuestText(booking: CancellationEmailRow, outcome: RefundOutcome): string {
    const note = settlementNote(outcome)
    return [
        `Your trip with the ${carName(booking.cars)} has been cancelled.`,
        '',
        guestRefundLine(outcome).replace(/<[^>]+>/g, ''),
        ...(note ? ['', note] : []),
        '',
        `Trip start:  ${longDateTime(booking.start_time)}`,
        `Trip end:    ${longDateTime(booking.end_time)}`,
        `Trip total:  ${money(booking.total_price)}`,
        ...(outcome.kind === 'partial'
            ? [`Fee kept:    ${money(outcome.cancellationFee + outcome.retainedPremium)}`]
            : []),
        `Refunded:    ${money(outcome.refundAmount)}`,
        '',
        `Reservation #${booking.id}`,
    ].join('\n')
}

// ── Send ─────────────────────────────────────────────────────────────────────

/**
 * Sends both cancellation emails, at most once ever, and never throws.
 *
 * Same claim contract as notifyAdminBookingConfirmed: the conditional update on
 * cancel_notified_at is what makes this exactly-once, so a retried cancel or a
 * double-clicked button can't email twice. See the migration.
 *
 * Never throwing is load-bearing here in a way it wasn't for the booking email.
 * By the time this is called the refund has already been issued at Stripe; an
 * exception escaping would surface to the guest as "cancellation failed" for a
 * cancellation that entirely succeeded, and they'd try again.
 */
export async function notifyBookingCanceled(
    supabaseAdmin: SupabaseClient<any, any, any>,
    bookingId: string,
    outcome: RefundOutcome,
): Promise<void> {
    let claimed = false
    try {
        const { data: booking, error } = await supabaseAdmin
            .from('bookings')
            .update({ cancel_notified_at: new Date().toISOString() })
            .eq('id', bookingId)
            .eq('status', 'canceled')
            .is('cancel_notified_at', null)
            .select(CANCELLATION_EMAIL_SELECT)
            .maybeSingle()

        if (error) throw error
        if (!booking) return // already sent, or the row moved on

        claimed = true
        const row = booking as unknown as CancellationEmailRow
        const who = firstName(row.profiles?.full_name ?? null)

        await sendEmail({
            to: ADMIN_RECIPIENT,
            subject: `Bluefin - ${who} has cancelled their trip with your ${carName(row.cars)}`,
            html: buildHostHtml(row, outcome),
            text: buildHostText(row, outcome),
        })

        // Sent second and guarded separately: an off-platform booking may have no
        // email on file, and the owners' copy is the one that must not be lost.
        const guestEmail = row.profiles?.email
        if (guestEmail) {
            await sendEmail({
                to: guestEmail,
                subject: `Your Bluefin trip with the ${carName(row.cars)} has been cancelled`,
                html: buildGuestHtml(row, outcome),
                text: buildGuestText(row, outcome),
            })
        }

        console.log(`[email] cancellation notifications sent for ${bookingId}`)
    } catch (err: any) {
        console.error(`[email] cancellation notification failed for ${bookingId}:`, err?.message || err)

        if (claimed) {
            await supabaseAdmin
                .from('bookings')
                .update({ cancel_notified_at: null })
                .eq('id', bookingId)
                .then(undefined, (e: any) => console.error('[email] failed to release claim:', e?.message))
        }
    }
}

/** Admin-only test trigger, mirroring sendTestBookingEmail. Throws on purpose. */
export async function sendTestCancellationEmail(
    booking: CancellationEmailRow,
    outcome: RefundOutcome,
): Promise<void> {
    const who = firstName(booking.profiles?.full_name ?? null)
    await sendEmail({
        to: ADMIN_RECIPIENT,
        subject: `TEST: Bluefin - ${who} has cancelled their trip with your ${carName(booking.cars)}`,
        html: buildHostHtml(booking, outcome),
        text: buildHostText(booking, outcome),
    })
}