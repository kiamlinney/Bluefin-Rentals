// Owner alerts about the schedule, both sent high-importance to the owners:
//
//   IMPORTANT  a Turo vehicle swap was accepted, and we have to say which car
//              the trip is on now (Turo's email doesn't).
//   URGENT     two trips overlap on the same car.
//
// Only the templates and the send live here. Deciding when to send, and making
// sure each goes out once, is the caller's job: runTuroSync claims a swap on
// turo_bookings.swap_accepted_at, and alertNewOverlaps claims each overlap in
// schedule_overlap_alerts. Both throw on a failed send so the caller can
// release its claim and let the next run try again.

import { sendEmail } from './email'
import {
    ADMIN_RECIPIENT,
    INK,
    LINE,
    MUTED,
    SITE_URL,
    button,
    carName,
    escapeHtml,
    longDateTime,
    paragraph,
    shell,
} from './email-template'

type AlertCar = { year: number; make: string; model: string; license_plate?: string | null }

/** One trip as the owners need to find it: whose, which system, where to open it. */
export type AlertTrip = {
    source: 'booking' | 'turo'
    who: string
    /** "Bluefin #7A6E4F3B" or "Turo #62239424". */
    reference: string
    start_time: string
    end_time: string
    url: string
}

export type AlertOverlap = { car: AlertCar | null; trips: [AlertTrip, AlertTrip] }

const CALENDAR_URL = `${SITE_URL}/admin/calendar`

function carLabel(car: AlertCar | null): string {
    if (!car) return 'an unknown car'
    return car.license_plate ? `${carName(car)} (${car.license_plate})` : carName(car)
}

function heading(text: string, colour: string): string {
    return `<h1 style="margin:0 0 16px;font:700 24px/1.3 Helvetica,Arial,sans-serif;color:${colour};text-align:center">${escapeHtml(text)}</h1>`
}

/** A bordered box with one trip in it, as a table row. */
function tripBox(trip: AlertTrip): string {
    return `
    <tr><td style="padding:12px 24px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:10px">
            <tr><td style="padding:14px 16px;font:400 14px/1.6 Helvetica,Arial,sans-serif;color:${INK}">
                <div style="font:600 15px/1.4 Helvetica,Arial,sans-serif">${escapeHtml(trip.reference)} &middot; ${escapeHtml(trip.who)}</div>
                <div style="color:${MUTED}">${escapeHtml(longDateTime(trip.start_time))}<br>to ${escapeHtml(longDateTime(trip.end_time))}</div>
                <div style="margin-top:6px"><a href="${escapeHtml(trip.url)}" style="color:${INK}">Open ${trip.source === 'turo' ? 'on Turo' : 'reservation'}</a></div>
            </td></tr>
        </table>
    </td></tr>`
}

function tripText(trip: AlertTrip): string {
    return [
        `  ${trip.reference} · ${trip.who}`,
        `  ${longDateTime(trip.start_time)} to ${longDateTime(trip.end_time)}`,
        `  ${trip.url}`,
    ].join('\n')
}

// ── Swap ─────────────────────────────────────────────────────────────────────

export async function sendTuroSwapAlert(trip: AlertTrip, fromCar: AlertCar | null): Promise<void> {
    const subject = `IMPORTANT: Choose replacement car for Turo trip ${trip.reference.replace(/^Turo /, '')}`

    const bodyRows = `
    <tr><td align="center" style="padding:28px 24px 0;text-align:center">
        ${heading('A Turo vehicle swap needs a car', '#b45309')}
        ${paragraph(`<strong>BOMBOCLAT!</strong>`)}
        ${paragraph(`${escapeHtml(trip.who)} accepted the vehicle swap for their trip on the
            <strong>${escapeHtml(carLabel(fromCar))}</strong>. Turo's email doesn't say which car it moved to,
            so the site can't block the right one by itself.`)}
        ${paragraph(`<strong>Choose the car the trip is on now.</strong> Until you do, the site keeps the
            original car blocked and leaves the new one open to bookings.`)}
    </td></tr>
${tripBox(trip)}
    <tr><td style="padding:24px" align="center">${button(CALENDAR_URL, 'Choose the car')}</td></tr>`

    await sendEmail({
        to: ADMIN_RECIPIENT,
        subject,
        priority: 'high',
        html: shell({ bodyRows, footerNote: 'Sent by the Turo sync when Turo emails a swap acceptance.' }),
        text: [
            'A Turo vehicle swap needs a car.',
            '',
            `${trip.who} accepted the vehicle swap for their trip on the ${carLabel(fromCar)}.`,
            "Turo's email doesn't say which car it moved to. Choose the car the trip is on now:",
            "until you do, the site keeps the original car blocked and leaves the new one open.",
            '',
            tripText(trip),
            '',
            `Choose the car: ${CALENDAR_URL}`,
        ].join('\n'),
    })
}

// ── Overlap ──────────────────────────────────────────────────────────────────

export async function sendOverlapAlert(overlaps: AlertOverlap[]): Promise<void> {
    if (overlaps.length === 0) return
    const first = overlaps[0]!
    const subject = overlaps.length === 1
        ? `URGENT: Two trips overlap on the ${carName(first.car)}`
        : `URGENT: ${overlaps.length} trip overlaps on the calendar`

    const blocks = overlaps.map(overlap => `
    <tr><td style="padding:20px 24px 0;font:600 16px/1.4 Helvetica,Arial,sans-serif;color:${INK}">
        ${escapeHtml(carLabel(overlap.car))}
    </td></tr>
${overlap.trips.map(tripBox).join('')}`).join('')

    const bodyRows = `
    <tr><td align="center" style="padding:28px 24px 0;text-align:center">
        ${heading(overlaps.length === 1 ? 'Two trips overlap' : 'Trips overlap', '#b91c1c')}
        ${paragraph(`The same car is booked for two guests at the same time. One of them has to move,
            onto another car or by cancelling, before either trip starts.`)}
    </td></tr>
${blocks}
    <tr><td style="padding:24px" align="center">${button(CALENDAR_URL, 'Open the calendar')}</td></tr>`

    await sendEmail({
        to: ADMIN_RECIPIENT,
        subject,
        priority: 'high',
        html: shell({ bodyRows, footerNote: 'Sent once per overlap, when the Turo sync first sees it.' }),
        text: [
            'The same car is booked for two guests at the same time.',
            'One of them has to move, onto another car or by cancelling, before either trip starts.',
            ...overlaps.flatMap(overlap => ['', carLabel(overlap.car), ...overlap.trips.map(tripText)]),
            '',
            `Calendar: ${CALENDAR_URL}`,
        ].join('\n'),
    })
}
