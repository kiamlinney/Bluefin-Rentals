// The "trip is booked" email the owners get when a booking is paid for.
//
// The chrome, tokens and primitives live in email-template.ts and are shared
// with cancellation-email.ts — this file owns only what is specific to a
// confirmed booking.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from './email'
import {
    ADMIN_RECIPIENT,
    INK,
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

// The service-role clients this is called with are untyped (see
// getServiceRoleClient in db.ts and the webhook's own createClient), so the
// join shape is described here rather than inferred.
type BookingEmailRow = {
    id: string
    start_time: string
    end_time: string
    total_price: number | string
    pickup_location: string | null
    cars: { year: number; make: string; model: string; trim: string | null; image_url: string | null } | null
    profiles: { full_name: string | null; email: string | null; phone: string | null; num_trips: number | null } | null
}

function buildHtml(booking: BookingEmailRow): string {
    const car = booking.cars
    const guest = booking.profiles
    const who = firstName(guest?.full_name ?? null)
    const reservationUrl = `${SITE_URL}/admin/reservation/${booking.id}`
    const sentAt = String(Date.now())

    const guestLines = [
        escapeHtml(guest?.full_name || who),
        guest?.email
            ? `<a href="mailto:${escapeHtml(guest.email)}" style="color:${ACCENT}">${escapeHtml(guest.email)}</a>`
            : null,
        guest?.phone ? escapeHtml(guest.phone) : null,
        `${guest?.num_trips ?? 0} ${guest?.num_trips === 1 ? 'trip' : 'trips'} with BlueFin`,
    ].filter(Boolean).join('<br>')

    const bodyRows = `
    <tr><td align="center" style="padding:28px 24px 0;text-align:center">
        <h1 style="margin:0 0 16px;font:700 24px/1.3 Helvetica,Arial,sans-serif;color:${INK};text-align:center">${escapeHtml(who)}'s trip is booked</h1>
        ${paragraph(`Yippie! ${escapeHtml(who)}'s trip with your ${escapeHtml(carName(car))} is booked from
            <strong>${escapeHtml(longDateTime(booking.start_time))}</strong> to <strong>${escapeHtml(longDateTime(booking.end_time))}.</strong>`)}
        ${paragraph(`Location: <strong>${escapeHtml(booking.pickup_location || 'Home base')}</strong>.`)}
        ${paragraph(`Total: <strong>${escapeHtml(money(booking.total_price))}</strong>.`)}
    </td></tr>
${carCard({
        captionLabel: 'Booked trip',
        car,
        sentAt,
        statsRowHtml: `
                    ${statCell('Trip start', formatBusinessDate(booking.start_time, SHORT_DATE), formatBusinessTime(booking.start_time).toLowerCase())}
                    ${statCell('Trip end', formatBusinessDate(booking.end_time, SHORT_DATE), formatBusinessTime(booking.end_time).toLowerCase())}
                    ${statCell('You earn', money(booking.total_price), 'paid in full')}`,
    })}
    <tr><td style="padding:24px 24px 0" align="center">${button(reservationUrl, 'View reservation')}</td></tr>

    <tr><td style="padding:24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${section('Reservation ID', `#${escapeHtml(booking.id.slice(0, 8).toUpperCase())}`)}
            ${section('Location', escapeHtml(booking.pickup_location || 'Home base'))}
            ${section('About the guest', guestLines)}
        </table>
    </td></tr>
`

    return shell({ bodyRows, footerNote: 'Sent automatically when a booking is paid for.' })
}

function buildText(booking: BookingEmailRow): string {
    const who = firstName(booking.profiles?.full_name ?? null)
    const guest = booking.profiles

    return [
        `${who}'s trip with your ${carName(booking.cars)} is booked.`,
        '',
        `Trip start:  ${longDateTime(booking.start_time)}`,
        `Trip end:    ${longDateTime(booking.end_time)}`,
        `You earn:    ${money(booking.total_price)}`,
        `Location:    ${booking.pickup_location || 'Home base'}`,
        '',
        'Guest',
        `  ${guest?.full_name || who}`,
        `  ${guest?.email || 'no email on file'}`,
        `  ${guest?.phone || 'no phone on file'}`,
        `  ${guest?.num_trips ?? 0} trips with BlueFin`,
        '',
        `Reservation #${booking.id}`,
        `${SITE_URL}/admin/reservation/${booking.id}`,
    ].join('\n')
}

/**
 * Exported for the admin test trigger, which re-sends an already-sent email.
 *
 * `isTest` gates the subject prefix.
 */
export async function sendBookingConfirmedEmail(
    booking: BookingEmailRow,
    { isTest = true }: { isTest?: boolean } = {},
): Promise<void> {
    const who = firstName(booking.profiles?.full_name ?? null)
    await sendEmail({
        to: ADMIN_RECIPIENT,
        subject: `${isTest ? 'TEST: ' : ''}BlueFin - ${who}'s trip with your ${carName(booking.cars)} is booked!`,
        html: buildHtml(booking),
        text: buildText(booking),
    })
}

export const BOOKING_EMAIL_SELECT =
    'id, start_time, end_time, total_price, pickup_location, ' +
    'cars(year, make, model, trim, image_url), ' +
    'profiles(full_name, email, phone, num_trips)'

/**
 * Sends the admin email for a booking, at most once ever.
 *
 * Three paths confirm a booking (both Stripe webhook events plus the
 * confirmBooking fallback) and Stripe retries webhooks, so all of them call
 * this and the database decides who actually sends: the update below only
 * matches a row whose admin_notified_at is still null, so exactly one caller
 * gets a row back. See the migration for the full reasoning.
 *
 * Never throws. A failed email must not un-confirm a paid booking or make
 * Stripe retry the webhook — it releases the claim and gives up.
 */
export async function notifyAdminBookingConfirmed(
    supabaseAdmin: SupabaseClient<any, any, any>,
    bookingId: string,
): Promise<void> {
    let claimed = false
    try {
        const { data: booking, error } = await supabaseAdmin
            .from('bookings')
            .update({ admin_notified_at: new Date().toISOString() })
            .eq('id', bookingId)
            .eq('status', 'confirmed')
            .is('admin_notified_at', null)
            .select(BOOKING_EMAIL_SELECT)
            .maybeSingle()

        if (error) throw error
        if (!booking) return // already claimed by another path, or not confirmed

        claimed = true
        await sendBookingConfirmedEmail(booking as unknown as BookingEmailRow)
        console.log(`[email] admin booking notification sent for ${bookingId}`)
    } catch (err: any) {
        console.error(`[email] admin booking notification failed for ${bookingId}:`, err?.message || err)

        if (claimed) {
            // Release the claim so a later confirmation path can retry.
            await supabaseAdmin
                .from('bookings')
                .update({ admin_notified_at: null })
                .eq('id', bookingId)
                .then(undefined, (e: any) => console.error('[email] failed to release claim:', e?.message))
        }
    }
}