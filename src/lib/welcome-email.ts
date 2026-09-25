// The "your trip is booked" email the guest gets when their payment clears.
//
// Counterpart to booking-email.ts, which tells the owners. Same chrome and the
// same at-most-once claim mechanism, a different recipient and different prose:
// this one is arrival instructions, not a sales notification.
//
// Server-only. It reads car_secrets, which no client role can see.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from './email'
import { buildWelcomeMessage, welcomeMessageText } from './welcome-message'
import {
    INK,
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
} from './email-template'

// Untyped service-role clients, same as booking-email.ts — the join shape is
// described here rather than inferred.
type WelcomeEmailRow = {
    id: string
    car_id: number
    start_time: string
    end_time: string
    total_price: number | string
    pickup_location: string | null
    cars: { year: number; make: string; model: string; trim: string | null; image_url: string | null } | null
    profiles: { full_name: string | null; email: string | null } | null
}

export const WELCOME_EMAIL_SELECT =
    'id, car_id, start_time, end_time, total_price, pickup_location, ' +
    'cars(year, make, model, trim, image_url), ' +
    'profiles(full_name, email)'

function buildHtml(booking: WelcomeEmailRow, lockboxCode: string | null): string {
    const car = booking.cars
    const who = firstName(booking.profiles?.full_name ?? null)
    const tripUrl = `${SITE_URL}/trips/${booking.id}`
    const sentAt = String(Date.now())

    const message = buildWelcomeMessage({ guestFirstName: who, lockboxCode })

    // The message is rendered as its own quoted block rather than as loose
    // paragraphs, so it reads as a note from a person — which is what it was
    // when it was sent by hand through Turo — instead of as system output.
    const messageHtml = message.paragraphs
        .map(line => `<p style="margin:0 0 10px;font:400 15px/1.55 Helvetica,Arial,sans-serif;color:${INK}">${escapeHtml(line)}</p>`)
        .join('')

    const bodyRows = `
    <tr><td align="center" style="padding:28px 24px 0;text-align:center">
        <h1 style="margin:0 0 16px;font:700 24px/1.3 Helvetica,Arial,sans-serif;color:${INK};text-align:center">Your trip is booked</h1>
        ${paragraph(`Your ${escapeHtml(carName(car))} is reserved from
            <strong>${escapeHtml(longDateTime(booking.start_time))}</strong> to <strong>${escapeHtml(longDateTime(booking.end_time))}.</strong>`)}
    </td></tr>
${carCard({
        captionLabel: 'Booked trip',
        car,
        sentAt,
        statsRowHtml: `
                    ${statCell('Trip start', formatBusinessDate(booking.start_time, SHORT_DATE), formatBusinessTime(booking.start_time).toLowerCase())}
                    ${statCell('Trip end', formatBusinessDate(booking.end_time, SHORT_DATE), formatBusinessTime(booking.end_time).toLowerCase())}
                    ${statCell('Total paid', money(booking.total_price), 'paid in full')}`,
    })}

    <tr><td style="padding:24px 24px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="border:1px solid #e5e7eb;border-radius:12px">
            <tr><td style="padding:18px 20px">
                ${messageHtml}
                <p style="margin:14px 0 0;font:400 15px/1.55 Helvetica,Arial,sans-serif;color:${MUTED}">${escapeHtml(message.signoff)}</p>
            </td></tr>
        </table>
    </td></tr>

    <tr><td style="padding:24px 24px 0" align="center">${button(tripUrl, 'View your trip')}</td></tr>

    <tr><td style="padding:24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${section('Reservation ID', `#${escapeHtml(booking.id.slice(0, 8).toUpperCase())}`)}
            ${section('Pickup location', escapeHtml(booking.pickup_location || 'Home base'))}
        </table>
    </td></tr>
`

    return shell({
        bodyRows,
        footerNote: 'Questions about your trip? Just reply to this email.',
    })
}

function buildText(booking: WelcomeEmailRow, lockboxCode: string | null): string {
    const who = firstName(booking.profiles?.full_name ?? null)
    const message = buildWelcomeMessage({ guestFirstName: who, lockboxCode })

    return [
        `Your ${carName(booking.cars)} is booked.`,
        '',
        `Trip start:  ${longDateTime(booking.start_time)}`,
        `Trip end:    ${longDateTime(booking.end_time)}`,
        `Pickup:      ${booking.pickup_location || 'Home base'}`,
        `Total paid:  ${money(booking.total_price)}`,
        '',
        welcomeMessageText(message),
        '',
        `Reservation #${booking.id}`,
        `${SITE_URL}/trips/${booking.id}`,
    ].join('\n')
}

/** Reads the car's current lockbox code. Never throws — a missing code sends a
 *  message without one, which is better than sending nothing. */
export async function lockboxCodeForCar(
    supabaseAdmin: SupabaseClient<any, any, any>,
    carId: number,
): Promise<string | null> {
    try {
        const { data } = await supabaseAdmin
            .from('car_secrets')
            .select('lockbox_code')
            .eq('car_id', carId)
            .maybeSingle()
        return (data?.lockbox_code as string | null) ?? null
    } catch (err: any) {
        console.error('[email] could not read lockbox code:', err?.message || err)
        return null
    }
}

/**
 * Exported for the admin test trigger, which re-sends an already-sent email.
 *
 * `isTest` gates the subject prefix.
 */
export async function sendWelcomeEmail(
    booking: WelcomeEmailRow,
    lockboxCode: string | null,
    { isTest = true }: { isTest?: boolean } = {},
): Promise<void> {
    const to = booking.profiles?.email
    if (!to) {
        // Nothing to do and nothing to retry. Logged rather than thrown so a
        // profile with no email can't make Stripe retry the webhook forever.
        console.warn(`[email] no guest email on booking ${booking.id}; welcome email skipped`)
        return
    }

    await sendEmail({
        to,
        subject: `${isTest ? 'TEST: ' : ''}Your ${carName(booking.cars)} is booked — Bluefin Rentals`,
        html: buildHtml(booking, lockboxCode),
        text: buildText(booking, lockboxCode),
    })
}

/**
 * Sends the guest welcome email for a booking, at most once ever.
 *
 * Exactly the shape of notifyAdminBookingConfirmed, with guest_notified_at as
 * the claim column: three paths confirm a booking and Stripe retries webhooks,
 * so all of them call this and the database decides who actually sends. The
 * update below only matches a row whose guest_notified_at is still null, so one
 * caller gets a row back and the rest no-op.
 *
 * Never throws. A failed email must not un-confirm a paid booking or make
 * Stripe retry the webhook — it releases the claim and gives up.
 */
export async function notifyGuestBookingConfirmed(
    supabaseAdmin: SupabaseClient<any, any, any>,
    bookingId: string,
): Promise<void> {
    let claimed = false
    try {
        const { data: booking, error } = await supabaseAdmin
            .from('bookings')
            .update({ guest_notified_at: new Date().toISOString() })
            .eq('id', bookingId)
            .eq('status', 'confirmed')
            .is('guest_notified_at', null)
            .select(WELCOME_EMAIL_SELECT)
            .maybeSingle()

        if (error) throw error
        if (!booking) return // already claimed by another path, or not confirmed

        claimed = true
        const row = booking as unknown as WelcomeEmailRow
        const lockboxCode = await lockboxCodeForCar(supabaseAdmin, row.car_id)
        await sendWelcomeEmail(row, lockboxCode, { isTest: false })
        console.log(`[email] guest welcome email sent for ${bookingId}`)
    } catch (err: any) {
        console.error(`[email] guest welcome email failed for ${bookingId}:`, err?.message || err)

        if (claimed) {
            // Release the claim so a later confirmation path can retry.
            await supabaseAdmin
                .from('bookings')
                .update({ guest_notified_at: null })
                .eq('id', bookingId)
                .then(undefined, (e: any) => console.error('[email] failed to release claim:', e?.message))
        }
    }
}
