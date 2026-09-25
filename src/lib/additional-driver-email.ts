// Tells the owners a guest has added someone else to drive their trip.
//
// No claim column, unlike the booking emails: each add is its own event, so
// "at most once ever" is the wrong guarantee — two drivers added means two
// emails. Never throws, so a Gmail outage can't fail an insert that already
// succeeded.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from './email'
import {
    ADMIN_RECIPIENT,
    INK,
    SITE_URL,
    button,
    carName,
    escapeHtml,
    firstName,
    longDateTime,
    paragraph,
    section,
    shell,
} from './email-template'

type DriverNotificationBooking = {
    id: string
    start_time: string
    end_time: string
    cars: { year: number; make: string; model: string; trim: string | null } | null
    profiles: { full_name: string | null } | null
}

export const DRIVER_EMAIL_SELECT =
    'id, start_time, end_time, cars(year, make, model, trim), profiles(full_name)'

export async function notifyAdminDriverAdded(
    supabaseAdmin: SupabaseClient<any, any, any>,
    bookingId: string,
    driver: { fullName: string; email: string; dateOfBirth: string },
): Promise<void> {
    try {
        const { data, error } = await supabaseAdmin
            .from('bookings')
            .select(DRIVER_EMAIL_SELECT)
            .eq('id', bookingId)
            .single()

        if (error || !data) throw error ?? new Error('Booking not found')

        const booking = data as unknown as DriverNotificationBooking
        const who = firstName(booking.profiles?.full_name ?? null)
        const reservationUrl = `${SITE_URL}/admin/reservation/${booking.id}`

        const bodyRows = `
    <tr><td align="center" style="padding:28px 24px 0;text-align:center">
        <h1 style="margin:0 0 16px;font:700 24px/1.3 Helvetica,Arial,sans-serif;color:${INK};text-align:center">An extra driver was added</h1>
        ${paragraph(`${escapeHtml(who)} added a second driver to their ${escapeHtml(carName(booking.cars))} trip,
            ${escapeHtml(longDateTime(booking.start_time))} to ${escapeHtml(longDateTime(booking.end_time))}.`)}
        ${paragraph('Check their licence at pickup — nothing about this driver has been verified online.')}
    </td></tr>

    <tr><td style="padding:24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${section('Driver', escapeHtml(driver.fullName))}
            ${section('Email', escapeHtml(driver.email))}
            ${section('Date of birth', escapeHtml(driver.dateOfBirth))}
            ${section('Reservation ID', `#${escapeHtml(booking.id.slice(0, 8).toUpperCase())}`)}
        </table>
    </td></tr>

    <tr><td style="padding:0 24px 24px" align="center">${button(reservationUrl, 'View reservation')}</td></tr>
`

        await sendEmail({
            to: ADMIN_RECIPIENT,
            subject: `Bluefin - ${who} added a driver to their ${carName(booking.cars)} trip`,
            html: shell({ bodyRows, footerNote: 'Sent when a guest adds an extra driver.' }),
            text: [
                `${who} added a second driver to their ${carName(booking.cars)} trip.`,
                '',
                `Driver:        ${driver.fullName}`,
                `Email:         ${driver.email}`,
                `Date of birth: ${driver.dateOfBirth}`,
                '',
                `Trip start: ${longDateTime(booking.start_time)}`,
                `Trip end:   ${longDateTime(booking.end_time)}`,
                '',
                'Check their licence at pickup — nothing about this driver has been verified online.',
                '',
                reservationUrl,
            ].join('\n'),
        })
    } catch (err: any) {
        console.error(`[email] driver-added notification failed for ${bookingId}:`, err?.message || err)
    }
}
