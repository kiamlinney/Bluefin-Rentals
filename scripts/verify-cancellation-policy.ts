// Verification for src/lib/cancellation-policy.ts — the refund arithmetic.
//
//   npx tsx scripts/verify-cancellation-policy.ts
//   (or: node --experimental-strip-types scripts/verify-cancellation-policy.ts)
//
// There is no test framework in this repo, so this is a plain script: it prints
// a table and exits non-zero on failure. It exists because this module decides
// how much of a customer's money to give back, a mistake is a real financial
// error rather than a rendering glitch, and the rules are subtle enough that
// one already slipped through — see the INVARIANT section at the bottom.
//
// No network, no database, no Stripe. Pure arithmetic.

import {
    refundForCancellation,
    effectiveFreeCancellationDeadline,
    type RefundInput,
} from '../src/lib/cancellation-policy.ts'
import type { TripQuote } from '../src/lib/pricing.ts'
import type { BookingRate } from '../src/lib/booking-rate.ts'

const H = 60 * 60 * 1000
const D = 24 * H

const results: boolean[] = []
const pass = (ok: boolean, name: string, detail = '') => {
    results.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (detail) console.log(`        ${detail}`)
}

/** A quote whose parts add up, so the fee basis is exercised for real. */
function quote(o: {
    rate: BookingRate; days: number; subtotal: number
    discount?: number; surcharge?: number; premium?: number; pickup?: number
}): TripQuote {
    const discount = o.discount ?? 0
    const surcharge = o.surcharge ?? 0
    const premium = o.premium ?? 0
    const pickup = o.pickup ?? 0
    return {
        days: [], billableDays: o.days, subtotal: o.subtotal,
        discountPercent: 0, discountLabel: null, discountAmount: discount,
        extraDiscountPercent: 0, extraDiscountLabel: null, extraDiscountAmount: 0,
        surchargePercent: 0, surchargeLabel: null, surchargeAmount: surcharge,
        bookingRate: o.rate,
        refundableSurchargeAmount: premium, refundableSurchargeLabel: premium ? 'Refundable rate' : null,
        pickupFee: pickup, pickupFeeLabel: pickup ? 'Delivery' : null,
        total: o.subtotal - discount + surcharge + premium + pickup,
    } as TripQuote
}

// ── The reference trip ───────────────────────────────────────────────────────
// 5 days, $250 subtotal, $25 discount, $30 delivery, refundable (+$22.50).
// tripPrice $225 -> $45/day. Total $277.50.
const Q5 = quote({ rate: 'refundable', days: 5, subtotal: 250, discount: 25, premium: 22.5, pickup: 30 })
const START = new Date('2026-10-01T15:00:00Z')
const END = new Date('2026-10-06T15:00:00Z')

function run(name: string, over: Partial<RefundInput>, expect: Record<string, unknown>) {
    const base: RefundInput = {
        rate: 'refundable', bookedAt: new Date('2026-09-01T12:00:00Z'),
        tripStart: START, tripEnd: END, quote: Q5, totalPaid: 277.5,
    }
    const got = refundForCancellation({ ...base, ...over })
    const bad = Object.entries(expect).filter(([k, v]) => (got as any)[k] !== v)
    pass(bad.length === 0, name,
        `kind=${got.kind} refund=${got.refundAmount} fee=${got.cancellationFee} premium=${got.retainedPremium} reason=${got.reason}` +
        (bad.length ? `\n        expected ` + bad.map(([k, v]) => `${k}=${v}`).join(', ') : ''))
}

console.log('\n=== FREE WINDOW ===')
run('refundable, 25h before start -> full', { now: new Date(START.getTime() - 25 * H) },
    { kind: 'full', refundAmount: 277.5, reason: 'within-free-window' })
run('refundable, 23h before start -> partial (1-day fee)', { now: new Date(START.getTime() - 23 * H) },
    { kind: 'partial', refundAmount: 210, cancellationFee: 45, retainedPremium: 22.5 })

const booked = new Date('2026-09-01T12:00:00Z')
run('non-refundable, 23h after booking -> full', { rate: 'non-refundable', now: new Date(booked.getTime() + 23 * H) },
    { kind: 'full', refundAmount: 277.5, reason: 'non-refundable-grace' })
run('non-refundable, 25h after booking -> none', { rate: 'non-refundable', now: new Date(booked.getTime() + 25 * H) },
    { kind: 'none', refundAmount: 0, reason: 'non-refundable' })

console.log('\n=== LATE BOOKING (inside the 24h window) ===')
const late = new Date(START.getTime() - 12 * H)
run('booked 12h ahead, cancelled 30min later -> full', { bookedAt: late, now: new Date(late.getTime() + 30 * 60000) },
    { kind: 'full', reason: 'late-booking-grace' })
run('booked 12h ahead, cancelled 90min later -> partial', { bookedAt: late, now: new Date(late.getTime() + 90 * 60000) },
    { kind: 'partial', refundAmount: 210, cancellationFee: 45 })

console.log('\n=== FEE TIERS ===')
// 2 days, $100 subtotal, no delivery, +$10 premium -> $50/day, half-day fee $25.
const Q2 = quote({ rate: 'refundable', days: 2, subtotal: 100, premium: 10 })
run('2-day trip past window -> HALF-day fee', {
    quote: Q2, totalPaid: 110, tripEnd: new Date(START.getTime() + 2 * D),
    now: new Date(START.getTime() - 2 * H),
}, { kind: 'partial', cancellationFee: 25, refundAmount: 75, retainedPremium: 10 })
run('3-day trip past window -> FULL-day fee', {
    quote: quote({ rate: 'refundable', days: 3, subtotal: 150 }), totalPaid: 150,
    tripEnd: new Date(START.getTime() + 3 * D), now: new Date(START.getTime() - 2 * H),
}, { kind: 'partial', cancellationFee: 50, refundAmount: 100 })

console.log('\n=== DELIVERY FEE IS REFUNDED IN FULL (divergence from Turo) ===')
run('delivery fee returns whole on a partial refund', { now: new Date(START.getTime() - 23 * H) },
    { refundAmount: 210 })
pass(210 === 225 - 45 + 30, 'refund = tripPrice - fee + delivery', '225 - 45 + 30 = 210')

console.log('\n=== TRIP STARTED / ADMIN ===')
run('at trip start -> none', { now: START }, { kind: 'none', reason: 'after-trip-start' })
run('after trip start -> none', { now: new Date(START.getTime() + H) }, { kind: 'none', reason: 'after-trip-start' })
run('admin past window -> full', { now: new Date(START.getTime() - H), byAdmin: true },
    { kind: 'full', refundAmount: 277.5, reason: 'admin-initiated' })
run('admin, non-refundable past grace -> full', { rate: 'non-refundable', byAdmin: true, now: new Date(START.getTime() - H) },
    { kind: 'full', refundAmount: 277.5, reason: 'admin-initiated' })
run('admin, after trip start -> full', { byAdmin: true, now: new Date(START.getTime() + D) },
    { kind: 'full', reason: 'admin-initiated' })

console.log('\n=== LEGACY ROWS (no price_quote) ===')
run('null quote -> estimated partial', { quote: null, now: new Date(START.getTime() - 2 * H) },
    { kind: 'partial', estimated: true, cancellationFee: 55.5, refundAmount: 222 })
run('zero total -> no negative refund', { totalPaid: 0, quote: null, now: new Date(START.getTime() - 2 * H) },
    { refundAmount: 0 })

console.log('\n=== DEADLINE CLAMP ===')
const veryLate = new Date(START.getTime() - 2 * H)
const dl = effectiveFreeCancellationDeadline('non-refundable', { bookedAt: veryLate, tripStart: START })
pass(dl.getTime() <= START.getTime(), 'grace never lands past trip start',
    `deadline=${dl.toISOString()} tripStart=${START.toISOString()}`)

// ── The invariant that caught a real inversion ───────────────────────────────
//
// Non-refundable's grace runs 24h from BOOKING; refundable's deadline runs 24h
// before TRIP START. Before effectiveFreeCancellationDeadline capped the former
// by the latter, they crossed on any booking made under ~48h ahead, and the
// guest who paid REFUNDABLE_SURCHARGE for flexibility got a SMALLER share back
// than one who hadn't. 21 of 67 sampled live scenarios were inverted, including
// every same-day booking.
console.log('\n=== INVARIANT: refundable is never worse than non-refundable ===')
let inversions = 0
let checked = 0
const worst: string[] = []
for (const leadH of [3, 4, 6, 8, 12, 16, 20, 23, 24, 25, 26, 30, 36, 42, 47, 48, 50, 60, 72, 96, 120, 240]) {
    for (const cancelH of [0.1, 0.5, 1, 1.5, 2, 3, 5, 8, 10, 15, 20, 23, 24, 25, 30, 40, 47, 60, 100]) {
        const bookedAt = new Date('2026-09-10T12:00:00Z')
        const tripStart = new Date(bookedAt.getTime() + leadH * H)
        const tripEnd = new Date(tripStart.getTime() + 8 * H)
        const now = new Date(bookedAt.getTime() + cancelH * H)
        if (now >= tripStart) continue

        const nr = refundForCancellation({
            rate: 'non-refundable', bookedAt, tripStart, tripEnd,
            quote: quote({ rate: 'non-refundable', days: 1, subtotal: 120 }), totalPaid: 120, now,
        })
        const r = refundForCancellation({
            rate: 'refundable', bookedAt, tripStart, tripEnd,
            quote: quote({ rate: 'refundable', days: 1, subtotal: 120, premium: 12 }), totalPaid: 132, now,
        })
        checked++
        // Compare as a share of what each guest actually paid.
        if (r.refundAmount / 132 < nr.refundAmount / 120 - 1e-9) {
            inversions++
            if (worst.length < 3) {
                worst.push(`booked ${leadH}h ahead, cancelled ${cancelH}h later: ` +
                    `non-refundable $${nr.refundAmount.toFixed(2)} (${(nr.refundAmount / 120 * 100).toFixed(0)}%) vs ` +
                    `refundable $${r.refundAmount.toFixed(2)} (${(r.refundAmount / 132 * 100).toFixed(0)}%)`)
            }
        }
    }
}
pass(inversions === 0, `no inversion across ${checked} lead-time x cancel-time combinations`,
    inversions ? worst.join('\n        ') : `${checked} combinations checked`)

const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed\n`)
process.exit(failed === 0 ? 0 : 1)