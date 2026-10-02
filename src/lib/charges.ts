// The charge ledger's vocabulary: what a charge after checkout can be, and how
// each state is described to a person.
//
// Pure and isomorphic. The ledger itself is public.booking_charges; the money
// moves in src/lib/payments.server.ts. The policy is in
// ImportantFiles/charges-and-invoicing.md.
//
// ── One booking, many charges ────────────────────────────────────────────────
// The checkout charge is bookings.stripe_payment_intent_id + the frozen
// bookings.price_quote, and it never changes. Every charge after it is one row
// in booking_charges with its own PaymentIntent. A receipt is a record of a
// transaction, so nothing here ever rewrites one: a new charge is a new row,
// shown below the original.

import type { TaxLine } from './tax.ts'

export type ChargeKind = 'extension' | 'extra' | 'deposit' | 'adjustment'

export type ChargeStatus =
    | 'requires_payment'
    | 'processing'
    | 'authorized'
    | 'succeeded'
    | 'failed'
    | 'canceled'

export type ChargeInitiator = 'guest' | 'admin' | 'system'

/**
 * What an owner can bill a guest for after checkout.
 *
 * PROPOSED (2026-09-25), awaiting the owners' review — see decisions-log.md.
 * There are deliberately no preset amounts: every figure is entered by an owner
 * for the specific trip. Mileage is the exception only in that the form
 * pre-fills it from calculateOverage in src/lib/distance.ts, whose rate the
 * guest was shown when booking; the owner still confirms it.
 *
 * `taxKey` is the line type src/lib/tax.ts decides taxability for.
 */
export const CHARGE_CATEGORIES = [
    { id: 'damage', label: 'Damage', taxKey: 'damage' },
    { id: 'mileage', label: 'Mileage overage', taxKey: 'mileage' },
    { id: 'fuel', label: 'Fuel', taxKey: 'fuel' },
    { id: 'tolls', label: 'Tolls', taxKey: 'tolls' },
    { id: 'cleaning', label: 'Cleaning', taxKey: 'cleaning' },
    { id: 'late-return', label: 'Late return', taxKey: 'late-return' },
    { id: 'other', label: 'Other', taxKey: 'other' },
] as const

export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number]['id']

export function isChargeCategory(value: unknown): value is ChargeCategory {
    return CHARGE_CATEGORIES.some(c => c.id === value)
}

export function chargeCategoryLabel(id: string | null | undefined): string | null {
    return CHARGE_CATEGORIES.find(c => c.id === id)?.label ?? null
}

/** A line inside a charge's snapshot, e.g. one added day of an extension. */
export type ChargeLineItem = {
    label: string
    amount: number
    /** Days, units — shown as a sub-line when present. */
    detail?: string
}

/** A booking_charges row as the pages see it. Money as numbers, dollars. */
export type ChargeRow = {
    id: string
    booking_id: string
    kind: ChargeKind
    category: string | null
    description: string
    amount: number
    tax_amount: number
    tax_lines: TaxLine[]
    line_items: ChargeLineItem[]
    amount_captured: number
    amount_refunded: number
    status: ChargeStatus
    stripe_payment_intent_id: string | null
    failure_message: string | null
    capture_before: string | null
    keep_holding: boolean
    renews_charge_id: string | null
    /** The most recent Stripe refund on this charge. */
    refund_id: string | null
    initiated_by: ChargeInitiator
    created_at: string
    settled_at: string | null
}

export const CHARGE_SELECT =
    'id, booking_id, kind, category, description, amount, tax_amount, tax_lines, line_items, ' +
    'amount_captured, amount_refunded, status, stripe_payment_intent_id, failure_message, ' +
    'capture_before, keep_holding, renews_charge_id, refund_id, initiated_by, created_at, settled_at'

/** numeric arrives as a string from PostgREST; jsonb arrives untyped. */
export function toChargeRow(row: any): ChargeRow {
    return {
        ...row,
        amount: Number(row.amount) || 0,
        tax_amount: Number(row.tax_amount) || 0,
        amount_captured: Number(row.amount_captured) || 0,
        amount_refunded: Number(row.amount_refunded) || 0,
        tax_lines: Array.isArray(row.tax_lines) ? row.tax_lines : [],
        line_items: Array.isArray(row.line_items) ? row.line_items : [],
    }
}

/** amount + tax: what the PaymentIntent is for. */
export function chargeTotal(charge: Pick<ChargeRow, 'amount' | 'tax_amount'>): number {
    return Math.round((charge.amount + charge.tax_amount) * 100) / 100
}

/**
 * What a guest has paid since checkout, net of refunds: every settled charge —
 * extensions, extras, owners' charges, and the part of a deposit that was kept.
 * Pass deposits in too. The "Total paid" on the trip pages is the checkout total
 * plus this.
 */
export function paidAfterCheckout(charges: Pick<ChargeRow, 'status' | 'amount_captured' | 'amount_refunded'>[]): number {
    const cents = charges
        .filter(c => c.status === 'succeeded')
        .reduce((sum, c) => sum + Math.round((c.amount_captured - c.amount_refunded) * 100), 0)
    return Math.max(0, cents) / 100
}

/** Whether a charge is money the guest actually paid (and so belongs on a receipt). */
export function isPaidCharge(charge: Pick<ChargeRow, 'status' | 'kind'>): boolean {
    return charge.status === 'succeeded'
}

/** Whether the guest has to act on it themselves (the pay link). */
export function needsGuestPayment(charge: Pick<ChargeRow, 'status' | 'kind'>): boolean {
    return charge.status === 'requires_payment' && charge.kind !== 'deposit'
}

export function chargeKindLabel(charge: Pick<ChargeRow, 'kind' | 'category'>): string {
    switch (charge.kind) {
        case 'extension': return 'Trip extension'
        case 'extra': return 'Extras'
        case 'deposit': return 'Security deposit hold'
        case 'adjustment': return chargeCategoryLabel(charge.category) ?? 'Charge'
    }
}

/** Plain-words status, the same on the guest and admin pages. */
export function chargeStatusLabel(charge: Pick<ChargeRow, 'status' | 'kind' | 'amount_captured' | 'amount_refunded'>): string {
    const isHold = charge.kind === 'deposit'
    switch (charge.status) {
        case 'requires_payment': return isHold ? 'Not yet placed' : 'Awaiting payment'
        case 'processing': return 'Processing'
        case 'authorized': return isHold ? 'Held on card' : 'Held, awaiting approval'
        case 'succeeded':
            if (charge.amount_refunded > 0) {
                return charge.amount_refunded >= charge.amount_captured ? 'Refunded' : 'Partly refunded'
            }
            return isHold ? 'Captured' : 'Paid'
        case 'failed': return 'Declined'
        case 'canceled': return isHold ? 'Released' : 'Canceled'
    }
}