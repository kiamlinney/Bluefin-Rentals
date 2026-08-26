// The "trip is booked" email the owners get when a booking is paid for.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from './email'
import { formatBusinessDate, formatBusinessTime } from './dates'

const ADMIN_RECIPIENT = process.env.ADMIN_NOTIFICATION_EMAIL || 'liamjkinney@gmail.com'
const SITE_URL = process.env.SITE_URL || 'http://localhost:5173'

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

// ── Formatting helpers ───────────────────────────────────────────────────────

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

// Every booking timestamp is a wall-clock time at the Saint Paul lot, and the
// production server's clock is UTC — src/lib/dates.ts is the only correct way
// to render one. Never toLocaleString directly.
const LONG_DATE: Intl.DateTimeFormatOptions = {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
}
const SHORT_DATE: Intl.DateTimeFormatOptions = {
    month: 'numeric', day: 'numeric', year: '2-digit',
}

/** "Friday, August 21, 2026, 5:00 PM" — the phrasing in the prose paragraph. */
function longDateTime(value: string): string {
    return `${formatBusinessDate(value, LONG_DATE)}, ${formatBusinessTime(value)}`
}

function money(value: number | string): string {
    return Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function firstName(fullName: string | null): string {
    return fullName?.trim().split(/\s+/)[0] || 'A guest'
}

function carName(car: BookingEmailRow['cars']): string {
    return car ? `${car.year} ${car.make} ${car.model}` : 'your car'
}

// Gmail proxies every remote image through googleusercontent and caches it
// keyed by the source URL, ignoring cache-control. Car photos live at a stable
// path (car_9/main.PNG), so replacing the file in the bucket does nothing for
// anyone Gmail has already fetched it for — they keep seeing the old photo
// forever. Stamping the send time onto the URL makes each email reference a URL
// no proxy has seen, so the image is always current as of when it was sent.
function cacheBusted(url: string, token: string): string {
    return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(token)}`
}

// ── Template ─────────────────────────────────────────────────────────────────

// Tables and inline styles throughout: email clients strip <style> blocks and
// none of them have flexbox or grid.
const INK = '#111827'
const MUTED = '#6b7280'
const LINE = '#e5e7eb'
const ACCENT = '#0f4d1c'//'#152110'//'#0f4c81'

// Everything in this email is centered. text-align doesn't inherit reliably
// through table cells in Outlook's Word engine, so each cell restates it — as
// the align attribute (what Word actually honors) and as text-align (what
// everything else honors). Dropping either one leaves some client left-aligned.
function label(text: string): string {
    return `<div style="font:600 11px/1.4 Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};margin:0 0 4px;text-align:center">${escapeHtml(text)}</div>`
}

/** One cell of the TRIP START / TRIP END / YOU EARN row. */
function statCell(name: string, top: string, bottom: string): string {
    // Symmetric padding and an explicit third of the width: the old right-only
    // padding made the three cells different widths, so their contents didn't
    // line up on a shared center even once each one centered its own text.
    return `
        <td width="33.33%" align="center" style="padding:0 8px;vertical-align:top;text-align:center">
            ${label(name)}
            <div style="font:600 15px/1.4 Helvetica,Arial,sans-serif;color:${INK}">${escapeHtml(top)}</div>
            <div style="font:400 14px/1.4 Helvetica,Arial,sans-serif;color:${MUTED}">${escapeHtml(bottom)}</div>
        </td>`
}

/** A LOCATION / ABOUT THE GUEST block. */
function section(name: string, bodyHtml: string): string {
    return `
        <tr><td align="center" style="padding:20px 0;border-top:1px solid ${LINE};text-align:center">
            ${label(name)}
            <div style="font:400 15px/1.6 Helvetica,Arial,sans-serif;color:${INK};text-align:center">${bodyHtml}</div>
        </td></tr>`
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

    return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">

    <tr><td align="center" style="background:${ACCENT};padding:16px 24px;font:700 16px/1.4 Helvetica,Arial,sans-serif;color:#ffffff;text-align:center">BlueFin Rentals</td></tr>

    <tr><td align="center" style="padding:28px 24px 0;text-align:center">
        <h1 style="margin:0 0 16px;font:700 24px/1.3 Helvetica,Arial,sans-serif;color:${INK};text-align:center">${escapeHtml(who)}'s trip is booked</h1>
        <p style="margin:0 0 12px;font:400 15px/1.6 Helvetica,Arial,sans-serif;color:${INK};text-align:center">
            Yippie! ${escapeHtml(who)}'s trip with your ${escapeHtml(carName(car))} is booked from
            <strong>${escapeHtml(longDateTime(booking.start_time))}</strong> to <strong>${escapeHtml(longDateTime(booking.end_time))}.</strong>
        </p>
        <p style="margin:0 0 12px;font:400 15px/1.6 Helvetica,Arial,sans-serif;color:${INK};text-align:center">
            Location: <strong>${ escapeHtml(booking.pickup_location || 'Home base')}</strong>.
        </p>
        <p style="margin:0 0 12px;font:400 15px/1.6 Helvetica,Arial,sans-serif;color:${INK};text-align:center">
            Total: <strong>${escapeHtml(money(booking.total_price))}</strong>.
        </p>
    </td></tr>

    <tr><td style="padding:24px 24px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:10px">
            <tr><td align="center" style="padding:16px 16px 0;text-align:center">${label('Booked trip')}</td></tr>
            ${car?.image_url ? `
            <tr><td align="center" style="padding:8px 16px 0;text-align:center">
                <img src="${escapeHtml(cacheBusted(car.image_url, sentAt))}" alt="${escapeHtml(carName(car))}" width="536"
                     style="display:block;width:100%;max-width:536px;height:auto;border-radius:8px;margin:0 auto">
            </td></tr>` : ''}
            <tr><td align="center" style="padding:14px 16px 0;font:600 17px/1.4 Helvetica,Arial,sans-serif;color:${INK};text-align:center">
                ${escapeHtml(carName(car))}
            </td></tr>
            <tr><td style="padding:16px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                    ${statCell('Trip start', formatBusinessDate(booking.start_time, SHORT_DATE), formatBusinessTime(booking.start_time).toLowerCase())}
                    ${statCell('Trip end', formatBusinessDate(booking.end_time, SHORT_DATE), formatBusinessTime(booking.end_time).toLowerCase())}
                    ${statCell('You earn', money(booking.total_price), 'paid in full')}
                </tr></table>
            </td></tr>
        </table>
    </td></tr>

    <tr><td style="padding:24px 24px 0" align="center">
        <a href="${escapeHtml(reservationUrl)}"
           style="display:inline-block;padding:12px 28px;background:${ACCENT};color:#ffffff;border-radius:8px;font:600 15px/1 Helvetica,Arial,sans-serif;text-decoration:none">
            View reservation
        </a>
    </td></tr>

    <tr><td style="padding:24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${section('Reservation ID', `#${escapeHtml(booking.id.slice(0,8).toUpperCase())}`)}
            ${section('Location', escapeHtml(booking.pickup_location || 'Home base'))}
            ${section('About the guest', guestLines)}
        </table>
    </td></tr>

    <tr><td align="center" style="padding:0 24px 24px;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:${MUTED};border-top:1px solid ${LINE};padding-top:16px;text-align:center">
        BlueFin Rentals LLC &middot; Saint Paul, MN<br>
        Sent automatically when a booking is paid for.
    </td></tr>

</table>
</td></tr>
</table>
</body></html>`
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

/** Exported for the admin test trigger, which re-sends an already-sent email. */
export async function sendBookingConfirmedEmail(booking: BookingEmailRow): Promise<void> {
    await sendEmail({
        to: ADMIN_RECIPIENT,
        subject: `TEST: BlueFin - ${firstName(booking.profiles?.full_name ?? null)}'s trip with your ${carName(booking.cars)} is booked!`,
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