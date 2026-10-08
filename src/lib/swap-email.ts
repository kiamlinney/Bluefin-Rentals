// "Your trip's vehicle has changed" — sent to the guest when an owner swaps
// the car on a booked trip (vehicle-swap.server.ts).
//
// No claim column: each swap is its own event, and the conditional update that
// performs the swap already stops one from happening twice.
//
// Server-only. It reads car_secrets through the deposit gate, because the old
// car's lockbox code no longer opens anything the guest is driving.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from './email'
import { guestLockboxCode } from './lockbox.server'
import { CONTACT_PHONE } from './business'
import type { SwapCar } from './vehicle-swap'
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
    paragraph,
    section,
    shell,
    statCell,
} from './email-template'

type SwapEmailRow = {
    id: string
    car_id: number
    status: string
    start_time: string
    end_time: string
    pickup_location: string | null
    deposit_waived_at: string | null
    cars: { year: number; make: string; model: string; trim: string | null; image_url: string | null } | null
    profiles: { full_name: string | null; email: string | null } | null
}

const SWAP_EMAIL_SELECT =
    'id, car_id, status, start_time, end_time, pickup_location, deposit_waived_at, ' +
    'cars(year, make, model, trim, image_url), profiles(full_name, email)'

// Said in the email because a same-day trip's welcome email already carried
// the old car's code. Without a code, the "hold placed" email brings it — that
// one reads the booking's car when it sends, so it will be the new car's.
function lockboxLine(code: string | null): string {
    return code
        ? `The lockbox code for your new car is ${code}. It replaces any code we sent you before.`
        : 'We will send you the lockbox code for your new car before your trip starts.'
}

function buildHtml(booking: SwapEmailRow, fromCar: SwapCar | null, reason: string, code: string | null): string {
    const who = firstName(booking.profiles?.full_name ?? null)
    const tripUrl = `${SITE_URL}/trips/${booking.id}`

    const bodyRows = `
    <tr><td align="center" style="padding:28px 24px 0;text-align:center">
        <h1 style="margin:0 0 16px;font:700 24px/1.3 Helvetica,Arial,sans-serif;color:${INK};text-align:center">Your trip's vehicle has changed</h1>
        ${paragraph(`Hi ${escapeHtml(who)}, we've moved your trip
            ${fromCar ? `from the <strong>${escapeHtml(carName(fromCar))}</strong> ` : ''}to the
            <strong>${escapeHtml(carName(booking.cars))}</strong>. Your dates, pickup and price stay the same. We appreciate your flexibility!`)}
    </td></tr>
${carCard({
        captionLabel: 'Your new vehicle',
        car: booking.cars,
        sentAt: String(Date.now()),
        statsRowHtml: `
                    ${statCell('Trip start', formatBusinessDate(booking.start_time, SHORT_DATE), formatBusinessTime(booking.start_time).toLowerCase())}
                    ${statCell('Trip end', formatBusinessDate(booking.end_time, SHORT_DATE), formatBusinessTime(booking.end_time).toLowerCase())}
                    ${statCell('Price', 'Unchanged', 'nothing to pay')}`,
    })}

    <tr><td style="padding:24px 24px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="border:1px solid #e5e7eb;border-radius:12px">
            <tr><td style="padding:18px 20px">
                <p style="margin:0 0 6px;font:600 11px/1.4 Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">Why we changed it</p>
                <p style="margin:0;font:400 15px/1.55 Helvetica,Arial,sans-serif;color:${INK};white-space:pre-line">${escapeHtml(reason)}</p>
            </td></tr>
        </table>
    </td></tr>

    <tr><td style="padding:24px 24px 0" align="center">${button(tripUrl, 'View your trip')}</td></tr>

    <tr><td style="padding:24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${section('Lockbox', escapeHtml(lockboxLine(code)))}
            ${section('Pickup location', escapeHtml(booking.pickup_location || 'Home base'))}
            ${section('Reservation ID', `#${escapeHtml(booking.id.slice(0, 8).toUpperCase())}`)}
        </table>
    </td></tr>
`

    return shell({
        bodyRows,
        footerNote: `If the new car doesn't work for you, reply to this email or call us at ${CONTACT_PHONE}.`,
    })
}

function buildText(booking: SwapEmailRow, fromCar: SwapCar | null, reason: string, code: string | null): string {
    const who = firstName(booking.profiles?.full_name ?? null)
    return [
        `Hi ${who}, your trip's vehicle has changed.`,
        '',
        fromCar ? `Was:          ${carName(fromCar)}` : '',
        `Now:          ${carName(booking.cars)}`,
        `Trip start:   ${longDateTime(booking.start_time)}`,
        `Trip end:     ${longDateTime(booking.end_time)}`,
        `Pickup:       ${booking.pickup_location || 'Home base'}`,
        'Your dates, pickup and price stay the same.',
        '',
        'Why we changed it:',
        reason,
        '',
        lockboxLine(code),
        '',
        `If the new car doesn't work for you, reply to this email or call us at ${CONTACT_PHONE}.`,
        '',
        `Reservation #${booking.id}`,
        `${SITE_URL}/trips/${booking.id}`,
    ].filter((line, i, lines) => line !== '' || lines[i - 1] !== '').join('\n')
}

/**
 * Emails the guest about a swap that has already been made. Returns false when
 * there was nobody to send to; throws if the send itself failed.
 */
export async function sendVehicleSwapEmail(
    supabaseAdmin: SupabaseClient<any, any, any>,
    bookingId: string,
    fromCar: SwapCar | null,
    reason: string,
): Promise<boolean> {
    const { data, error } = await supabaseAdmin
        .from('bookings')
        .select(SWAP_EMAIL_SELECT)
        .eq('id', bookingId)
        .single()
    if (error || !data) throw new Error('Booking not found')

    const booking = data as unknown as SwapEmailRow
    const to = booking.profiles?.email
    if (!to) {
        console.warn(`[email] no guest email on booking ${bookingId}; vehicle swap email skipped`)
        return false
    }

    // Through the deposit gate, like every other place a guest is given a
    // code — and read off the booking's car now, which is the new one.
    const code = await guestLockboxCode(supabaseAdmin, booking)

    await sendEmail({
        to,
        subject: `Bluefin - Your trip's vehicle has changed to a ${carName(booking.cars)}`,
        html: buildHtml(booking, fromCar, reason, code),
        text: buildText(booking, fromCar, reason, code),
    })
    console.log(`[email] vehicle swap email sent for ${bookingId}`)
    return true
}
