// A checkout payment succeeding, through every path that acts on it: the
// webhook, confirmBooking (the checkout page), the trip page's revival
// (getTripForGuest), and the pre-payment check (checkCheckoutStillBookable).

import { describe, expect, it } from 'vitest'
import { h, signIn, emailsTo, ADMIN_EMAIL } from './harness'
import { world, paidTrip, unpaidCheckout, pay, bookingRow, chargeRow, depositHold, GUEST, OTHER_GUEST, ADMIN, GUEST_EMAIL } from './fixtures'
import { cancelBooking, checkCheckoutStillBookable, confirmBooking, getTripForGuest } from '../src/lib/db'
import { Route as Webhook } from '../src/routes/api/stripe-webhook'

const NOW = '2026-10-10T17:00:00Z'
const START = '2026-10-20T15:00:00Z'
const END = '2026-10-23T15:00:00Z'
const LIVE_HOLD = '2026-10-10T16:40:00Z'     // 20 minutes old
const LAPSED_HOLD = '2026-10-10T14:00:00Z'   // 3 hours old

const confirm = (bookingId: string, paymentIntentId: string) => confirmBooking({ data: { bookingId, paymentIntentId } })

async function webhook(type: string, object: unknown) {
    const post = (Webhook as any).options.server.handlers.POST
    const request = new Request('https://test.bluefin/api/stripe-webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 'test' },
        body: JSON.stringify({ id: 'evt_test', type, data: { object } }),
    })
    return post({ request }) as Promise<Response>
}

/** Another guest's paid trip over the same dates, booked after this checkout's hold lapsed. */
const takenByOtherGuest = () =>
    paidTrip({ start: START, end: END, bookedAt: '2026-10-10T16:00:00Z', userId: OTHER_GUEST })

describe('confirming a paid checkout', () => {
    it('confirms a live checkout, saves the card, and emails both sides once', async () => {
        world(NOW)
        const { booking, intent } = unpaidCheckout({ start: START, end: END, createdAt: LIVE_HOLD })
        pay(intent.id)
        signIn(GUEST)

        expect((await confirm(booking.id, intent.id)).status).toBe('confirmed')
        await confirm(booking.id, intent.id) // the webhook and the page both arrive
        expect((await webhook('payment_intent.succeeded', h.stripe.intents.get(intent.id))).status).toBe(200)

        const row = bookingRow(booking.id)
        expect(row.status).toBe('confirmed')
        expect(row.payment_method_id).toBe('pm_ok')
        expect(emailsTo(ADMIN_EMAIL)).toHaveLength(1)
        expect(emailsTo(GUEST_EMAIL)).toHaveLength(1)
    })

    it('refuses to confirm a trip that was cancelled and refunded (the confirmBooking exploit)', async () => {
        world(NOW)
        const { booking, intent } = paidTrip({ start: START, end: END, bookedAt: '2026-10-10T16:00:00Z', rate: 'refundable' })
        signIn(GUEST)
        await cancelBooking({ data: { bookingId: booking.id } })
        expect(h.stripe.refundedOn(intent.id)).toBeGreaterThan(0)
        const emailsBefore = h.emails.length

        await expect(confirm(booking.id, intent.id)).rejects.toThrow('can no longer be confirmed')
        await webhook('payment_intent.succeeded', h.stripe.intents.get(intent.id))

        expect(bookingRow(booking.id).status).toBe('canceled')
        expect(h.emails).toHaveLength(emailsBefore)
        expect(h.db.rows('booking_charges')).toHaveLength(0) // no deposit hold placed
    })

    it('refuses to revive a trip cancelled with no refund (nothing refunded to block it but the rule)', async () => {
        world(NOW)
        const { booking, intent } = paidTrip({ start: START, end: END, bookedAt: '2026-10-01T15:00:00Z', rate: 'non-refundable' })
        signIn(GUEST)
        await cancelBooking({ data: { bookingId: booking.id } })
        expect(bookingRow(booking.id).refund_id).toBeNull()

        await expect(confirm(booking.id, intent.id)).rejects.toThrow('can no longer be confirmed')
        await webhook('payment_intent.succeeded', h.stripe.intents.get(intent.id))
        expect(bookingRow(booking.id).status).toBe('canceled')
    })

    it('refuses a payment that belongs to a different booking', async () => {
        world(NOW)
        const mine = unpaidCheckout({ start: START, end: END, createdAt: LIVE_HOLD })
        const theirs = paidTrip({ start: '2026-11-01T15:00:00Z', end: '2026-11-03T15:00:00Z', bookedAt: NOW, userId: GUEST, status: 'pending' })
        signIn(GUEST)

        await expect(confirm(mine.booking.id, theirs.intent.id)).rejects.toThrow('does not belong')
        expect(bookingRow(mine.booking.id).status).toBe('pending')
    })

    it('leaves a completed trip alone when a late payment event arrives', async () => {
        world(NOW)
        const { booking, intent } = paidTrip({ start: '2026-10-01T15:00:00Z', end: '2026-10-03T15:00:00Z', bookedAt: '2026-09-20T15:00:00Z', status: 'completed' })
        await webhook('payment_intent.succeeded', h.stripe.intents.get(intent.id))
        expect(bookingRow(booking.id).status).toBe('completed')
    })
})

describe('a payment that arrives after the checkout hold lapsed', () => {
    it('confirms it when the dates are still free', async () => {
        world(NOW)
        const { booking, intent } = unpaidCheckout({ start: START, end: END, createdAt: LAPSED_HOLD, status: 'expired' })
        pay(intent.id)
        signIn(GUEST)

        expect((await confirm(booking.id, intent.id)).status).toBe('confirmed')
        expect(h.stripe.refundsMade).toHaveLength(0)
    })

    for (const status of ['expired', 'pending'] as const) {
        it(`refunds it in full when someone else booked the dates (row still ${status})`, async () => {
            world(NOW)
            const { booking, intent, quote } = unpaidCheckout({ start: START, end: END, createdAt: LAPSED_HOLD, status })
            const other = takenByOtherGuest()
            pay(intent.id)
            signIn(GUEST)

            expect((await confirm(booking.id, intent.id)).status).toBe('refunded-conflict')

            expect(h.stripe.refundedOn(intent.id)).toBe(quote.total)
            const row = bookingRow(booking.id)
            expect(row).toMatchObject({ status: 'canceled', canceled_by: 'system', refunded_amount: quote.total })
            expect(bookingRow(other.booking.id).status).toBe('confirmed')
            expect(emailsTo(GUEST_EMAIL).map(e => e.subject)).toEqual(['Your payment has been refunded — Bluefin'])
            expect(emailsTo(ADMIN_EMAIL).map(e => e.subject)).toEqual([expect.stringContaining('Late payment refunded')])
            expect(h.db.rows('booking_charges')).toHaveLength(0) // no deposit hold
        })
    }

    it('refunds once however many paths see the payment', async () => {
        world(NOW)
        const { booking, intent } = unpaidCheckout({ start: START, end: END, createdAt: LAPSED_HOLD, status: 'expired' })
        takenByOtherGuest()
        pay(intent.id)
        signIn(GUEST)

        await confirm(booking.id, intent.id)
        await webhook('payment_intent.succeeded', h.stripe.intents.get(intent.id))
        await webhook('charge.succeeded', { payment_intent: intent.id })
        await getTripForGuest({ data: booking.id })

        expect(h.stripe.refundsMade).toHaveLength(1)
        expect(emailsTo(GUEST_EMAIL)).toHaveLength(1)
        expect(bookingRow(booking.id).status).toBe('canceled')
    })

    it('shows the guest why on their trip page when they come back from 3D Secure', async () => {
        world(NOW)
        const { booking, intent } = unpaidCheckout({ start: START, end: END, createdAt: LAPSED_HOLD, status: 'expired' })
        takenByOtherGuest()
        pay(intent.id)
        signIn(GUEST)

        const trip = await getTripForGuest({ data: booking.id })

        expect(trip.paymentState).toBe('canceled')
        expect(trip.booking.canceled_by).toBe('system')
        expect(h.stripe.refundsMade).toHaveLength(1)
    })

    it('does not re-check a payment made inside the hold (every other booking respected it)', async () => {
        world(NOW)
        const { booking, intent } = unpaidCheckout({ start: START, end: END, createdAt: LIVE_HOLD })
        // A Turo trip synced over the same dates: our side's mistake, not the guest's.
        h.db.insert('turo_bookings', { car_id: 5, start_time: START, end_time: END, turo_trip_id: 't1' })
        pay(intent.id)
        signIn(GUEST)

        expect((await confirm(booking.id, intent.id)).status).toBe('confirmed')
        expect(h.stripe.refundsMade).toHaveLength(0)
    })
})

describe('the check just before paying', () => {
    it('lets a live checkout through', async () => {
        world(NOW)
        const { booking } = unpaidCheckout({ start: START, end: END, createdAt: LIVE_HOLD })
        takenByOtherGuest() // can't happen against a live hold, but the check must not even look
        signIn(GUEST)
        await expect(checkCheckoutStillBookable({ data: booking.id })).resolves.toEqual({ ok: true })
    })

    it('lets a lapsed checkout through when the dates are still free', async () => {
        world(NOW)
        const { booking } = unpaidCheckout({ start: START, end: END, createdAt: LAPSED_HOLD, status: 'expired' })
        signIn(GUEST)
        await expect(checkCheckoutStillBookable({ data: booking.id })).resolves.toEqual({ ok: true })
    })

    it('stops a lapsed checkout whose dates were taken, before any money moves', async () => {
        world(NOW)
        const { booking, intent } = unpaidCheckout({ start: START, end: END, createdAt: LAPSED_HOLD })
        takenByOtherGuest()
        signIn(GUEST)

        await expect(checkCheckoutStillBookable({ data: booking.id })).rejects.toThrow("You haven't been charged")

        expect(h.stripe.intents.get(intent.id)!.status).toBe('canceled')
        expect(bookingRow(booking.id).status).toBe('expired')
        expect(h.stripe.refundsMade).toHaveLength(0)
    })

    it('refuses a cancelled checkout and other people’s', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: START, end: END, bookedAt: NOW, status: 'canceled' })
        signIn(GUEST)
        await expect(checkCheckoutStillBookable({ data: booking.id })).rejects.toThrow('no longer active')
        signIn(OTHER_GUEST)
        await expect(checkCheckoutStillBookable({ data: booking.id })).rejects.toThrow('Not authorized')
    })
})

describe('the webhook', () => {
    it('asks Stripe to retry when no booking has the payment yet', async () => {
        world(NOW)
        const intent = h.stripe.seedIntent({ amount: 1000, status: 'succeeded', metadata: { kind: 'trip' } })
        expect((await webhook('payment_intent.succeeded', intent)).status).toBe(500)
    })

    it('marks an abandoned checkout expired, not canceled, when its payment is cancelled', async () => {
        world(NOW)
        const { booking, intent } = unpaidCheckout({ start: START, end: END, createdAt: LIVE_HOLD })
        h.stripe.intents.get(intent.id)!.status = 'canceled'
        await webhook('payment_intent.canceled', h.stripe.intents.get(intent.id))
        expect(bookingRow(booking.id).status).toBe('expired')
    })

    it('routes a ledger payment to its charge row, not to a booking', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: '2026-10-11T15:00:00Z', end: END, bookedAt: '2026-10-01T15:00:00Z' })
        const deposit = depositHold(booking)
        const before = bookingRow(booking.id).status
        const intent = h.stripe.intents.get(deposit.intent.id)!
        h.db.find('booking_charges', deposit.charge.id)!.status = 'requires_payment'

        expect((await webhook('payment_intent.amount_capturable_updated', intent)).status).toBe(200)

        expect(chargeRow(deposit.charge.id).status).toBe('authorized')
        expect(bookingRow(booking.id).status).toBe(before)
    })

    it('records a refund made outside the site (e.g. in the Stripe dashboard)', async () => {
        world(NOW)
        const { booking, intent } = paidTrip({ start: START, end: END, bookedAt: NOW })
        await webhook('charge.refunded', { payment_intent: intent.id, amount_refunded: 5000 })
        expect(bookingRow(booking.id).refunded_amount).toBe(50)
    })
})

describe('who may confirm', () => {
    it('lets an owner confirm a guest’s paid checkout (the page fallback)', async () => {
        world(NOW)
        const { booking, intent } = unpaidCheckout({ start: START, end: END, createdAt: LIVE_HOLD })
        pay(intent.id)
        signIn(ADMIN)
        expect((await confirm(booking.id, intent.id)).status).toBe('confirmed')
    })

    it('refuses another guest', async () => {
        world(NOW)
        const { booking, intent } = unpaidCheckout({ start: START, end: END, createdAt: LIVE_HOLD })
        pay(intent.id)
        signIn(OTHER_GUEST)
        await expect(confirm(booking.id, intent.id)).rejects.toThrow('Not authorized')
        expect(bookingRow(booking.id).status).toBe('pending')
    })
})
