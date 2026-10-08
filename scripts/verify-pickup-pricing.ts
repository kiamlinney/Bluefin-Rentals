// Verification for src/lib/pickup.ts and how a pickup fee threads through
// quotes, tax and cancellation refunds.
//
//   node --experimental-strip-types scripts/verify-pickup-pricing.ts
//
// Plain script: prints each check, exits non-zero on failure.

import {
    DELIVERY_FEE,
    HOME_BASE,
    LISTED_PICKUP_FEE,
    PICKUP_LOCATIONS,
    resolvePickup,
} from '../src/lib/pickup.ts'
import { calculateTripPrice } from '../src/lib/pricing.ts'
import { refundForCancellation } from '../src/lib/cancellation-policy.ts'

const results: boolean[] = []
const pass = (ok: boolean, name: string, detail = '') => {
    results.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok && detail) console.log(`        ${detail}`)
}
const eq = (a: number, b: number) => Math.abs(a - b) < 0.005

console.log('Fees')
{
    const home = resolvePickup({ kind: 'home' })
    pass(home.fee === 0 && home.feeLabel === null && home.error === null, 'home base is free, with no fee line')

    for (const id of ['msp', 'grand-hotel', 'msp-light-rail']) {
        const r = resolvePickup({ kind: 'listed', id })
        pass(r.fee === LISTED_PICKUP_FEE && !!r.feeLabel && r.error === null,
            `${id}: $${LISTED_PICKUP_FEE}, labelled "${r.feeLabel}"`, JSON.stringify(r))
    }
    pass(PICKUP_LOCATIONS.every(l => l.fee > 0), 'every listed location charges a fee')

    const labels = PICKUP_LOCATIONS.map(l => l.feeLabel)
    pass(new Set(labels).size === labels.length, 'each listed location has its own fee label', labels.join(' | '))

    const unknown = resolvePickup({ kind: 'listed', id: 'nowhere' })
    pass(unknown.fee === 0 && unknown.error !== null, 'an unknown location charges nothing and blocks the booking')

    const near = resolvePickup({ kind: 'delivery', address: 'near', lat: HOME_BASE.lat + 0.01, lng: HOME_BASE.lng })
    pass(near.fee === DELIVERY_FEE && near.feeLabel === 'Delivery', `delivery in range: $${DELIVERY_FEE}`)
    const far = resolvePickup({ kind: 'delivery', address: 'far', lat: HOME_BASE.lat + 1, lng: HOME_BASE.lng })
    pass(far.fee === 0 && far.error !== null, 'delivery out of range: no fee, blocked')
}

// A four-day $100/day trip from the airport, compared against the same trip
// with no pickup fee, so length discounts don't need restating here.
const airport = resolvePickup({ kind: 'listed', id: 'msp' })
const quoteFor = (bookingRate: 'refundable' | 'non-refundable', withPickup = true) => calculateTripPrice({
    startDate: '2026-11-02', startTime: '10:00', endDate: '2026-11-06', endTime: '10:00',
    basePricePerDay: 100, today: '2026-10-01', bookingRate,
    ...(withPickup ? { pickupFee: airport.fee, pickupFeeLabel: airport.feeLabel } : {}),
    taxJurisdiction: airport.taxJurisdiction,
})

console.log('\nIn a quote')
{
    const q = quoteFor('non-refundable')
    const plain = quoteFor('non-refundable', false)
    pass(q.pickupFee === LISTED_PICKUP_FEE && q.pickupFeeLabel === 'Airport pickup', 'the fee and its label reach the quote')
    pass(eq(q.preTaxTotal, plain.preTaxTotal + LISTED_PICKUP_FEE), `pre-tax total is the trip plus $${LISTED_PICKUP_FEE}`,
        `${q.preTaxTotal} vs ${plain.preTaxTotal}`)
    pass(q.taxLines.every(l => eq(l.taxableAmount, q.preTaxTotal)), 'the pickup fee is in the taxable base',
        q.taxLines.map(l => l.taxableAmount).join(', '))

    // The refundable premium is a percentage of the trip, not of the pickup fee.
    pass(eq(quoteFor('refundable').refundableSurchargeAmount, quoteFor('refundable', false).refundableSurchargeAmount),
        'the refundable premium ignores the pickup fee')
}

console.log('\nCancellation')
{
    const q = quoteFor('refundable')
    // Refundable, after the free window, before pickup: partial.
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
        'a partial refund returns the airport fee in full', `${outcome.refundAmount} vs ${expected}`)
    const plain = quoteFor('refundable', false)
    const tripPrice = plain.preTaxTotal - plain.refundableSurchargeAmount
    pass(eq(outcome.cancellationFee, tripPrice / plain.billableDays),
        'the cancellation fee is one day of the trip, not touching the pickup fee', `${outcome.cancellationFee}`)
}

const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed\n`)
process.exit(failed === 0 ? 0 : 1)
