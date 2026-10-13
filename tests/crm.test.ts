// The customer CRM: blocking, the licence snapshot, and the admin functions.
//
// What a block must and mustn't stop is the point of most of these: a blocked
// guest can't start anything new (checkout, ID verification, an extension, an
// extras request, a review), but can still pay a charge they owe, and an owner
// acting on their trip isn't stopped. And a new account verifying a blocked
// licence is caught, once, however many paths report the verification.

import { afterEach, describe, expect, it } from 'vitest'
import { h, signIn, emailsTo, ADMIN_EMAIL } from './harness'
import { world, paidTrip, unpaidCheckout, bookingRow, GUEST, OTHER_GUEST, ADMIN } from './fixtures'
import { createCheckoutSession, createIdentitySession, createReview, finalizeIdentitySession, requestTripExtras } from '../src/lib/db'
import { getChargePayLink, requestTripExtension } from '../src/lib/payments'
import {
    addCustomerNote,
    blockCustomer,
    deleteCustomerNote,
    getCustomer,
    getCustomerFlags,
    getCustomerIdentityImages,
    listCustomers,
    refreshCustomerIdentity,
    setCustomerLicenseNumber,
    setCustomerTags,
    unblockCustomer,
} from '../src/lib/crm'
import { activeBlockFor, activeBlocksFor, BLOCKED_MESSAGE, normalizeLicense } from '../src/lib/blocks'
import { csvField, normalizeTags, summarizeCustomerMoney } from '../src/lib/crm-summary'
import { resetRestrictedStripeForTests } from '../src/lib/identity.server'
import { checkLicenseAgainstBlocks } from '../src/lib/blocks.server'
import { Route as Webhook } from '../src/routes/api/stripe-webhook'

const NOW = '2026-10-10T17:00:00Z'
const START = '2026-10-20T15:00:00Z'
const END = '2026-10-23T15:00:00Z'
const LICENSE = 'A123-456-789-012'
const THIRD = '00000000-0000-4000-8000-00000000000c'

async function webhook(type: string, object: unknown) {
    const post = (Webhook as any).options.server.handlers.POST
    const request = new Request('https://test.bluefin/api/stripe-webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 'test' },
        body: JSON.stringify({ id: 'evt_test', type, data: { object } }),
    })
    return post({ request }) as Promise<Response>
}

/** A world with the restricted key set (unless told otherwise) and a third, new account. */
function setup(o: { restrictedKey?: boolean } = {}) {
    world(NOW)
    h.db.insert('profiles', { id: THIRD, full_name: 'Gina Again', email: 'gina2@test.bluefin', phone: null, is_admin: false })
    if (o.restrictedKey === false) delete process.env.STRIPE_IDENTITY_RESTRICTED_KEY
    else process.env.STRIPE_IDENTITY_RESTRICTED_KEY = 'rk_test_fake'
    resetRestrictedStripeForTests()
}

afterEach(() => {
    delete process.env.STRIPE_IDENTITY_RESTRICTED_KEY
    resetRestrictedStripeForTests()
})

/** A verification of `userId`, reported by the webhook the way Stripe would. */
async function verify(userId: string, licenseNumber = LICENSE) {
    const sessionId = h.stripe.seedVerifiedIdentity({ userId, licenseNumber })
    h.db.rows('profiles').find(p => p.id === userId)!.stripe_identity_session_id = sessionId
    const res = await webhook('identity.verification_session.verified', h.stripe.identitySessions.get(sessionId))
    expect(res.status).toBe(200)
    return sessionId
}

async function block(userId: string, reason = 'Smoke damage, disputed the charge') {
    signIn(ADMIN)
    return blockCustomer({ data: { userId, reason } })
}

const checkoutInput = () => ({
    carId: '5',
    startTime: START,
    endTime: END,
    startDateLocal: '2026-10-20',
    startTimeLocal: '10:00',
    endDateLocal: '2026-10-23',
    endTimeLocal: '10:00',
    totalPrice: 0,
    pickupLocation: 'Home base',
})

// ── The pure rules ───────────────────────────────────────────────────────────

describe('block rules', () => {
    it('normalizes licence numbers so punctuation and case never matter', () => {
        expect(normalizeLicense('A123-456 789')).toBe('A123456789')
        expect(normalizeLicense('a123456789')).toBe('A123456789')
        expect(normalizeLicense(' -- ')).toBeNull()
        expect(normalizeLicense(null)).toBeNull()
    })

    it('matches on the account or on the licence, ignores lifted blocks, account first', () => {
        const onAccount = { user_id: 'u1', license_number: null, lifted_at: null }
        const onLicense = { user_id: 'u2', license_number: 'A123', lifted_at: null }
        const lifted = { user_id: 'u3', license_number: 'B999', lifted_at: '2026-01-01T00:00:00Z' }
        const all = [onLicense, onAccount, lifted]
        expect(activeBlockFor(all, { userId: 'u1', licenseNumber: 'a-123' })).toBe(onAccount)
        expect(activeBlocksFor(all, { userId: 'u1', licenseNumber: 'a-123' })).toEqual([onAccount, onLicense])
        expect(activeBlockFor(all, { userId: 'u9', licenseNumber: 'A123' })).toBe(onLicense)
        expect(activeBlockFor(all, { userId: 'u3', licenseNumber: 'B999' })).toBeNull()
        expect(activeBlockFor(all, { userId: 'u9', licenseNumber: null })).toBeNull()
    })

    it('normalizes tags: trimmed, deduplicated ignoring case, capped', () => {
        expect(normalizeTags([' VIP ', 'vip', 'Late   return', ''])).toEqual(['VIP', 'Late return'])
        expect(() => normalizeTags(Array.from({ length: 13 }, (_, i) => `t${i}`))).toThrow('at most 12')
    })

    it('defuses spreadsheet formulas in the CSV export, and quotes when needed', () => {
        expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
        expect(csvField('Smith, Jo')).toBe('"Smith, Jo"')
        expect(csvField(-5)).toBe('-5')
        expect(csvField(null)).toBe('')
    })

    it('adds up what a customer paid: checkouts net of refunds plus later charges; unpaid checkouts count for nothing', () => {
        const money = summarizeCustomerMoney(
            [
                { id: 'b1', status: 'completed', total_price: 300, refunded_amount: null },
                { id: 'b2', status: 'canceled', total_price: 200, refunded_amount: 150 },
                { id: 'b3', status: 'expired', total_price: 999, refunded_amount: null },
            ],
            [
                { booking_id: 'b1', kind: 'adjustment', status: 'succeeded', amount: 80, tax_amount: 0, amount_captured: 80, amount_refunded: 20 },
                { booking_id: 'b1', kind: 'deposit', status: 'succeeded', amount: 1500, tax_amount: 0, amount_captured: 400, amount_refunded: 0 },
                { booking_id: 'b1', kind: 'adjustment', status: 'requires_payment', amount: 50, tax_amount: 5, amount_captured: 0, amount_refunded: 0 },
                { booking_id: 'b3', kind: 'extension', status: 'succeeded', amount: 10, tax_amount: 0, amount_captured: 10, amount_refunded: 0 },
            ],
        )
        expect(money).toEqual({ lifetimePaid: 300 + 50 + 60 + 400, refunded: 150 + 20, owed: 55, depositsKept: 400 })
    })
})

// ── What a block stops ───────────────────────────────────────────────────────

describe('a blocked customer', () => {
    it('cannot check out: no PaymentIntent, no booking row', async () => {
        setup()
        await block(GUEST)
        signIn(GUEST)
        const intentsBefore = h.stripe.intents.size
        const bookingsBefore = h.db.rows('bookings').length

        await expect(createCheckoutSession({ data: checkoutInput() })).rejects.toThrow(BLOCKED_MESSAGE)

        expect(h.stripe.intents.size).toBe(intentsBefore)
        expect(h.db.rows('bookings')).toHaveLength(bookingsBefore)
    })

    it('cannot start ID verification, extend, request extras or review', async () => {
        setup()
        const trip = paidTrip({ start: START, end: END, bookedAt: '2026-10-01T15:00:00Z' })
        const done = paidTrip({ start: '2026-09-01T15:00:00Z', end: '2026-09-03T15:00:00Z', bookedAt: '2026-08-20T15:00:00Z', status: 'completed', carId: 7 })
        await block(GUEST)
        signIn(GUEST)

        await expect(createIdentitySession({ data: { returnUrl: 'https://test.bluefin/x' } })).rejects.toThrow(BLOCKED_MESSAGE)
        await expect(requestTripExtension({ data: { bookingId: trip.booking.id, newEndDate: '2026-10-24', newEndTime: '10:00' } }))
            .rejects.toThrow(BLOCKED_MESSAGE)
        await expect(requestTripExtras({ data: { bookingId: trip.booking.id, extraIds: ['child-seat'] } })).rejects.toThrow(BLOCKED_MESSAGE)
        await expect(createReview({ data: { bookingId: done.booking.id, rating: 5, body: 'Great car, would rent again.' } }))
            .rejects.toThrow(BLOCKED_MESSAGE)

        expect(h.db.rows('booking_extensions')).toHaveLength(0)
        expect(h.db.rows('booking_extras')).toHaveLength(0)
        expect(h.db.rows('reviews')).toHaveLength(0)
    })

    it('can still pay a charge they owe, and an owner can still extend their trip', async () => {
        setup()
        const trip = paidTrip({ start: START, end: END, bookedAt: '2026-10-01T15:00:00Z' })
        const intent = h.stripe.seedIntent({ amount: 5000, status: 'requires_payment_method', metadata: { kind: 'adjustment', bookingId: trip.booking.id } })
        const charge = h.db.insert('booking_charges', {
            booking_id: trip.booking.id, kind: 'adjustment', category: 'damage', description: 'Scratch', amount: 50,
            status: 'requires_payment', stripe_payment_intent_id: intent.id, initiated_by: 'admin',
        })
        intent.metadata.chargeId = charge.id
        await block(GUEST)

        signIn(GUEST)
        const link = await getChargePayLink({ data: { bookingId: trip.booking.id, chargeId: charge.id } })
        expect(link.clientSecret).toBeTruthy()

        signIn(ADMIN)
        const ext = await requestTripExtension({ data: { bookingId: trip.booking.id, newEndDate: '2026-10-24', newEndTime: '10:00' } })
        expect(ext.error ?? null).toBeNull()
        expect(h.db.rows('booking_extensions')).toHaveLength(1)
    })

    it('has every payable checkout closed; a confirmed trip is left alone and reported', async () => {
        setup()
        const confirmed = paidTrip({ start: START, end: END, bookedAt: '2026-10-01T15:00:00Z' })
        const live = unpaidCheckout({ start: '2026-11-01T15:00:00Z', end: '2026-11-03T15:00:00Z', createdAt: '2026-10-10T16:40:00Z' })
        const lapsed = unpaidCheckout({ start: '2026-11-05T15:00:00Z', end: '2026-11-07T15:00:00Z', createdAt: '2026-10-09T10:00:00Z', status: 'expired' })
        const emailsBefore = h.emails.length

        const result = await block(GUEST)

        expect(bookingRow(live.booking.id).status).toBe('expired')
        expect(h.stripe.intents.get(live.intent.id)!.status).toBe('canceled')
        expect(h.stripe.intents.get(lapsed.intent.id)!.status).toBe('canceled') // a late payment can't revive it
        expect(bookingRow(confirmed.booking.id).status).toBe('confirmed')
        expect(h.stripe.intents.get(confirmed.intent.id)!.status).toBe('succeeded')
        expect(result.releasedCheckouts).toBe(2)
        expect(result.upcomingTrips.map(t => t.id)).toEqual([confirmed.booking.id])
        expect(h.emails).toHaveLength(emailsBefore) // nobody is told
    })

    it('is let through again once unblocked', async () => {
        setup()
        await block(GUEST)
        signIn(ADMIN)
        await unblockCustomer({ data: { userId: GUEST, reason: 'Paid in full, spoke on the phone' } })

        signIn(GUEST)
        const outcome = await createCheckoutSession({ data: checkoutInput() }).then(() => null, (e: Error) => e.message)
        expect(outcome).not.toBe(BLOCKED_MESSAGE)
        expect(h.db.rows('customer_blocks')[0].lifted_at).not.toBeNull() // kept as history
    })
})

describe('blocking itself', () => {
    it('refuses admins, an empty reason, and a second active block', async () => {
        setup()
        signIn(ADMIN)
        await expect(blockCustomer({ data: { userId: ADMIN, reason: 'x' } })).rejects.toThrow('Admins cannot be blocked')
        await expect(blockCustomer({ data: { userId: GUEST, reason: '  ' } })).rejects.toThrow('reason')
        await blockCustomer({ data: { userId: GUEST, reason: 'First' } })
        await expect(blockCustomer({ data: { userId: GUEST, reason: 'Again' } })).rejects.toThrow('already blocked')
        expect(h.db.rows('customer_blocks')).toHaveLength(1)
    })

    it('puts the stored licence on the block', async () => {
        setup()
        await verify(GUEST)
        const { block: b } = await block(GUEST)
        expect(b.license_number).toBe(normalizeLicense(LICENSE))
    })
})

// ── The licence snapshot and the licence blocklist ───────────────────────────

describe('ID verification documents', () => {
    it("accepts a driver's licence only, and won't resume a session that also took ID cards", async () => {
        setup()
        signIn(GUEST)
        const old = 'vs_old_rule'
        h.stripe.identitySessions.set(old, {
            id: old, status: 'requires_input', url: 'https://verify.stripe.test/old', metadata: { userId: GUEST },
            options: { document: { allowed_types: ['driving_license', 'id_card'] } },
        })
        h.db.rows('profiles').find(p => p.id === GUEST)!.stripe_identity_session_id = old

        const first = await createIdentitySession({ data: { returnUrl: 'https://test.bluefin/x' } })
        expect(first.sessionId).not.toBe(old)
        expect(h.stripe.identityCreated.map(p => p.options.document.allowed_types)).toEqual([['driving_license']])

        // A session made under the current rule is resumed, not replaced.
        const again = await createIdentitySession({ data: { returnUrl: 'https://test.bluefin/x' } })
        expect(again.sessionId).toBe(first.sessionId)
        expect(h.stripe.identityCreated).toHaveLength(1)
    })
})

describe('the licence snapshot', () => {
    it('copies the licence when the webhook reports a verification', async () => {
        setup()
        await verify(GUEST)
        const row = h.db.rows('customer_identities').find(r => r.user_id === GUEST)!
        expect(row).toMatchObject({
            license_number: 'A123456789012', dob: '1990-04-05', expiration_date: '2030-04-05',
            first_name: 'Gina', issuing_country: 'US', issuing_state: 'MN', document_type: 'driving_license',
            sensitive_captured: true,
        })
    })

    it('keeps what it can without the restricted key, and never throws', async () => {
        setup({ restrictedKey: false })
        await verify(GUEST)
        const row = h.db.rows('customer_identities').find(r => r.user_id === GUEST)!
        expect(row.first_name).toBe('Gina')
        expect(row.license_number).toBeNull()
        expect(row.sensitive_captured).toBe(false)
    })

    it('never wipes the licence when re-read after the 48 hours', async () => {
        setup()
        await verify(GUEST)
        h.stripe.sensitiveExpired = true
        signIn(ADMIN)
        await refreshCustomerIdentity({ data: GUEST })
        const rows = h.db.rows('customer_identities').filter(r => r.user_id === GUEST)
        expect(rows).toHaveLength(1)
        expect(rows[0].license_number).toBe('A123456789012')
        expect(rows[0].dob).toBe('1990-04-05')
    })

    it('shows the photos within 48 hours, and points to Stripe after', async () => {
        setup()
        await verify(GUEST)
        signIn(ADMIN)
        const shown = await getCustomerIdentityImages({ data: GUEST })
        expect(shown.available && shown.images.map(i => i.label)).toEqual(['Licence front', 'Licence back', 'Selfie'])

        const sessionId = h.db.rows('customer_identities')[0].verification_session_id
        h.stripe.identitySessions.get(sessionId).last_verification_report.created = Math.floor(Date.now() / 1000) - 49 * 3600
        const later = await getCustomerIdentityImages({ data: GUEST })
        expect(later.available).toBe(false)
    })
})

describe('a blocked licence on a new account', () => {
    it('blocks the new account when it verifies, and emails the owners once', async () => {
        setup()
        await verify(GUEST)
        await block(GUEST)
        const before = emailsTo(ADMIN_EMAIL).length

        const sessionId = await verify(THIRD) // same licence, new email
        // Stripe retries, and the checkout page's finalize call arrives too.
        await webhook('identity.verification_session.verified', h.stripe.identitySessions.get(sessionId))
        signIn(THIRD)
        await finalizeIdentitySession({ data: { sessionId } })

        const blocks = h.db.rows('customer_blocks').filter(b => b.user_id === THIRD && b.lifted_at == null)
        expect(blocks).toHaveLength(1)
        expect(blocks[0].source).toBe('license_match')
        expect(emailsTo(ADMIN_EMAIL).length - before).toBe(1)
        await expect(createCheckoutSession({ data: checkoutInput() })).rejects.toThrow(BLOCKED_MESSAGE)
    })

    it('leaves a different licence alone', async () => {
        setup()
        await verify(GUEST)
        await block(GUEST)
        await verify(THIRD, 'Z999-000')
        expect(h.db.rows('customer_blocks').filter(b => b.user_id === THIRD)).toHaveLength(0)
    })

    it('a licence typed in by hand blocks the same way', async () => {
        setup({ restrictedKey: false })
        await verify(GUEST) // no licence captured
        signIn(ADMIN)
        await blockCustomer({ data: { userId: GUEST, reason: 'Stole a car', licenseNumber: LICENSE } })
        await verify(OTHER_GUEST) // no licence captured either
        signIn(ADMIN)
        const { blocked } = await setCustomerLicenseNumber({ data: { userId: OTHER_GUEST, licenseNumber: 'a123 456 789 012' } })
        expect(blocked).toBe(true)
        expect(h.db.rows('customer_notes').some(n => n.user_id === OTHER_GUEST)).toBe(true)
    })

    it('two verifications reported at the same moment add one block and one email', async () => {
        setup({ restrictedKey: true })
        await verify(GUEST)
        await block(GUEST)
        h.db.insert('customer_identities', { user_id: THIRD, verification_session_id: 'vs_x', license_number: 'A123456789012' })
        const before = emailsTo(ADMIN_EMAIL).length

        const results = await Promise.all([
            checkLicenseAgainstBlocks(h.db as any, THIRD, LICENSE),
            checkLicenseAgainstBlocks(h.db as any, THIRD, LICENSE),
        ])

        expect(results).toEqual([true, true])
        expect(h.db.rows('customer_blocks').filter(b => b.user_id === THIRD)).toHaveLength(1)
        expect(emailsTo(ADMIN_EMAIL).length - before).toBe(1)
    })

    it('unblocking either account lifts the whole person', async () => {
        for (const who of [THIRD, GUEST]) {
            setup()
            await verify(GUEST)
            await block(GUEST)
            await verify(THIRD)
            signIn(ADMIN)
            const result = await unblockCustomer({ data: { userId: who, reason: 'Our mistake' } })
            expect(result.lifted).toBe(2)
            expect(h.db.rows('customer_blocks').filter(b => b.lifted_at == null)).toHaveLength(0)
        }
    })
})

// ── The admin functions ──────────────────────────────────────────────────────

describe('CRM server functions', () => {
    it('refuse anyone but an admin', async () => {
        setup()
        signIn(GUEST)
        const calls: Promise<unknown>[] = [
            listCustomers(),
            getCustomer({ data: OTHER_GUEST }),
            getCustomerFlags({ data: [OTHER_GUEST] }),
            addCustomerNote({ data: { userId: OTHER_GUEST, body: 'hi' } }),
            deleteCustomerNote({ data: 'x' }),
            setCustomerTags({ data: { userId: OTHER_GUEST, tags: ['VIP'] } }),
            blockCustomer({ data: { userId: OTHER_GUEST, reason: 'x' } }),
            unblockCustomer({ data: { userId: OTHER_GUEST, reason: 'x' } }),
            getCustomerIdentityImages({ data: OTHER_GUEST }),
            refreshCustomerIdentity({ data: OTHER_GUEST }),
            setCustomerLicenseNumber({ data: { userId: OTHER_GUEST, licenseNumber: 'A1234' } }),
        ]
        for (const call of calls) await expect(call).rejects.toThrow('Not authorized')
        signIn(null)
        await expect(listCustomers()).rejects.toThrow('Not authenticated')
        expect(h.db.rows('customer_blocks')).toHaveLength(0)
        expect(h.db.rows('customer_notes')).toHaveLength(0)
    })

    it('list and read a customer with their trips, money, tags, notes and block', async () => {
        setup()
        paidTrip({ start: START, end: END, bookedAt: '2026-10-01T15:00:00Z' })
        unpaidCheckout({ start: '2026-11-01T15:00:00Z', end: '2026-11-03T15:00:00Z', createdAt: '2026-10-01T10:00:00Z', status: 'expired' })
        await verify(GUEST)
        signIn(ADMIN)
        await setCustomerTags({ data: { userId: GUEST, tags: ['VIP', 'vip', 'Repeat'] } })
        await addCustomerNote({ data: { userId: GUEST, body: 'Lovely guest.' } })
        await blockCustomer({ data: { userId: GUEST, reason: 'Test' } })

        const list = await listCustomers()
        const row = list.find(c => c.id === GUEST)!
        expect(row).toMatchObject({ trips: 1, tags: ['VIP', 'Repeat'], blockReason: 'Test', identityVerified: true })
        expect(row.nextTripStart).toBe(START)
        expect(row.lifetimePaid).toBeGreaterThan(0)

        const detail = await getCustomer({ data: GUEST })
        expect(detail.identity?.licenseNumber).toBe('A123456789012')
        expect(detail.trips).toHaveLength(2)
        expect(detail.notes.map(n => n.body)).toEqual(['Lovely guest.'])
        expect(detail.activeBlocks).toHaveLength(1)

        const flags = await getCustomerFlags({ data: [GUEST, OTHER_GUEST] })
        expect(flags[GUEST]).toEqual({ tags: ['VIP', 'Repeat'], blocked: true })
        expect(flags[OTHER_GUEST]).toEqual({ tags: [], blocked: false })
    })
})
