// An in-memory Stripe, for testing the payment code without the network.
//
// It keeps the behaviours the code depends on, including the awkward ones:
//   - idempotency keys return the original object, and a reused key with
//     different parameters is refused (as Stripe does);
//   - a refund can't exceed what's left on the payment;
//   - a succeeded or already-cancelled intent can't be cancelled;
//   - a card error carries the intent it happened to (err.raw.payment_intent).
//
// Payment methods choose the card's behaviour, like Stripe's test cards:
//   pm_ok       succeeds (or authorizes, with manual capture)
//   pm_decline  declined (StripeCardError)
//   pm_3ds      needs 3D Secure: requires_action on-session, a decline off-session

let counter = 0
const nextId = (prefix: string) => `${prefix}_test_${++counter}`

export type FakeIntent = {
    id: string
    object: 'payment_intent'
    amount: number
    amount_received: number
    currency: string
    status: string
    capture_method: string
    customer: string | null
    payment_method: string | null
    setup_future_usage: string | null
    metadata: Record<string, string>
    client_secret: string
    latest_charge: any
    last_payment_error: { message: string } | null
    description?: string
}

class StripeError extends Error {
    type: string
    raw: any
    code?: string
    constructor(message: string, type: string, raw: any = {}) {
        super(message)
        this.type = type
        this.raw = { ...raw, type: type === 'StripeCardError' ? 'card_error' : 'invalid_request_error' }
    }
}

export class FakeStripe {
    intents = new Map<string, FakeIntent>()
    refundsMade: { id: string; payment_intent: string; amount: number }[] = []
    private idempotent = new Map<string, { params: string; result: any }>()
    /** Test controls. */
    failNextRefund = false
    /** Intent ids Stripe will refuse to cancel (e.g. still processing). */
    uncancellable = new Set<string>()
    calls: string[] = []

    private keyed<T>(key: string | undefined, params: unknown, make: () => T): T {
        if (!key) return make()
        const p = JSON.stringify(params)
        const hit = this.idempotent.get(key)
        if (hit) {
            if (hit.params !== p) {
                throw new StripeError('Keys for idempotent requests can only be used with the same parameters they were first used with.', 'StripeIdempotencyError')
            }
            return hit.result
        }
        const result = make()
        this.idempotent.set(key, { params: p, result })
        return result
    }

    /** Simulates Stripe forgetting idempotency keys (they last 24 hours). */
    forgetIdempotencyKeys() {
        this.idempotent.clear()
    }

    private charge(intent: FakeIntent) {
        if (!intent.latest_charge) {
            intent.latest_charge = {
                id: nextId('ch'),
                amount_refunded: 0,
                receipt_url: null,
                payment_method_details: { card: { brand: 'visa', last4: '4242', capture_before: null } },
            }
        }
        return intent.latest_charge
    }

    /** Puts a payment straight into a state, e.g. a paid checkout. */
    seedIntent(fields: Partial<FakeIntent> & { amount: number; status: string }): FakeIntent {
        const intent: FakeIntent = {
            id: nextId('pi'),
            object: 'payment_intent',
            amount_received: fields.status === 'succeeded' ? fields.amount : 0,
            currency: 'usd',
            capture_method: 'automatic',
            customer: 'cus_test',
            payment_method: 'pm_ok',
            setup_future_usage: 'off_session',
            metadata: {},
            client_secret: 'secret',
            latest_charge: null,
            last_payment_error: null,
            ...fields,
        }
        if (['succeeded', 'requires_capture'].includes(intent.status)) this.charge(intent)
        this.intents.set(intent.id, intent)
        return intent
    }

    private intent(id: string): FakeIntent {
        const i = this.intents.get(id)
        if (!i) throw new StripeError(`No such payment_intent: '${id}'`, 'StripeInvalidRequestError')
        return i
    }

    paymentIntents = {
        create: async (params: any, opts?: { idempotencyKey?: string }) => {
            this.calls.push('paymentIntents.create')
            const intent = this.keyed(opts?.idempotencyKey, params, () => {
                const manual = params.capture_method === 'manual'
                const intent = this.seedIntent({
                    amount: params.amount,
                    status: 'requires_payment_method',
                    capture_method: params.capture_method ?? 'automatic',
                    customer: params.customer ?? null,
                    payment_method: params.payment_method ?? null,
                    setup_future_usage: params.setup_future_usage ?? null,
                    metadata: params.metadata ?? {},
                    description: params.description,
                })
                if (!params.confirm) return intent
                const pm = params.payment_method
                if (pm === 'pm_decline' || (pm === 'pm_3ds' && params.off_session)) {
                    intent.status = 'requires_payment_method'
                    intent.last_payment_error = { message: 'Your card was declined.' }
                    ;(intent as any).__error = true
                } else if (pm === 'pm_3ds') {
                    intent.status = 'requires_action'
                } else {
                    intent.status = manual ? 'requires_capture' : 'succeeded'
                    intent.amount_received = manual ? 0 : intent.amount
                    this.charge(intent)
                }
                return intent
            })
            if ((intent as any).__error) {
                throw new StripeError('Your card was declined.', 'StripeCardError', { payment_intent: { id: intent.id } })
            }
            return structuredClone(intent)
        },
        retrieve: async (id: string) => {
            this.calls.push('paymentIntents.retrieve')
            return structuredClone(this.intent(id))
        },
        update: async (id: string, params: any) => {
            const intent = this.intent(id)
            Object.assign(intent, params)
            return structuredClone(intent)
        },
        cancel: async (id: string) => {
            this.calls.push(`paymentIntents.cancel:${id}`)
            const intent = this.intent(id)
            if (this.uncancellable.has(id) || ['succeeded', 'canceled'].includes(intent.status)) {
                throw new StripeError(`You cannot cancel this PaymentIntent because it has a status of ${intent.status}.`, 'StripeInvalidRequestError')
            }
            intent.status = 'canceled'
            return structuredClone(intent)
        },
        capture: async (id: string, params: any = {}, opts?: { idempotencyKey?: string }) => {
            this.calls.push(`paymentIntents.capture:${id}`)
            return this.keyed(opts?.idempotencyKey, { id, params }, () => {
                const intent = this.intent(id)
                if (intent.status !== 'requires_capture') {
                    throw new StripeError(`This PaymentIntent could not be captured because it has a status of ${intent.status}.`, 'StripeInvalidRequestError')
                }
                intent.status = 'succeeded'
                intent.amount_received = params.amount_to_capture ?? intent.amount
                return structuredClone(intent)
            })
        },
    }

    refunds = {
        create: async (params: any, opts?: { idempotencyKey?: string }) => {
            this.calls.push(`refunds.create:${params.payment_intent}`)
            if (this.failNextRefund) {
                this.failNextRefund = false
                throw new StripeError('Refund failed (test)', 'StripeAPIError')
            }
            return this.keyed(opts?.idempotencyKey, params, () => {
                const intent = this.intent(params.payment_intent)
                const charge = this.charge(intent)
                const left = intent.amount_received - charge.amount_refunded
                const amount = params.amount ?? left
                if (amount <= 0 || amount > left) {
                    throw new StripeError(`Refund amount ($${(amount / 100).toFixed(2)}) is greater than unrefunded amount on charge ($${(left / 100).toFixed(2)})`, 'StripeInvalidRequestError')
                }
                charge.amount_refunded += amount
                const refund = { id: nextId('re'), object: 'refund', amount, payment_intent: intent.id, status: 'succeeded' }
                this.refundsMade.push({ id: refund.id, payment_intent: intent.id, amount })
                return refund
            })
        },
    }

    charges = {
        retrieve: async (id: string) => {
            for (const i of this.intents.values()) if (i.latest_charge?.id === id) return structuredClone(i.latest_charge)
            throw new StripeError(`No such charge: '${id}'`, 'StripeInvalidRequestError')
        },
    }

    customers = {
        create: async () => ({ id: nextId('cus') }),
        retrieve: async (id: string) => ({ id, deleted: false }),
        update: async (id: string) => ({ id }),
        del: async (id: string) => ({ id, deleted: true }),
    }

    paymentMethods = {
        retrieve: async (id: string) => ({ id, type: 'card', card: { brand: 'visa', last4: '4242' } }),
    }

    setupIntents = {
        create: async () => ({ id: nextId('seti'), client_secret: 'seti_secret' }),
        retrieve: async (id: string) => ({ id, status: 'succeeded', metadata: {}, payment_method: 'pm_ok', customer: 'cus_test' }),
    }

    webhooks = {
        // The tests hand the handler a JSON body; signature checking is the
        // Stripe SDK's job and isn't what's under test.
        constructEvent: (body: string) => JSON.parse(body),
    }

    identity = { verificationSessions: { create: async () => ({}), retrieve: async () => ({}) } }

    /** Total refunded on a payment, in dollars. */
    refundedOn(intentId: string): number {
        return (this.intents.get(intentId)?.latest_charge?.amount_refunded ?? 0) / 100
    }
}
