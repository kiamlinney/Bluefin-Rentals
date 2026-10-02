// Verification for src/lib/tax.ts and how tax threads through pricing,
// receipts and refunds.
//
//   node --experimental-strip-types scripts/verify-tax.ts
//
// Plain script: prints each check, exits non-zero on failure. What it checks is
// arithmetic against the constants — it can't tell you whether a rate or a
// taxability rule is legally right. That is ImportantFiles/tax-todo.md.

import {
    calculateTax,
    displayTaxLines,
    isShortTermRental,
    RENTAL_FEE_APPLIES,
    SHORT_TERM_MAX_DAYS,
    taxJurisdictionForPickup,
} from '../src/lib/tax.ts'
import { calculateTripPrice } from '../src/lib/pricing.ts'
import { storedQuote } from '../src/lib/receipt.ts'
import { refundForCancellation } from '../src/lib/cancellation-policy.ts'

const results: boolean[] = []
const pass = (ok: boolean, name: string, detail = '') => {
    results.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok && detail) console.log(`        ${detail}`)
}
const eq = (a: number, b: number) => Math.abs(a - b) < 0.005

console.log('Rates')
{
    const short = { shortTermRental: true } as const
    const sp = calculateTax([{ taxKey: 'trip', amount: 100 }], { jurisdiction: 'saint-paul', ...short })
    // 6.875 state + 1.00 metro + 1.50 city + 0.50 transit + 9.2 rental, each rounded
    pass(eq(sp.total, 6.88 + 1 + 1.5 + 0.5 + 9.2), 'Saint Paul, $100 short-term rental: 19.08', `${sp.total}`)
    pass(sp.lines.length === 5 && sp.lines.every(l => l.taxableAmount === 100), 'one line per tax, each on the whole base')

    const mpls = calculateTax([{ taxKey: 'trip', amount: 100 }], { jurisdiction: 'minneapolis', ...short })
    pass(eq(mpls.total, 6.88 + 0.15 + 1 + 0.5 + 0.5 + 9.2), 'Minneapolis: 18.23', `${mpls.total}`)

    const msp = calculateTax([{ taxKey: 'trip', amount: 100 }], { jurisdiction: 'hennepin-msp', ...short })
    pass(eq(msp.total, 6.88 + 0.15 + 1 + 0.5 + 9.2), 'MSP airport: 17.73', `${msp.total}`)

    pass(!RENTAL_FEE_APPLIES && !sp.lines.some(l => l.id === 'mn-rental-fee'), 'the 5% rental fee is not charged (exempt, per RENTAL_FEE_APPLIES)')
}

console.log('\nWhat is taxed')
{
    const ctx = { jurisdiction: 'saint-paul' as const, shortTermRental: true }
    pass(calculateTax([{ taxKey: 'damage', amount: 500 }], ctx).total === 0, 'damage reimbursement: not taxed')
    pass(calculateTax([{ taxKey: 'tolls', amount: 12 }], ctx).total === 0, 'tolls: not taxed')
    pass(calculateTax([{ taxKey: 'mileage', amount: 50 }], ctx).total > 0, 'mileage overage: taxed')
    const mixed = calculateTax([{ taxKey: 'trip', amount: 100 }, { taxKey: 'tolls', amount: 50 }], ctx)
    pass(mixed.lines[0]?.taxableAmount === 100, 'untaxed lines are left out of the base')
    pass(calculateTax([{ taxKey: 'unknown-thing', amount: 10 }], ctx).total > 0, 'an unknown kind is taxed (as "other")')
}

console.log('\nShort-term rentals')
{
    pass(isShortTermRental(SHORT_TERM_MAX_DAYS) && !isShortTermRental(SHORT_TERM_MAX_DAYS + 1), `${SHORT_TERM_MAX_DAYS} days is short-term, ${SHORT_TERM_MAX_DAYS + 1} is not`)
    const long = calculateTax([{ taxKey: 'trip', amount: 100 }], { jurisdiction: 'saint-paul', shortTermRental: false })
    pass(!long.lines.some(l => l.id === 'mn-rental-tax') && long.lines.every(l => l.placeholder), 'a long rental: sales tax only, flagged as unconfirmed')
}

console.log('\nWhere the car is picked up')
{
    pass(taxJurisdictionForPickup({ kind: 'home' }) === 'saint-paul', 'home base -> Saint Paul')
    pass(taxJurisdictionForPickup({ kind: 'listed', id: 'grand-hotel' }) === 'minneapolis', 'Grand Hotel -> Minneapolis')
    pass(taxJurisdictionForPickup({ kind: 'listed', id: 'msp' }) === 'hennepin-msp', 'MSP -> Hennepin (airport)')
    pass(taxJurisdictionForPickup({ kind: 'delivery' }) === 'saint-paul', 'delivery -> home base rates (placeholder)')
}

console.log('\nIn a quote')
{
    const q = calculateTripPrice({
        startDate: '2026-11-02', startTime: '10:00', endDate: '2026-11-04', endTime: '10:00',
        basePricePerDay: 100, today: '2026-10-01', taxJurisdiction: 'saint-paul',
    })
    pass(eq(q.preTaxTotal, 200) && eq(q.taxTotal, 38.15) && eq(q.total, 238.15),
        'a $200 trip in Saint Paul: 200 + 38.15 tax = 238.15', JSON.stringify({ pre: q.preTaxTotal, tax: q.taxTotal, total: q.total }))
    pass(eq(q.taxLines.reduce((s, l) => s + l.amount, 0), q.taxTotal), 'the tax lines add up to the tax total')
}

console.log('\nBookings from before tax')
{
    const legacy = storedQuote({ price_quote: {
        version: 1, billableDays: 2, days: [], subtotal: 200, discountPercent: 0, discountLabel: null, discountAmount: 0,
        extraDiscountPercent: 0, extraDiscountLabel: null, extraDiscountAmount: 0, surchargePercent: 0, surchargeLabel: null,
        surchargeAmount: 0, bookingRate: 'non-refundable', refundableSurchargeAmount: 0, refundableSurchargeLabel: null,
        pickupFee: 0, pickupFeeLabel: null, extras: [], extrasTotal: 0, total: 200,
    } } as any)!
    pass(legacy.taxTotal === 0 && legacy.taxLines.length === 0 && legacy.preTaxTotal === 200,
        'a version 1 quote reads as untaxed, its total unchanged')
}

console.log('\nRefunds')
{
    const q = calculateTripPrice({
        startDate: '2026-11-02', startTime: '10:00', endDate: '2026-11-06', endTime: '10:00',
        basePricePerDay: 100, today: '2026-10-01', bookingRate: 'refundable', taxJurisdiction: 'saint-paul',
    })
    // Late refundable cancellation: one day's fee kept, premium kept.
    const outcome = refundForCancellation({
        rate: 'refundable',
        bookedAt: new Date('2026-10-01T15:00:00Z'),
        tripStart: new Date('2026-11-02T15:00:00Z'),
        tripEnd: new Date('2026-11-06T15:00:00Z'),
        quote: q,
        totalPaid: q.total,
        now: new Date('2026-11-02T03:00:00Z'),
    })
    const preTaxRefund = q.preTaxTotal - q.refundableSurchargeAmount - outcome.cancellationFee
    const expected = Math.round((preTaxRefund + q.taxTotal * preTaxRefund / q.preTaxTotal) * 100) / 100
    pass(outcome.kind === 'partial' && eq(outcome.refundAmount, expected),
        'a partial refund returns the tax on the refunded share', `${outcome.refundAmount} vs ${expected}`)
}

console.log('\nHow tax is shown')
{
    // The trip that raised it: $176.73 picked up at the home base.
    const tax = calculateTax([{ taxKey: 'trip', amount: 176.73 }], { jurisdiction: 'saint-paul', shortTermRental: true })
    const shown = displayTaxLines(tax.lines)
    pass(shown.length === 2, 'Saint Paul shows two lines, not five', shown.map(l => l.label).join(' | '))
    pass(shown[0]?.label === 'Sales tax (9.875%)' && eq(shown[0].amount, 17.45),
        'the four sales tax slices show as one: Sales tax (9.875%) $17.45', `${shown[0]?.label} ${shown[0]?.amount}`)
    pass(shown[1]?.label === 'Minnesota rental vehicle tax (9.2%)' && eq(shown[1].amount, 16.26),
        'the rental tax stays its own line: $16.26', `${shown[1]?.label} ${shown[1]?.amount}`)
    pass(eq(shown.reduce((s, l) => s + l.amount, 0), tax.total), 'grouping never changes the total charged')

    const mpls = displayTaxLines(calculateTax([{ taxKey: 'trip', amount: 100 }], { jurisdiction: 'minneapolis', shortTermRental: true }).lines)
    pass(mpls[0]?.label === 'Sales tax (9.025%)', 'Minneapolis sales tax shows as 9.025%', `${mpls[0]?.label}`)
}

const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed\n`)
process.exit(failed === 0 ? 0 : 1)
