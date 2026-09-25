// The shared building blocks for transactional emails.
//
// ── The two rules that constrain everything here ─────────────────────────────
//
// 1. Tables and inline styles only. Email clients strip <style> blocks, and none
//    of them have flexbox or grid.
//
// 2. Everything is centered, twice. text-align doesn't inherit reliably through
//    table cells in Outlook's Word engine, so each cell restates it — as the
//    `align` attribute (what Word actually honors) and as `text-align` (what
//    everything else honors). Dropping either one leaves some client
//    left-aligned.
//
// Nothing in here knows what a booking is. Anything that reads a booking row
// belongs in the template that owns it.

import { formatBusinessDate, formatBusinessTime } from './dates'

// ── Environment ──────────────────────────────────────────────────────────────

export const ADMIN_RECIPIENT = process.env.ADMIN_NOTIFICATION_EMAIL || 'liamjkinney@gmail.com'

// The server-side origin, deliberately not src/lib/site.ts — that one reads
// import.meta.env and is the client-visible value.
export const SITE_URL = process.env.SITE_URL || 'http://localhost:5173'

// ── Design tokens ────────────────────────────────────────────────────────────

export const INK = '#111827'
export const MUTED = '#6b7280'
export const LINE = '#e5e7eb'
export const ACCENT = '#0f4d1c'
export const PAGE_BG = '#f3f4f6'
export const CARD_BG = '#ffffff'

// ── Formatting ───────────────────────────────────────────────────────────────

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

// Every booking timestamp is a wall-clock time at the Saint Paul lot, and the
// production server's clock is UTC — src/lib/dates.ts is the only correct way
// to render one. Never toLocaleString directly.
export const LONG_DATE: Intl.DateTimeFormatOptions = {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
}
export const SHORT_DATE: Intl.DateTimeFormatOptions = {
    month: 'numeric', day: 'numeric', year: '2-digit',
}

/** "Friday, August 21, 2026, 5:00 PM" — the phrasing in the prose paragraphs. */
export function longDateTime(value: string): string {
    return `${formatBusinessDate(value, LONG_DATE)}, ${formatBusinessTime(value)}`
}

export function money(value: number | string): string {
    return Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function firstName(fullName: string | null): string {
    return fullName?.trim().split(/\s+/)[0] || 'A guest'
}

// Make, then model, then year — the order the business says them in, and the
// order every surface on the site uses. Kept consistent deliberately: "2017
// Honda CR-V" and "Honda CR-V 2017" on different pages read as two different
// listings to someone scanning quickly.
export function carName(
    car: { year: number; make: string; model: string } | null,
): string {
    return car ? `${car.make} ${car.model} ${car.year}` : 'your car'
}

// Gmail proxies every remote image through googleusercontent and caches it
// keyed by the source URL, ignoring cache-control. Car photos live at a stable
// path (car_9/main.PNG), so replacing the file in the bucket does nothing for
// anyone Gmail has already fetched it for — they keep seeing the old photo
// forever. Stamping the send time onto the URL makes each email reference a URL
// no proxy has seen, so the image is always current as of when it was sent.
export function cacheBusted(url: string, token: string): string {
    return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(token)}`
}

// ── Primitives ───────────────────────────────────────────────────────────────

/** The small uppercase caption above a value. */
export function label(text: string): string {
    return `<div style="font:600 11px/1.4 Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};margin:0 0 4px;text-align:center">${escapeHtml(text)}</div>`
}

/** One cell of a three-across stat row. */
export function statCell(name: string, top: string, bottom: string): string {
    // Symmetric padding and an explicit third of the width: right-only padding
    // made the three cells different widths, so their contents didn't line up on
    // a shared center even once each one centered its own text.
    return `
        <td width="33.33%" align="center" style="padding:0 8px;vertical-align:top;text-align:center">
            ${label(name)}
            <div style="font:600 15px/1.4 Helvetica,Arial,sans-serif;color:${INK}">${escapeHtml(top)}</div>
            <div style="font:400 14px/1.4 Helvetica,Arial,sans-serif;color:${MUTED}">${escapeHtml(bottom)}</div>
        </td>`
}

/** A LOCATION / ABOUT THE GUEST block. `bodyHtml` is inserted raw — escape it. */
export function section(name: string, bodyHtml: string): string {
    return `
        <tr><td align="center" style="padding:20px 0;border-top:1px solid ${LINE};text-align:center">
            ${label(name)}
            <div style="font:400 15px/1.6 Helvetica,Arial,sans-serif;color:${INK};text-align:center">${bodyHtml}</div>
        </td></tr>`
}

/** A centered paragraph in the hero block. `bodyHtml` is inserted raw. */
export function paragraph(bodyHtml: string): string {
    return `<p style="margin:0 0 12px;font:400 15px/1.6 Helvetica,Arial,sans-serif;color:${INK};text-align:center">${bodyHtml}</p>`
}

/** The solid pill button. */
export function button(href: string, text: string): string {
    return `
        <a href="${escapeHtml(href)}"
           style="display:inline-block;padding:12px 28px;background:${ACCENT};color:#ffffff;border-radius:8px;font:600 15px/1 Helvetica,Arial,sans-serif;text-decoration:none">
            ${escapeHtml(text)}
        </a>`
}

/**
 * The outer chrome every BlueFin email shares: grey page, white 600px card,
 * green header bar, footer line.
 *
 * `bodyRows` is a run of <tr> elements dropped into the card, so a template
 * writes only the part that differs.
 */
export function shell({ bodyRows, footerNote }: { bodyRows: string; footerNote: string }): string {
    return `<!doctype html>
<html><body style="margin:0;padding:0;background:${PAGE_BG}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${CARD_BG};border-radius:12px;overflow:hidden">

    <tr><td align="center" style="background:${ACCENT};padding:16px 24px;font:700 16px/1.4 Helvetica,Arial,sans-serif;color:#ffffff;text-align:center">Bluefin Rentals</td></tr>
${bodyRows}
    <tr><td align="center" style="padding:0 24px 24px;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:${MUTED};border-top:1px solid ${LINE};padding-top:16px;text-align:center">
        Bluefin Rentals LLC &middot; Saint Paul, MN<br>
        ${escapeHtml(footerNote)}
    </td></tr>

</table>
</td></tr>
</table>
</body></html>`
}

/** The bordered card that holds a car photo and its name. */
export function carCard({
    captionLabel,
    car,
    sentAt,
    statsRowHtml,
}: {
    captionLabel: string
    car: { year: number; make: string; model: string; image_url: string | null } | null
    sentAt: string
    statsRowHtml: string
}): string {
    return `
    <tr><td style="padding:24px 24px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:10px">
            <tr><td align="center" style="padding:16px 16px 0;text-align:center">${label(captionLabel)}</td></tr>
            ${car?.image_url ? `
            <tr><td align="center" style="padding:8px 16px 0;text-align:center">
                <img src="${escapeHtml(cacheBusted(car.image_url, sentAt))}" alt="${escapeHtml(carName(car))}" width="536"
                     style="display:block;width:100%;max-width:536px;height:auto;border-radius:8px;margin:0 auto">
            </td></tr>` : ''}
            <tr><td align="center" style="padding:14px 16px 0;font:600 17px/1.4 Helvetica,Arial,sans-serif;color:${INK};text-align:center">
                ${escapeHtml(carName(car))}
            </td></tr>
            <tr><td style="padding:16px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${statsRowHtml}</tr></table>
            </td></tr>
        </table>
    </td></tr>`
}

export { formatBusinessDate, formatBusinessTime }