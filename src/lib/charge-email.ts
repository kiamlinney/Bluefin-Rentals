// Emails about money after checkout: charge receipts, pay links, the deposit
// hold, extensions, and alerts the owners need to act on.
//
// Server-only. Every function here either claims its send in the database first
// (same at-most-once mechanism as notifyAdminBookingConfirmed — the webhook, the
// sweep and the page that just charged a card can all arrive at the same event)
// or is called from a place that has itself just won a conditional update, so it
// can only run once. None of them throw: an email failure must never undo a
// payment, fail a webhook, or stop the sweep.
//
// What each email says is part of the payment record — see
// ImportantFiles/charges-and-invoicing.md and deposit.md.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from './email'
import {
    ADMIN_RECIPIENT,
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
import { chargeKindLabel, chargeTotal, toChargeRow, CHARGE_SELECT, type ChargeRow } from './charges.ts'
import { formatDepositAmount, DEPOSIT_RELEASE_AFTER_HOURS } from './deposit.ts'
import { guestLockboxCode } from './lockbox.server'
import { displayTaxLines } from './tax.ts'

type AdminClient = SupabaseClient<any, any, any>

type EmailBooking = {
    id: string
    car_id: number
    status: string
    start_time: string
    end_time: string
    deposit_waived_at: string | null
    cars: { year: number; make: string; model: string } | null
    profiles: { full_name: string | null; email: string | null; phone: string | null } | null
}

const BOOKING_SELECT =
    'id, car_id, status, start_time, end_time, deposit_waived_at, ' +
    'cars(year, make, model), profiles(full_name, email, phone)'

async function loadBooking(admin: AdminClient, bookingId: string): Promise<EmailBooking | null> {
    const { data } = await admin.from('bookings').select(BOOKING_SELECT).eq('id', bookingId).maybeSingle()
    return (data as unknown as EmailBooking) ?? null
}

type Row = { label: string; value: string }

function render({
    heading,
    intro,
    rows = [],
    action,
    footerNote,
}: {
    heading: string
    intro: string[]
    rows?: Row[]
    action?: { href: string; text: string }
    footerNote: string
}): { html: string; text: string } {
    const bodyRows = `
    <tr><td align="center" style="padding:28px 24px 0;text-align:center">
        <h1 style="margin:0 0 16px;font:700 22px/1.3 Helvetica,Arial,sans-serif;color:#111827;text-align:center">${escapeHtml(heading)}</h1>
        ${intro.map(p => paragraph(escapeHtml(p))).join('')}
    </td></tr>
    ${action ? `<tr><td style="padding:12px 24px 0" align="center">${button(action.href, action.text)}</td></tr>` : ''}
    ${rows.length ? `
    <tr><td style="padding:24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${rows.map(r => section(r.label, escapeHtml(r.value))).join('')}
        </table>
    </td></tr>` : '<tr><td style="padding:12px"></td></tr>'}
`
    const text = [
        heading,
        '',
        ...intro,
        '',
        ...rows.map(r => `${r.label}: ${r.value}`),
        ...(action ? ['', `${action.text}: ${action.href}`] : []),
    ].join('\n')

    return { html: shell({ bodyRows, footerNote }), text }
}

function tripRows(booking: EmailBooking): Row[] {
    return [
        { label: 'Vehicle', value: carName(booking.cars) },
        { label: 'Trip', value: `${longDateTime(booking.start_time)} to ${longDateTime(booking.end_time)}` },
        { label: 'Reservation ID', value: `#${booking.id.slice(0, 8).toUpperCase()}` },
    ]
}

function chargeRows(charge: ChargeRow): Row[] {
    const rows: Row[] = charge.line_items.map(item => ({
        label: item.detail ? `${item.label} (${item.detail})` : item.label,
        value: money(item.amount),
    }))
    for (const tax of displayTaxLines(charge.tax_lines)) rows.push({ label: tax.label, value: money(tax.amount) })
    rows.push({ label: 'Total', value: money(chargeTotal(charge)) })
    return rows
}

async function send(to: string | null | undefined, subject: string, body: { html: string; text: string }) {
    if (!to) {
        console.warn(`[email] no recipient for "${subject}"; skipped`)
        return
    }
    await sendEmail({ to, subject, html: body.html, text: body.text })
}

/**
 * Claims a once-only email column on a charge row. Returns the row if this
 * caller won the claim, null otherwise. `release` puts it back on failure so a
 * later caller can retry.
 */
async function claimChargeEmail(
    admin: AdminClient,
    chargeId: string,
    column: 'receipt_sent_at' | 'action_email_sent_at',
    status: string,
): Promise<{ charge: ChargeRow; release: () => Promise<void> } | null> {
    const { data, error } = await admin
        .from('booking_charges')
        .update({ [column]: new Date().toISOString() })
        .eq('id', chargeId)
        .eq('status', status)
        .is(column, null)
        .select(CHARGE_SELECT)
        .maybeSingle()
    if (error || !data) return null
    return {
        charge: toChargeRow(data),
        release: async () => {
            await admin.from('booking_charges').update({ [column]: null }).eq('id', chargeId)
                .then(undefined, (e: any) => console.error('[email] failed to release claim:', e?.message))
        },
    }
}

// ── Guest receipts ───────────────────────────────────────────────────────────

/** "We charged your card" — every successful charge after checkout, once. */
export async function sendChargeReceiptEmail(admin: AdminClient, chargeId: string): Promise<void> {
    const claim = await claimChargeEmail(admin, chargeId, 'receipt_sent_at', 'succeeded')
    if (!claim) return
    try {
        const { charge } = claim
        if (charge.kind === 'deposit') return // deposits get their own wording
        const booking = await loadBooking(admin, charge.booking_id)
        if (!booking) return
        const label = chargeKindLabel(charge)
        await send(booking.profiles?.email, `Receipt: ${label}, ${money(chargeTotal(charge))} — Bluefin`, render({
            heading: 'Receipt for your trip',
            intro: [
                `Hi ${firstName(booking.profiles?.full_name ?? null)}, we charged ${money(chargeTotal(charge))} to your card on file.`,
                charge.description,
            ],
            rows: [...chargeRows(charge), ...tripRows(booking)],
            action: { href: `${SITE_URL}/trips/${booking.id}/receipt`, text: 'View all receipts' },
            footerNote: 'Questions about a charge? Just reply to this email.',
        }))
    } catch (err: any) {
        console.error(`[email] charge receipt failed for ${chargeId}:`, err?.message || err)
        await claim.release()
    }
}

/**
 * A charge the saved card couldn't pay — declined, or the bank wants the guest
 * to authenticate. The guest gets a link to pay it themselves; the owners are
 * told, because nothing else will tell them.
 */
export async function sendPayLinkEmail(admin: AdminClient, chargeId: string): Promise<void> {
    const claim = await claimChargeEmail(admin, chargeId, 'action_email_sent_at', 'requires_payment')
    if (!claim) return
    try {
        const { charge } = claim
        const booking = await loadBooking(admin, charge.booking_id)
        if (!booking) return
        const payUrl = `${SITE_URL}/trips/${booking.id}/pay/${charge.id}`
        const label = chargeKindLabel(charge)

        await send(booking.profiles?.email, `Payment needed: ${label} — Bluefin`, render({
            heading: 'A payment for your trip needs you',
            intro: [
                `Hi ${firstName(booking.profiles?.full_name ?? null)}, we tried to charge ${money(chargeTotal(charge))} to your card on file for: ${charge.description}`,
                charge.failure_message
                    ? `Your bank said: "${charge.failure_message}"`
                    : 'Your bank needs you to confirm it.',
                'You can pay it securely with the button below, with the same card or a different one.',
            ],
            rows: [...chargeRows(charge), ...tripRows(booking)],
            action: { href: payUrl, text: `Pay ${money(chargeTotal(charge))}` },
            footerNote: 'Questions about this charge? Just reply to this email.',
        }))

        await sendAdminAlert(admin, {
            subject: `Charge needs the guest: ${label} ${money(chargeTotal(charge))}`,
            lines: [
                `The saved card couldn't be charged for "${charge.description}".`,
                charge.failure_message ? `Stripe said: ${charge.failure_message}` : 'The bank asked for authentication.',
                `The guest (${booking.profiles?.full_name ?? 'unknown'}) has been emailed a link to pay it.`,
            ],
            bookingId: booking.id,
        })
    } catch (err: any) {
        console.error(`[email] pay link failed for ${chargeId}:`, err?.message || err)
        await claim.release()
    }
}

/**
 * An owner refunded some or all of a charge made after checkout. Called once,
 * by refundCharge, only after Stripe accepted the refund; a retried request is
 * recognised there and doesn't reach here twice. The owners' reason is for their
 * records and isn't shown to the guest.
 */
export async function sendChargeRefundedEmails(
    admin: AdminClient,
    charge: ChargeRow,
    amount: number,
    reason: string,
): Promise<void> {
    try {
        const booking = await loadBooking(admin, charge.booking_id)
        if (!booking) return
        const label = chargeKindLabel(charge)
        const full = charge.amount_refunded >= charge.amount_captured - 0.005

        await send(booking.profiles?.email, `Refund: ${money(amount)} for ${label.toLowerCase()} — Bluefin`, render({
            heading: full ? 'Your charge has been refunded' : 'Part of your charge has been refunded',
            intro: [
                `Hi ${firstName(booking.profiles?.full_name ?? null)}, we've refunded ${money(amount)} to the card that paid for: ${charge.description}`,
                'Refunds usually appear on your statement within 5–10 business days, depending on your bank.',
            ],
            rows: [
                { label: 'Originally charged', value: money(charge.amount_captured) },
                { label: 'Refunded now', value: money(amount) },
                ...(full ? [] : [{ label: 'Refunded in total', value: money(charge.amount_refunded) }]),
                ...tripRows(booking),
            ],
            action: { href: `${SITE_URL}/trips/${booking.id}/receipt`, text: 'View all receipts' },
            footerNote: 'Questions about this refund? Just reply to this email.',
        }))

        await sendAdminAlert(admin, {
            subject: `Refunded ${money(amount)}: ${label}`,
            lines: [
                `You refunded ${money(amount)} of "${charge.description}" (${money(charge.amount_captured)} charged) to ${booking.profiles?.full_name ?? 'the guest'}.`,
                reason ? `Your note: ${reason}` : 'No note was added.',
                'The guest has been emailed.',
            ],
            bookingId: booking.id,
        })
    } catch (err: any) {
        console.error(`[email] refund notice failed for ${charge.id}:`, err?.message || err)
    }
}

// ── The deposit ──────────────────────────────────────────────────────────────

/** The hold went through. Carries the lockbox code, which it unlocks. */
export async function sendDepositHeldEmail(admin: AdminClient, chargeId: string, renewal: boolean): Promise<void> {
    const claim = await claimChargeEmail(admin, chargeId, 'receipt_sent_at', 'authorized')
    if (!claim) return
    try {
        const { charge } = claim
        const booking = await loadBooking(admin, charge.booking_id)
        if (!booking) return
        const who = firstName(booking.profiles?.full_name ?? null)
        const amount = formatDepositAmount(charge.amount)

        if (renewal) {
            await send(booking.profiles?.email, 'Your security hold was renewed — Bluefin', render({
                heading: 'Your security hold was renewed',
                intro: [
                    `Hi ${who}, card holds expire on their own after a set time, so we've placed a fresh ${amount} hold for the rest of your trip and released the previous one.`,
                    'For a day or two your bank may show both as pending. Only one is ever held; the older one drops off on its own.',
                ],
                rows: tripRows(booking),
                footerNote: 'Questions? Just reply to this email.',
            }))
            return
        }

        const code = await guestLockboxCode(admin, booking)
        await send(booking.profiles?.email, `Your ${carName(booking.cars)} is ready — Bluefin`, render({
            heading: 'Your security hold is placed',
            intro: [
                `Hi ${who}, we've placed a ${amount} security hold on your card for your trip. This is a hold, not a charge: the money stays in your account but is set aside until ${DEPOSIT_RELEASE_AFTER_HOURS} hours after you return the car, when it's released.`,
                code
                    ? `Your lockbox code is (${code}). Enter it into the lock box mounted on the driver side window to get the key.`
                    : 'We will send you the lockbox code before your trip starts.',
            ],
            rows: tripRows(booking),
            action: { href: `${SITE_URL}/trips/${booking.id}`, text: 'View your trip' },
            footerNote: 'Questions about the hold? Just reply to this email.',
        }))
    } catch (err: any) {
        console.error(`[email] deposit held failed for ${chargeId}:`, err?.message || err)
        await claim.release()
    }
}

/**
 * The hold was declined. Sent once per run of failures — the caller decides
 * whether this is the first — to the guest (with the way to fix it) and the
 * owners.
 */
export async function sendDepositDeclinedEmails(admin: AdminClient, chargeId: string, renewal: boolean): Promise<void> {
    const claim = await claimChargeEmail(admin, chargeId, 'action_email_sent_at', 'failed')
    if (!claim) return
    try {
        const { charge } = claim
        const booking = await loadBooking(admin, charge.booking_id)
        if (!booking) return
        const amount = formatDepositAmount(charge.amount)

        await send(booking.profiles?.email, 'Action needed: your security hold — Bluefin', render({
            heading: 'We couldn’t place your security hold',
            intro: [
                `Hi ${firstName(booking.profiles?.full_name ?? null)}, your trip needs a ${amount} security hold on a card, and your bank declined it${charge.failure_message ? `: "${charge.failure_message}"` : '.'}`,
                renewal
                    ? 'This was the renewal of the hold on your ongoing trip.'
                    : 'Your lockbox code will be sent as soon as a hold goes through. We will retry automatically, or you can add a different card now.',
            ],
            rows: tripRows(booking),
            action: { href: `${SITE_URL}/trips/${booking.id}`, text: 'Update your card' },
            footerNote: 'Having trouble? Just reply to this email.',
        }))

        await sendAdminAlert(admin, {
            subject: `Deposit hold declined${renewal ? ' (renewal)' : ''} — ${carName(booking.cars)}`,
            lines: [
                `The ${amount} hold was declined for ${booking.profiles?.full_name ?? 'the guest'}'s trip starting ${longDateTime(booking.start_time)}.`,
                charge.failure_message ? `Stripe said: ${charge.failure_message}` : '',
                renewal
                    ? 'This was a renewal: the previous hold is still in place until it expires.'
                    : 'The lockbox code is being withheld. The sweep retries automatically; you can also waive the deposit on the reservation page.',
            ].filter(Boolean),
            bookingId: booking.id,
        })
    } catch (err: any) {
        console.error(`[email] deposit declined failed for ${chargeId}:`, err?.message || err)
        await claim.release()
    }
}

/** Some or all of the hold was kept. Called once, by the capture that won. */
export async function sendDepositCapturedEmail(admin: AdminClient, charge: ChargeRow, reason: string): Promise<void> {
    try {
        const booking = await loadBooking(admin, charge.booking_id)
        if (!booking) return
        const released = Math.max(0, Math.round((charge.amount - charge.amount_captured) * 100) / 100)
        await send(booking.profiles?.email, `Receipt: ${money(charge.amount_captured)} from your security hold — Bluefin`, render({
            heading: 'We’ve charged part of your security hold',
            intro: [
                `Hi ${firstName(booking.profiles?.full_name ?? null)}, we've charged ${money(charge.amount_captured)} from the ${formatDepositAmount(charge.amount)} security hold on your card.`,
                `Reason: ${reason}`,
                released > 0 ? `The remaining ${money(released)} has been released back to you.` : '',
            ].filter(Boolean),
            rows: [
                { label: 'Charged', value: money(charge.amount_captured) },
                ...tripRows(booking),
            ],
            action: { href: `${SITE_URL}/trips/${booking.id}/receipt`, text: 'View all receipts' },
            footerNote: 'Questions about this charge? Just reply to this email.',
        }))
    } catch (err: any) {
        console.error(`[email] deposit captured failed for ${charge.id}:`, err?.message || err)
    }
}

/** The hold was let go. Called once, by the release that won. */
export async function sendDepositReleasedEmail(admin: AdminClient, charge: ChargeRow): Promise<void> {
    try {
        const booking = await loadBooking(admin, charge.booking_id)
        if (!booking) return
        await send(booking.profiles?.email, 'Your security hold has been released — Bluefin', render({
            heading: 'Your security hold has been released',
            intro: [
                `Hi ${firstName(booking.profiles?.full_name ?? null)}, we've released the ${formatDepositAmount(charge.amount)} hold on your card. Nothing was charged.`,
                'Depending on your bank, it can take a few business days to disappear from your statement.',
            ],
            rows: tripRows(booking),
            footerNote: 'Thanks for renting with Bluefin.',
        }))
    } catch (err: any) {
        console.error(`[email] deposit released failed for ${charge.id}:`, err?.message || err)
    }
}

// ── Extensions ───────────────────────────────────────────────────────────────

type ExtensionEmailRow = {
    id: string
    booking_id: string
    from_end_time: string
    to_end_time: string
    amount: number | string
    status: string
}

export async function sendExtensionEmail(
    admin: AdminClient,
    extension: ExtensionEmailRow,
    event: 'requested' | 'confirmed' | 'declined',
): Promise<void> {
    try {
        const booking = await loadBooking(admin, extension.booking_id)
        if (!booking) return
        const who = booking.profiles?.full_name ?? 'The guest'
        const newEnd = longDateTime(extension.to_end_time)
        const amount = money(extension.amount)

        if (event === 'requested') {
            await sendAdminAlert(admin, {
                subject: `Extension request: ${carName(booking.cars)} to ${newEnd}`,
                lines: [
                    `${who} asked to extend their trip from ${longDateTime(extension.from_end_time)} to ${newEnd}, inside the last hour of the trip, so it needs your answer.`,
                    `Their card is held for ${amount}. Approve to charge it and extend the trip; decline to release it.`,
                ],
                bookingId: booking.id,
            })
            return
        }

        if (event === 'confirmed') {
            await send(booking.profiles?.email, 'Your trip has been extended — Bluefin', render({
                heading: 'Your trip has been extended',
                intro: [
                    `Hi ${firstName(booking.profiles?.full_name ?? null)}, your trip now ends ${newEnd}.`,
                    Number(extension.amount) > 0
                        ? `We charged ${amount} to your card on file for the added time. The receipt is on your trip page.`
                        : 'The added time falls inside a day you already paid for, so there was nothing to charge.',
                ],
                rows: tripRows(booking),
                action: { href: `${SITE_URL}/trips/${booking.id}`, text: 'View your trip' },
                footerNote: 'Questions? Just reply to this email.',
            }))
            await sendAdminAlert(admin, {
                subject: `Trip extended: ${carName(booking.cars)} now returns ${newEnd}`,
                lines: [`${who}'s trip was extended from ${longDateTime(extension.from_end_time)} to ${newEnd} (${amount}).`],
                bookingId: booking.id,
            })
            return
        }

        await send(booking.profiles?.email, 'About your extension request — Bluefin', render({
            heading: 'We couldn’t extend your trip',
            intro: [
                `Hi ${firstName(booking.profiles?.full_name ?? null)}, we weren't able to extend your trip to ${newEnd}. The hold on your card has been released and nothing was charged.`,
                `Your trip still ends ${longDateTime(extension.from_end_time)}.`,
            ],
            rows: tripRows(booking),
            footerNote: 'Questions? Just reply to this email.',
        }))
    } catch (err: any) {
        console.error(`[email] extension ${event} failed for ${extension.id}:`, err?.message || err)
    }
}

// ── Owners ───────────────────────────────────────────────────────────────────

/** A plain alert to the owners. Never throws. */
export async function sendAdminAlert(
    _admin: AdminClient,
    { subject, lines, bookingId }: { subject: string; lines: string[]; bookingId?: string },
): Promise<void> {
    try {
        await send(ADMIN_RECIPIENT, `[Bluefin] ${subject}`, render({
            heading: subject,
            intro: lines,
            action: bookingId
                ? { href: `${SITE_URL}/admin/reservation/${bookingId}`, text: 'Open reservation' }
                : undefined,
            footerNote: 'Sent by the Bluefin payments system.',
        }))
    } catch (err: any) {
        console.error(`[email] admin alert "${subject}" failed:`, err?.message || err)
    }
}