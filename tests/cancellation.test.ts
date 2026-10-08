// Cancelling a trip, end to end: cancelBooking (db.ts) → completeCancellation →
// settleLedgerOnCancellation (payments.server.ts) → the emails, against a fake
// Stripe and database. ImportantFiles/cancellation-and-refunds.md is the spec.

import { describe, expect, it } from 'vitest'
import { h, at, signIn, emailsTo, ADMIN_EMAIL } from './harness'
import {
    world, paidTrip, unpaidCheckout, paidCharge, paidExtension, depositHold, depositAwaiting3ds,
    extraRequest, extensionRequest, chargeRow, bookingRow, GUEST, OTHER_GUEST, ADMIN, GUEST_EMAIL,
} from './fixtures'
import { cancelBooking, previewCancellation } from '../src/lib/db'
import { runPaymentsSweep } from '../src/lib/payments.server'
import { refundForCancellation } from '../src/lib/cancellation-policy'

const NOW = '2026-10-10T17:00:00Z'
const START = '2026-10-20T15:00:00Z'
const END = '2026-10-23T15:00:00Z'
const RECENTLY = '2026-10-10T15:00:00Z'     // booked 2 hours ago: inside every free window
const LAST_WEEK = '2026-10-03T15:00:00Z'    // non-refundable grace long over

const cancel = (bookingId: string, reason?: string) => cancelBooking({ data: { bookingId, reason } })

describe('cancelling a confirmed trip', () => {
    it('refunds a refundable trip in full inside its window, and emails both sides once', async () => {
        world(NOW)
        const { booking, intent, quote } = paidTrip({ start: START, end: END, bookedAt: LAST_WEEK, rate: 'refundable' })
        signIn(GUEST)

        const result = await cancel(booking.id, 'Plans changed')

        expect(result.outcome?.kind).toBe('full')
        expect(h.stripe.refundedOn(intent.id)).toBe(quote.total)
        const row = bookingRow(booking.id)
        expect(row).toMatchObject({ status: 'canceled', canceled_by: 'guest', refunded_amount: quote.total, cancellation_reason: 'Plans changed' })
        expect(row.refund_id).toBeTruthy()
        expect(emailsTo(GUEST_EMAIL)).toHaveLength(1)
        expect(emailsTo(ADMIN_EMAIL)).toHaveLength(1)
        expect(emailsTo(ADMIN_EMAIL)[0].subject).toContain('has cancelled their trip')
    })

    it('refunds nothing on a non-refundable trip past its grace period, but still tells both sides', async () => {
        world(NOW)
        const { booking, intent } = paidTrip({ start: START, end: END, bookedAt: LAST_WEEK, rate: 'non-refundable' })
        signIn(GUEST)

        const result = await cancel(booking.id)

        expect(result.outcome?.kind).toBe('none')
        expect(h.stripe.refundedOn(intent.id)).toBe(0)
        expect(h.stripe.refundsMade).toHaveLength(0)
        expect(bookingRow(booking.id).status).toBe('canceled')
        expect(emailsTo(GUEST_EMAIL)).toHaveLength(1)
        expect(emailsTo(GUEST_EMAIL)[0].text).toContain('no refund was issued')
    })

    it('keeps the cancellation fee on a late refundable cancellation, exactly as the dialog quoted', async () => {
        world('2026-10-19T20:00:00Z') // under 24 hours before the start
        const { booking, intent, quote } = paidTrip({ start: START, end: END, bookedAt: LAST_WEEK, rate: 'refundable' })
        signIn(GUEST)

        const preview = await previewCancellation({ data: { bookingId: booking.id } })
        const result = await cancel(booking.id)

        expect(result.outcome?.kind).toBe('partial')
        expect(result.outcome!.refundAmount).toBe(preview.outcome.refundAmount)
        expect(h.stripe.refundedOn(intent.id)).toBe(preview.outcome.refundAmount)
        expect(preview.outcome.refundAmount).toBeLessThan(quote.total)
        expect(preview.outcome.refundAmount).toBeGreaterThan(0)
    })

    it('refunds everything when we cancel, whatever the guest’s rate, and says so', async () => {
        world(NOW)
        const { booking, intent, quote } = paidTrip({ start: START, end: END, bookedAt: LAST_WEEK, rate: 'non-refundable' })
        signIn(ADMIN)

        const result = await cancel(booking.id, 'The car needs a repair')

        expect(result.outcome).toMatchObject({ kind: 'full', reason: 'admin-initiated' })
        expect(h.stripe.refundedOn(intent.id)).toBe(quote.total)
        expect(bookingRow(booking.id).canceled_by).toBe('admin')
        const guestEmail = emailsTo(GUEST_EMAIL)[0]
        expect(guestEmail.text).toContain('Why we cancelled')
        expect(guestEmail.text).toContain('The car needs a repair')
        const ownerEmail = emailsTo(ADMIN_EMAIL)[0]
        expect(ownerEmail.subject).toContain('was cancelled')
        expect(ownerEmail.subject).not.toContain('has cancelled their trip')
    })

    it('settles every later charge: refunds paid ones, releases every hold, leaves our own charges', async () => {
        world(NOW)
        const { booking, intent, quote } = paidTrip({ start: START, end: END, bookedAt: LAST_WEEK, rate: 'non-refundable' })
        const ext = paidExtension(booking, 110)
        const extra = paidCharge(booking, 'extra', 25, 2.5)
        const pendingExtra = extraRequest(booking, 30)
        const extRequest = extensionRequest(booking, 80)
        const deposit = depositHold(booking)
        const damage = paidCharge(booking, 'adjustment', 50)
        signIn(ADMIN)

        const result = await cancel(booking.id)

        expect(h.stripe.refundedOn(intent.id)).toBe(quote.total)
        expect(h.stripe.refundedOn(ext.intent.id)).toBe(110)
        expect(h.stripe.refundedOn(extra.intent.id)).toBe(27.5)
        expect(result.laterRefund).toBe(137.5)
        // Holds released, in Stripe and in the ledger.
        for (const held of [pendingExtra, extRequest, deposit]) {
            expect(h.stripe.intents.get(held.intent.id)!.status).toBe('canceled')
            expect(chargeRow(held.charge.id).status).toBe('canceled')
        }
        // Our own charge is untouched.
        expect(h.stripe.refundedOn(damage.intent.id)).toBe(0)
        expect(chargeRow(damage.charge.id).status).toBe('succeeded')
        // The requests are answered by the cancellation.
        expect(h.db.find('booking_extras', pendingExtra.extra.id)!.status).toBe('declined')
        expect(h.db.find('booking_extensions', extRequest.extension.id)!.status).toBe('canceled')
        // The guest is told about the hold, and the totals add up in the email.
        expect(emailsTo(GUEST_EMAIL).map(e => e.subject)).toContain('Your security hold has been released — Bluefin')
        const cancellation = emailsTo(GUEST_EMAIL).find(e => e.subject.includes('has been cancelled'))!
        expect(cancellation.text).toContain(`$${(quote.total + 137.5).toFixed(2)}`)
    })

    it('refunds an extension minus its own refundable premium on a late refundable cancellation', async () => {
        world('2026-10-19T20:00:00Z')
        const { booking } = paidTrip({ start: START, end: END, bookedAt: LAST_WEEK, rate: 'refundable' })
        const ext = paidExtension(booking, 110, 10)
        signIn(GUEST)

        await cancel(booking.id)

        expect(h.stripe.refundedOn(ext.intent.id)).toBe(100)
    })

    it('cancels a deposit hold still waiting on the guest’s bank, without emailing about it', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: START, end: END, bookedAt: LAST_WEEK })
        const deposit = depositAwaiting3ds(booking)
        signIn(GUEST)

        await cancel(booking.id)

        expect(h.stripe.intents.get(deposit.intent.id)!.status).toBe('canceled')
        expect(chargeRow(deposit.charge.id).status).toBe('canceled')
        expect(h.emails.map(e => e.subject).join('|')).not.toMatch(/security hold/i)
    })

    it('does not mark a payment cancelled when Stripe refuses to cancel it, and alerts us instead', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: START, end: END, bookedAt: LAST_WEEK })
        const ext = extensionRequest(booking)
        h.stripe.intents.get(ext.intent.id)!.status = 'processing'
        h.db.find('booking_charges', ext.charge.id)!.status = 'processing'
        h.stripe.uncancellable.add(ext.intent.id)
        signIn(GUEST)

        await cancel(booking.id)

        expect(chargeRow(ext.charge.id).status).toBe('processing')
        expect(emailsTo(ADMIN_EMAIL).map(e => e.subject)).toContain('[Bluefin] A cancelled trip’s later charges need attention')
    })

    it('puts the trip back exactly as it was when the refund fails, and sends nothing', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: START, end: END, bookedAt: RECENTLY })
        const deposit = depositHold(booking)
        h.stripe.failNextRefund = true
        signIn(GUEST)

        await expect(cancel(booking.id)).rejects.toThrow('Could not process refund')

        expect(bookingRow(booking.id)).toMatchObject({ status: 'confirmed', canceled_at: null, canceled_by: null })
        expect(chargeRow(deposit.charge.id).status).toBe('authorized')
        expect(h.emails).toHaveLength(0)
    })
})

describe('who is cancelling', () => {
    it('gives an owner cancelling their OWN booking the guest’s terms, not a business refund (2026-10-08 rehearsal)', async () => {
        world(NOW)
        const { booking, intent } = paidTrip({ start: START, end: END, bookedAt: LAST_WEEK, rate: 'non-refundable', userId: ADMIN })
        signIn(ADMIN)

        const preview = await previewCancellation({ data: { bookingId: booking.id } })
        const result = await cancel(booking.id)

        expect(preview.byAdmin).toBe(false)
        expect(result.outcome?.kind).toBe('none')
        expect(h.stripe.refundedOn(intent.id)).toBe(0)
        expect(bookingRow(booking.id).canceled_by).toBe('guest')
    })

    it('still refunds in full when an owner cancels someone else’s booking', async () => {
        world(NOW)
        const { booking, intent, quote } = paidTrip({ start: START, end: END, bookedAt: LAST_WEEK, rate: 'non-refundable', userId: GUEST })
        signIn(ADMIN)

        expect((await previewCancellation({ data: { bookingId: booking.id } })).byAdmin).toBe(true)
        await cancel(booking.id)

        expect(h.stripe.refundedOn(intent.id)).toBe(quote.total)
        expect(bookingRow(booking.id).canceled_by).toBe('admin')
    })
})

describe('what can and cannot be cancelled', () => {
    it('does nothing the second time: one refund, one pair of emails', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: START, end: END, bookedAt: RECENTLY })
        signIn(GUEST)

        await cancel(booking.id)
        const again = await cancel(booking.id)

        expect(again.alreadyCanceled).toBe(true)
        expect(h.stripe.refundsMade).toHaveLength(1)
        expect(h.emails).toHaveLength(2)
    })

    it('never revives a cancelled trip, even after Stripe has forgotten the refund key (the 2026-10-06 bug)', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: START, end: END, bookedAt: RECENTLY })
        signIn(ADMIN)
        await cancel(booking.id)

        at('2026-10-11T18:00:00Z')
        h.stripe.forgetIdempotencyKeys()
        const again = await cancel(booking.id)

        expect(again.alreadyCanceled).toBe(true)
        expect(bookingRow(booking.id).status).toBe('canceled')
        expect(h.stripe.refundsMade).toHaveLength(1)
    })

    it('refuses to cancel a completed trip', async () => {
        world(NOW)
        const { booking, intent } = paidTrip({ start: '2026-10-01T15:00:00Z', end: '2026-10-03T15:00:00Z', bookedAt: '2026-09-20T15:00:00Z', status: 'completed' })
        signIn(ADMIN)

        await expect(cancel(booking.id)).rejects.toThrow('completed')
        expect(bookingRow(booking.id).status).toBe('completed')
        expect(h.stripe.refundedOn(intent.id)).toBe(0)
    })

    it('discards an unpaid hold quietly: expired, its payment cancelled, nobody emailed', async () => {
        world(NOW)
        const { booking, intent } = unpaidCheckout({ start: START, end: END, createdAt: '2026-10-10T16:50:00Z' })
        signIn(GUEST)

        await cancel(booking.id)

        expect(bookingRow(booking.id).status).toBe('expired')
        expect(h.stripe.intents.get(intent.id)!.status).toBe('canceled')
        expect(h.stripe.refundsMade).toHaveLength(0)
        expect(h.emails).toHaveLength(0)
    })

    it('leaves an expired checkout alone', async () => {
        world(NOW)
        const { booking } = unpaidCheckout({ start: START, end: END, createdAt: '2026-10-09T10:00:00Z', status: 'expired' })
        signIn(GUEST)

        expect((await cancel(booking.id)).alreadyCanceled).toBe(true)
        expect(bookingRow(booking.id).status).toBe('expired')
    })

    it('refuses another guest, and anyone signed out', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: START, end: END, bookedAt: RECENTLY })

        signIn(OTHER_GUEST)
        await expect(cancel(booking.id)).rejects.toThrow('Not authorized')
        signIn(null)
        await expect(cancel(booking.id)).rejects.toThrow('Not authenticated')

        expect(bookingRow(booking.id).status).toBe('confirmed')
        expect(h.stripe.refundsMade).toHaveLength(0)
    })
})

describe('the quote and the refund agree', () => {
    // previewCancellation is what the dialog shows; cancelBooking is what's paid.
    const cases: { label: string; now: string; rate: 'refundable' | 'non-refundable'; bookedAt: string; who: string }[] = [
        { label: 'refundable, early', now: NOW, rate: 'refundable', bookedAt: LAST_WEEK, who: GUEST },
        { label: 'refundable, late', now: '2026-10-19T20:00:00Z', rate: 'refundable', bookedAt: LAST_WEEK, who: GUEST },
        { label: 'refundable, after start', now: '2026-10-21T20:00:00Z', rate: 'refundable', bookedAt: LAST_WEEK, who: GUEST },
        { label: 'non-refundable, in grace', now: NOW, rate: 'non-refundable', bookedAt: RECENTLY, who: GUEST },
        { label: 'non-refundable, after grace', now: NOW, rate: 'non-refundable', bookedAt: LAST_WEEK, who: GUEST },
        { label: 'owner, non-refundable', now: NOW, rate: 'non-refundable', bookedAt: LAST_WEEK, who: ADMIN },
    ]
    for (const c of cases) {
        it(c.label, async () => {
            world(c.now)
            const { booking, intent } = paidTrip({ start: START, end: END, bookedAt: c.bookedAt, rate: c.rate })
            const ext = paidExtension(booking, 110, c.rate === 'refundable' ? 10 : 0)
            signIn(c.who)

            const preview = await previewCancellation({ data: { bookingId: booking.id } })
            await cancel(booking.id)

            expect(h.stripe.refundedOn(intent.id)).toBe(preview.outcome.refundAmount)
            expect(h.stripe.refundedOn(ext.intent.id)).toBe(preview.laterRefund)
        })
    }
})

describe('finishing a cancellation that was interrupted (payments sweep, step 6)', () => {
    /** The row as cancelBooking leaves it the instant after its claim. */
    function interrupted(booking: Record<string, any>, at: string, by = 'guest') {
        const row = bookingRow(booking.id)
        row.status = 'canceled'
        row.canceled_at = at
        row.canceled_by = by
    }

    it('refunds and emails a trip whose cancellation stopped after the claim, once', async () => {
        world(NOW)
        const { booking, intent, quote } = paidTrip({ start: START, end: END, bookedAt: RECENTLY })
        const deposit = depositHold(booking)
        interrupted(booking, NOW)

        // Too soon: it might still be in progress.
        let sweep = await runPaymentsSweep(h.db as any, new Date('2026-10-10T17:05:00Z'))
        expect(sweep.cancellationsFinished).toBe(0)
        expect(h.stripe.refundsMade).toHaveLength(0)

        at('2026-10-10T17:15:00Z')
        sweep = await runPaymentsSweep(h.db as any, new Date('2026-10-10T17:15:00Z'))
        expect(sweep.cancellationsFinished).toBe(1)
        expect(h.stripe.refundedOn(intent.id)).toBe(quote.total)
        expect(bookingRow(booking.id).refunded_amount).toBe(quote.total)
        expect(chargeRow(deposit.charge.id).status).toBe('canceled')
        expect(emailsTo(GUEST_EMAIL).some(e => e.subject.includes('has been cancelled'))).toBe(true)

        at('2026-10-10T17:30:00Z')
        sweep = await runPaymentsSweep(h.db as any, new Date('2026-10-10T17:30:00Z'))
        expect(sweep.cancellationsFinished).toBe(0)
        expect(h.stripe.refundsMade).toHaveLength(1)
    })

    it('does not refund twice when Stripe already refunded but the row never recorded it', async () => {
        world(NOW)
        const { booking, intent, quote } = paidTrip({ start: START, end: END, bookedAt: RECENTLY })
        interrupted(booking, NOW)
        await h.stripe.refunds.create({ payment_intent: intent.id }, { idempotencyKey: 'earlier' })

        at('2026-10-10T17:15:00Z')
        await runPaymentsSweep(h.db as any, new Date('2026-10-10T17:15:00Z'))

        expect(h.stripe.refundsMade).toHaveLength(1)
        expect(h.stripe.refundedOn(intent.id)).toBe(quote.total)
        expect(bookingRow(booking.id).refunded_amount).toBe(quote.total)
    })

    it('reaches the same refund the guest was quoted, judged at the moment they cancelled', async () => {
        world('2026-10-19T20:00:00Z')
        const { booking, intent, quote } = paidTrip({ start: START, end: END, bookedAt: LAST_WEEK, rate: 'refundable' })
        const expected = refundForCancellation({
            rate: 'refundable', bookedAt: new Date(LAST_WEEK), tripStart: new Date(START), tripEnd: new Date(END),
            quote, totalPaid: quote.total, byAdmin: false, now: new Date('2026-10-19T20:00:00Z'),
        })
        interrupted(booking, '2026-10-19T20:00:00Z')

        // Much later — after the trip has even started — the outcome must not drift.
        at('2026-10-21T10:00:00Z')
        await runPaymentsSweep(h.db as any, new Date('2026-10-19T20:20:00Z'))

        expect(h.stripe.refundedOn(intent.id)).toBe(expected.refundAmount)
    })

    it('closes a cancelled checkout that was never paid without refunding or emailing', async () => {
        world(NOW)
        const { booking } = unpaidCheckout({ start: START, end: END, createdAt: RECENTLY })
        interrupted(booking, NOW)

        await runPaymentsSweep(h.db as any, new Date('2026-10-10T17:15:00Z'))

        expect(h.stripe.refundsMade).toHaveLength(0)
        expect(h.emails).toHaveLength(0)
        expect(bookingRow(booking.id).cancel_notified_at).toBeTruthy()
    })

    it('tells us once when the retried refund keeps failing', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: START, end: END, bookedAt: RECENTLY })
        interrupted(booking, NOW)

        h.stripe.failNextRefund = true
        await runPaymentsSweep(h.db as any, new Date('2026-10-10T17:15:00Z'))
        h.stripe.failNextRefund = true
        await runPaymentsSweep(h.db as any, new Date('2026-10-10T17:45:00Z'))

        const alerts = emailsTo(ADMIN_EMAIL).filter(e => e.subject.includes('could not be refunded'))
        expect(alerts).toHaveLength(1)
        expect(bookingRow(booking.id).status).toBe('canceled')
    })
})
