// The CRM's arithmetic and formatting, kept pure so the list page, the
// customer page and the tests all use the same rules.
//
// Isomorphic: imported by admin pages and by src/lib/crm.ts.

import { paidAfterCheckout, type ChargeStatus } from './charges.ts'

/** Statuses whose checkout payment went through. A cancelled trip counts, net of its refund. */
const PAID_CHECKOUT = new Set(['confirmed', 'completed', 'canceled'])

export type MoneyBooking = { id: string; status: string; total_price: number | string; refunded_amount: number | string | null }
export type MoneyCharge = {
    booking_id: string
    kind: string
    status: ChargeStatus
    amount: number
    tax_amount: number
    amount_captured: number
    amount_refunded: number
}

export type CustomerMoney = {
    /** Everything they've paid us, net of every refund. Same rule as the reservation page's "Total Earnings". */
    lifetimePaid: number
    /** Refunded to them: checkout refunds plus refunds on later charges. */
    refunded: number
    /** Charges waiting on them to pay (the pay link), deposits excluded. */
    owed: number
    /** Deposit money kept, net of any refund of it. */
    depositsKept: number
}

const round = (n: number) => Math.round(n * 100) / 100

export function summarizeCustomerMoney(bookings: MoneyBooking[], charges: MoneyCharge[]): CustomerMoney {
    let checkout = 0
    let refunded = 0
    for (const b of bookings) {
        if (!PAID_CHECKOUT.has(b.status)) continue
        const refund = Number(b.refunded_amount) || 0
        checkout += Number(b.total_price) - refund
        refunded += refund
    }

    const paidIds = new Set(bookings.filter(b => PAID_CHECKOUT.has(b.status)).map(b => b.id))
    const ours = charges.filter(c => paidIds.has(c.booking_id))
    const later = paidAfterCheckout(ours)
    refunded += ours.filter(c => c.status === 'succeeded').reduce((s, c) => s + c.amount_refunded, 0)

    const owed = ours
        .filter(c => c.status === 'requires_payment' && c.kind !== 'deposit')
        .reduce((s, c) => s + c.amount + c.tax_amount, 0)
    const depositsKept = paidAfterCheckout(ours.filter(c => c.kind === 'deposit'))

    return {
        lifetimePaid: round(checkout + later),
        refunded: round(refunded),
        owed: round(owed),
        depositsKept: round(depositsKept),
    }
}

// ── Tags and notes ───────────────────────────────────────────────────────────

export const MAX_TAG_LENGTH = 40
export const MAX_TAGS = 12
export const MAX_NOTE_LENGTH = 4000

/** Tags offered before any are in use. Owners can type any other. */
export const SUGGESTED_TAGS = ['VIP', 'Repeat', 'Caution', 'Late return', 'Damage history']

/** Trimmed, inner whitespace collapsed; null when nothing is left or it's too long. */
export function normalizeTag(tag: string): string | null {
    const t = tag.trim().replace(/\s+/g, ' ')
    if (!t || t.length > MAX_TAG_LENGTH) return null
    return t
}

/** Normalized, deduplicated ignoring case (first spelling wins), capped at MAX_TAGS. */
export function normalizeTags(tags: string[]): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of tags) {
        const t = normalizeTag(raw)
        if (!t || seen.has(t.toLowerCase())) continue
        seen.add(t.toLowerCase())
        out.push(t)
    }
    if (out.length > MAX_TAGS) throw new Error(`A customer can have at most ${MAX_TAGS} tags.`)
    return out
}

/** Whole years old on `now`, from a YYYY-MM-DD date of birth. */
export function ageOn(dob: string, now: Date = new Date()): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob)
    if (!m) return null
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    let age = now.getFullYear() - y
    if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--
    return age
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/**
 * One CSV field. Quoted when it has to be, and a leading = + - @ is defused
 * with an apostrophe so a spreadsheet doesn't run a name as a formula.
 */
export function csvField(value: string | number | boolean | null | undefined): string {
    if (value == null) return ''
    let s = String(value)
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
    return [header, ...rows].map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n'
}
