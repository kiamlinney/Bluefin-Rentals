// A guest asking for extras on a trip they've already paid for.
//
// The request is recorded before this sends — a 'requested' row in
// booking_extras, waiting on the reservation page with Approve / Decline. This
// email is the nudge to go and answer it; the page is the record. No claim
// column, because each request is its own event rather than a once-ever
// notification.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from './email'
import type { QuoteExtra } from './extras'
import {
    ADMIN_RECIPIENT,
    INK,
    SITE_URL,
    button,
    carName,
    escapeHtml,
    firstName,
    longDateTime,
    money,
    paragraph,
    section,
    shell,
} from './email-template'

type ExtrasRequestBooking = {
    id: string
    start_time: string
    end_time: string
    cars: { year: number; make: string; model: string; trim: string | null } | null
    profiles: { full_name: string | null; email: string | null; phone: string | null } | null
}

export const EXTRAS_REQUEST_SELECT =
    'id, start_time, end_time, cars(year, make, model, trim), profiles(full_name, email, phone)'

export async function sendExtrasRequestedEmail(
    supabaseAdmin: SupabaseClient<any, any, any>,
    bookingId: string,
    extras: QuoteExtra[],
    message: string | null,
): Promise<void> {
    const { data, error } = await supabaseAdmin
        .from('bookings')
        .select(EXTRAS_REQUEST_SELECT)
        .eq('id', bookingId)
        .single()

    if (error || !data) throw new Error('Booking not found')

    const booking = data as unknown as ExtrasRequestBooking
    const who = firstName(booking.profiles?.full_name ?? null)
    const reservationUrl = `${SITE_URL}/admin/reservation/${booking.id}`

    const estimated = extras.reduce((sum, extra) => sum + extra.amount, 0)

    const extraRows = extras
        .map(extra => section(
            extra.billing === 'per-day'
                ? `${escapeHtml(extra.name)} (${extra.quantity} × ${escapeHtml(money(extra.unitPrice))})`
                : escapeHtml(extra.name),
            escapeHtml(money(extra.amount)),
        ))
        .join('')

    const bodyRows = `
    <tr><td align="center" style="padding:28px 24px 0;text-align:center">
        <h1 style="margin:0 0 16px;font:700 24px/1.3 Helvetica,Arial,sans-serif;color:${INK};text-align:center">${escapeHtml(who)} asked for extras</h1>
        ${paragraph(`For their ${escapeHtml(carName(booking.cars))} trip,
            ${escapeHtml(longDateTime(booking.start_time))} to ${escapeHtml(longDateTime(booking.end_time))}.`)}
        ${paragraph('<strong>Nothing has been charged and nothing is on the trip yet.</strong> Approve or decline it on the reservation page; if you approve, collect it at pickup.')}
    </td></tr>

    <tr><td style="padding:24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${extraRows}
            ${section('If approved', escapeHtml(money(estimated)))}
            ${message ? section('Their message', escapeHtml(message)) : ''}
            ${section('Reply to', escapeHtml(booking.profiles?.email || 'no email on file'))}
            ${section('Reservation ID', `#${escapeHtml(booking.id.slice(0, 8).toUpperCase())}`)}
        </table>
    </td></tr>

    <tr><td style="padding:0 24px 24px" align="center">${button(reservationUrl, 'Approve or decline')}</td></tr>
`

    await sendEmail({
        to: ADMIN_RECIPIENT,
        subject: `Bluefin - ${who} asked for extras on their ${carName(booking.cars)} trip`,
        // So a reply goes to the guest rather than into the void.
        replyTo: booking.profiles?.email || undefined,
        html: shell({ bodyRows, footerNote: 'Sent when a guest asks for extras after booking.' }),
        text: [
            `${who} asked for extras on their ${carName(booking.cars)} trip.`,
            'Nothing has been charged and nothing is on the trip yet.',
            'Approve or decline it on the reservation page; if you approve, collect it at pickup.',
            '',
            ...extras.map(e => `  ${e.name}${e.billing === 'per-day' ? ` (${e.quantity} x ${money(e.unitPrice)})` : ''}  ${money(e.amount)}`),
            `  If approved: ${money(estimated)}`,
            '',
            message ? `Their message:\n  ${message}\n` : '',
            `Trip start: ${longDateTime(booking.start_time)}`,
            `Trip end:   ${longDateTime(booking.end_time)}`,
            `Reply to:   ${booking.profiles?.email || 'no email on file'}`,
            '',
            reservationUrl,
        ].join('\n'),
    })
}
