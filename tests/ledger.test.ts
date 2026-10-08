// Money after checkout: the deposit hold, extensions, extras, owners' charges,
// refunds, and the payments sweep (src/lib/payments.server.ts).
// ImportantFiles/deposit.md, extensions.md and charges-and-invoicing.md are the spec.

import { describe, expect, it } from 'vitest'
import { h, at, signIn, emailsTo, ADMIN_EMAIL } from './harness'
import {
    world, paidTrip, paidCharge, depositHold, depositAwaiting3ds, extraRequest, extensionRequest,
    chargeRow, bookingRow, GUEST, ADMIN, GUEST_EMAIL,
} from './fixtures'
import {
    captureDeposit, createAdjustmentCharge, decideExtension, ensureDepositHold, refundCharge, releaseDepositHold,
    runPaymentsSweep, startExtension, syncChargeFromIntent, loadCharge,
} from '../src/lib/payments.server'
import { decideTripExtra, requestTripExtras } from '../src/lib/db'

const NOW = '2026-10-10T17:00:00Z'
const SOON_START = '2026-10-11T15:00:00Z'   // inside the deposit window
const SOON_END = '2026-10-14T15:00:00Z'
const LATER_START = '2026-10-20T15:00:00Z'
const LATER_END = '2026-10-23T15:00:00Z'
const BOOKED = '2026-10-01T15:00:00Z'
const db = () => h.db as any

describe('the ledger moves forward only', () => {
    it('ignores a late event that would move a settled charge backwards', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: LATER_START, end: LATER_END, bookedAt: BOOKED })
        const { charge, intent } = paidCharge(booking, 'extension', 50)
        const stale = { ...h.stripe.intents.get(intent.id)!, status: 'requires_capture' }

        await syncChargeFromIntent(db(), stale as any)

        expect(chargeRow(charge.id).status).toBe('succeeded')
    })
})

describe('the deposit hold', () => {
    it('is placed once inside the window, and the second caller is turned away', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: SOON_START, end: SOON_END, bookedAt: BOOKED })

        const [first, second] = await Promise.all([
            ensureDepositHold(db(), booking.id),
            ensureDepositHold(db(), booking.id),
        ])

        expect([first.state, second.state]).toContain('placed')
        expect([first.state, second.state].filter(s => s === 'placed')).toHaveLength(1)
        const deposits = h.db.rows('booking_charges').filter(c => c.kind === 'deposit')
        expect(deposits).toHaveLength(1)
        expect(deposits[0].status).toBe('authorized')
        expect(emailsTo(GUEST_EMAIL).filter(e => e.subject.includes('is ready'))).toHaveLength(1)
    })

    it('is not placed early, nor on a cancelled trip', async () => {
        world(NOW)
        const later = paidTrip({ start: LATER_START, end: LATER_END, bookedAt: BOOKED })
        const cancelled = paidTrip({ start: SOON_START, end: SOON_END, bookedAt: BOOKED, status: 'canceled', carId: 7 })

        expect((await ensureDepositHold(db(), later.booking.id)).state).toBe('not-due')
        expect((await ensureDepositHold(db(), cancelled.booking.id)).state).toBe('not-confirmed')
        expect(h.db.rows('booking_charges')).toHaveLength(0)
    })

    it('is released at once, silently, if it lands after the trip was cancelled', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: SOON_START, end: SOON_END, bookedAt: BOOKED })
        const deposit = depositAwaiting3ds(booking)
        bookingRow(booking.id).status = 'canceled'
        // The guest finishes their bank's check after the cancellation.
        const intent = h.stripe.intents.get(deposit.intent.id)!
        intent.status = 'requires_capture'

        await syncChargeFromIntent(db(), intent as any)

        expect(chargeRow(deposit.charge.id).status).toBe('canceled')
        expect(intent.status).toBe('canceled')
        expect(h.emails.filter(e => e.subject.toLowerCase().includes('hold'))).toHaveLength(0)
    })

    it('does not place a second hold when an "abandoned" attempt actually went through', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: SOON_START, end: SOON_END, bookedAt: BOOKED })
        const stale = depositAwaiting3ds(booking)
        h.db.find('booking_charges', stale.charge.id)!.created_at = '2026-10-10T14:00:00Z' // stale
        // The guest authenticated at the last moment: Stripe holds it and won't cancel.
        h.stripe.intents.get(stale.intent.id)!.status = 'requires_capture'
        h.stripe.uncancellable.add(stale.intent.id)

        const attempt = await ensureDepositHold(db(), booking.id)

        expect(attempt.state).toBe('held')
        expect(chargeRow(stale.charge.id).status).toBe('authorized')
        expect([...h.stripe.intents.values()].filter(i => i.metadata.kind === 'deposit')).toHaveLength(1)
    })

    it('counts a hold already released in Stripe as released, so the sweep stops retrying it', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: SOON_START, end: SOON_END, bookedAt: BOOKED })
        const deposit = depositHold(booking)
        h.stripe.intents.get(deposit.intent.id)!.status = 'canceled' // released from the dashboard

        expect(await releaseDepositHold(db(), chargeRow(deposit.charge.id) as any, { notifyGuest: false })).toBe(true)
        expect(chargeRow(deposit.charge.id).status).toBe('canceled')
    })

    it('can be captured once, partly, with the rest released', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: SOON_START, end: SOON_END, bookedAt: BOOKED })
        const deposit = depositHold(booking)

        const captured = await captureDeposit(db(), (await loadCharge(db(), deposit.charge.id))!, 300, 'Scratched bumper')
        expect(captured.status).toBe('succeeded')
        expect(h.stripe.intents.get(deposit.intent.id)!.amount_received).toBe(30000)
        await expect(captureDeposit(db(), (await loadCharge(db(), deposit.charge.id))!, 200, 'Again')).rejects.toThrow('no longer on the card')
        await expect(captureDeposit(db(), (await loadCharge(db(), deposit.charge.id))!, 2000, 'Too much')).rejects.toThrow()
    })

    it('is released by the sweep once a trip is cancelled, and after the inspection window otherwise', async () => {
        world(NOW)
        const cancelled = paidTrip({ start: SOON_START, end: SOON_END, bookedAt: BOOKED, status: 'canceled' })
        const cancelledHold = depositHold(cancelled.booking)
        const finished = paidTrip({ start: '2026-10-01T15:00:00Z', end: '2026-10-05T15:00:00Z', bookedAt: '2026-09-20T15:00:00Z', status: 'completed', carId: 7 })
        const finishedHold = depositHold(finished.booking)
        const kept = paidTrip({ start: '2026-10-01T15:00:00Z', end: '2026-10-05T15:00:00Z', bookedAt: '2026-09-20T15:00:00Z', status: 'completed', carId: 7 })
        const keptHold = depositHold(kept.booking)
        h.db.find('booking_charges', keptHold.charge.id)!.keep_holding = true

        const sweep = await runPaymentsSweep(db(), new Date(NOW))

        expect(chargeRow(cancelledHold.charge.id).status).toBe('canceled')
        expect(chargeRow(finishedHold.charge.id).status).toBe('canceled')
        expect(chargeRow(keptHold.charge.id).status).toBe('authorized')
        expect(sweep.holdsReleased).toBe(2)
    })
})

describe('extensions', () => {
    const end = '2026-10-14T15:00:00Z' // 10am Central

    it('charges and applies an extension on a confirmed trip', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: SOON_START, end, bookedAt: BOOKED })

        const result = await startExtension(db(), {
            bookingId: booking.id, newEndDate: '2026-10-15', newEndTime: '10:00', createdBy: GUEST, callerIsAdmin: false,
        })

        expect(result.extension.status).toBe('confirmed')
        expect(new Date(bookingRow(booking.id).end_time).toISOString()).toBe('2026-10-15T15:00:00.000Z')
        expect(h.db.rows('booking_charges').find(c => c.kind === 'extension')!.status).toBe('succeeded')
    })

    it('refuses to extend a cancelled trip', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: SOON_START, end, bookedAt: BOOKED, status: 'canceled' })
        await expect(startExtension(db(), {
            bookingId: booking.id, newEndDate: '2026-10-15', newEndTime: '10:00', createdBy: GUEST, callerIsAdmin: false,
        })).rejects.toThrow('Only a confirmed trip')
        expect(h.stripe.intents.size).toBe(1) // just the checkout
    })

    it('refuses an extension into time someone else has booked', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: SOON_START, end, bookedAt: BOOKED })
        paidTrip({ start: '2026-10-14T20:00:00Z', end: '2026-10-16T15:00:00Z', bookedAt: BOOKED, userId: ADMIN })
        await expect(startExtension(db(), {
            bookingId: booking.id, newEndDate: '2026-10-15', newEndTime: '10:00', createdBy: GUEST, callerIsAdmin: false,
        })).rejects.toThrow()
        expect(h.db.rows('booking_extensions')).toHaveLength(0)
    })

    it('captures and applies an approved request', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: SOON_START, end, bookedAt: BOOKED })
        const req = extensionRequest(booking)

        await decideExtension(db(), req.extension.id, true, ADMIN)

        expect(h.stripe.intents.get(req.intent.id)!.status).toBe('succeeded')
        expect(bookingRow(booking.id).end_time).toBe(req.extension.to_end_time)
    })

    it('will not take the money for a request on a trip that has already been closed', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: SOON_START, end, bookedAt: BOOKED, status: 'completed' })
        const req = extensionRequest(booking)

        await expect(decideExtension(db(), req.extension.id, true, ADMIN)).rejects.toThrow("can't be applied")
        expect(h.stripe.intents.get(req.intent.id)!.status).toBe('requires_capture')

        await decideExtension(db(), req.extension.id, false, ADMIN)
        expect(h.stripe.intents.get(req.intent.id)!.status).toBe('canceled')
    })

    it('applies an abandoned extension payment that actually went through, instead of failing it', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: SOON_START, end, bookedAt: BOOKED })
        const intent = h.stripe.seedIntent({ amount: 6000, status: 'succeeded', metadata: { kind: 'extension' } })
        const charge = h.db.insert('booking_charges', { booking_id: booking.id, kind: 'extension', amount: 60, description: 'x', initiated_by: 'guest', status: 'requires_payment', stripe_payment_intent_id: intent.id, created_at: '2026-10-10T14:00:00Z' })
        intent.metadata.chargeId = charge.id
        const ext = h.db.insert('booking_extensions', { booking_id: booking.id, from_end_time: end, to_end_time: '2026-10-15T15:00:00Z', mode: 'instant', status: 'pending', quote: {}, amount: 60, charge_id: charge.id, created_at: '2026-10-10T14:00:00Z' })

        await runPaymentsSweep(db(), new Date(NOW))

        expect(chargeRow(charge.id).status).toBe('succeeded')
        expect(h.db.find('booking_extensions', ext.id)!.status).toBe('confirmed')
        expect(bookingRow(booking.id).end_time).toBe('2026-10-15T15:00:00Z')
    })
})

describe('extras requested after booking', () => {
    it('holds the card per extra, and captures only on approval, once', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: LATER_START, end: LATER_END, bookedAt: BOOKED })
        signIn(GUEST)
        await requestTripExtras({ data: { bookingId: booking.id, extraIds: ['child-seat'] } })
        const extra = h.db.rows('booking_extras').find(e => e.extra_id === 'child-seat')!
        const intentId = chargeRow(extra.charge_id).stripe_payment_intent_id
        expect(h.stripe.intents.get(intentId)!.status).toBe('requires_capture')

        signIn(ADMIN)
        await decideTripExtra({ data: { extraId: extra.id, approve: true } })
        const again = await decideTripExtra({ data: { extraId: extra.id, approve: true } })

        expect(again.alreadyDecided).toBe(true)
        expect(h.stripe.intents.get(intentId)!.status).toBe('succeeded')
        expect(h.stripe.calls.filter(c => c === `paymentIntents.capture:${intentId}`)).toHaveLength(1)
    })

    it('refuses requests on a cancelled trip, after pickup, for checkout-only extras, and from a guest for an owner decision', async () => {
        world(NOW)
        const cancelled = paidTrip({ start: LATER_START, end: LATER_END, bookedAt: BOOKED, status: 'canceled' })
        const started = paidTrip({ start: '2026-10-09T15:00:00Z', end: LATER_END, bookedAt: BOOKED, carId: 7 })
        const upcoming = paidTrip({ start: LATER_START, end: LATER_END, bookedAt: BOOKED, carId: 7, userId: GUEST })
        signIn(GUEST)

        await expect(requestTripExtras({ data: { bookingId: cancelled.booking.id, extraIds: ['child-seat'] } })).rejects.toThrow('confirmed trip')
        await expect(requestTripExtras({ data: { bookingId: started.booking.id, extraIds: ['child-seat'] } })).rejects.toThrow('before the trip starts')
        await expect(requestTripExtras({ data: { bookingId: upcoming.booking.id, extraIds: ['unlimited-mileage'] } })).rejects.toThrow('only be added when you book')

        const req = extraRequest(upcoming.booking)
        await expect(decideTripExtra({ data: { extraId: req.extra.id, approve: true } })).rejects.toThrow('Not authorized')
        expect(h.stripe.intents.get(req.intent.id)!.status).toBe('requires_capture')
    })
})

describe('our own charges', () => {
    const charge = (bookingId: string) => createAdjustmentCharge(db(), { bookingId, category: 'damage', description: 'Dent', amount: 100, createdBy: ADMIN })

    const UNDER_WAY = '2026-10-09T15:00:00Z'

    it('charges a trip once it has started, with tax, and not before pickup', async () => {
        world(NOW)
        const upcoming = paidTrip({ start: LATER_START, end: LATER_END, bookedAt: BOOKED, carId: 7 })
        await expect(charge(upcoming.booking.id)).rejects.toThrow('Charges open at pickup')

        const { booking } = paidTrip({ start: UNDER_WAY, end: LATER_END, bookedAt: BOOKED })
        const attempt = await charge(booking.id)
        expect(attempt.charge.status).toBe('succeeded')
        expect(h.stripe.intents.get(attempt.charge.stripe_payment_intent_id!)!.amount).toBe(Math.round((100 + attempt.charge.tax_amount) * 100))
    })

    it('charges a trip cancelled after it started, but not one cancelled before, nor a hold', async () => {
        world(NOW)
        const before = paidTrip({ start: LATER_START, end: LATER_END, bookedAt: BOOKED, status: 'canceled' })
        bookingRow(before.booking.id).canceled_at = '2026-10-05T15:00:00Z'
        const after = paidTrip({ start: '2026-10-05T15:00:00Z', end: LATER_END, bookedAt: BOOKED, status: 'canceled', carId: 7 })
        bookingRow(after.booking.id).canceled_at = '2026-10-06T15:00:00Z'
        const hold = paidTrip({ start: LATER_START, end: LATER_END, bookedAt: NOW, status: 'pending', carId: 7 })

        await expect(charge(before.booking.id)).rejects.toThrow("can't be charged")
        await expect(charge(hold.booking.id)).rejects.toThrow("can't be charged")
        expect((await charge(after.booking.id)).charge.status).toBe('succeeded')
    })

    it('sends the guest a pay link, and tells us, when their card declines', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: UNDER_WAY, end: LATER_END, bookedAt: BOOKED })
        bookingRow(booking.id).payment_method_id = 'pm_decline'

        const attempt = await charge(booking.id)

        expect(attempt.charge.status).toBe('requires_payment')
        const payLink = emailsTo(GUEST_EMAIL).find(e => e.text?.includes(`/trips/${booking.id}/pay/${attempt.charge.id}`))
        expect(payLink).toBeTruthy()
        expect(emailsTo(ADMIN_EMAIL).some(e => e.subject.includes('Charge needs the guest'))).toBe(true)
    })
})

describe('refunding a later charge', () => {
    it('refunds in parts, never more than was paid, and a retry is not a second refund', async () => {
        world(NOW)
        const { booking } = paidTrip({ start: LATER_START, end: LATER_END, bookedAt: BOOKED })
        const { charge, intent } = paidCharge(booking, 'adjustment', 100)

        const once = await refundCharge(db(), (await loadCharge(db(), charge.id))!, 40, 'Goodwill')
        const retried = await refundCharge(db(), { ...(await loadCharge(db(), charge.id))!, amount_refunded: 0, refund_id: null } as any, 40, 'Goodwill')
        expect(retried.refund_id).toBe(once.refund_id)
        expect(h.stripe.refundedOn(intent.id)).toBe(40)

        await expect(refundCharge(db(), (await loadCharge(db(), charge.id))!, 61, 'Too much')).rejects.toThrow('between')
        await refundCharge(db(), (await loadCharge(db(), charge.id))!, 60, 'The rest')
        expect(h.stripe.refundedOn(intent.id)).toBe(100)
        await expect(refundCharge(db(), (await loadCharge(db(), charge.id))!, 1, 'More')).rejects.toThrow('Nothing on this charge')
    })
})
