// Verification for src/lib/extension.ts — what extending a trip costs, and when
// it needs an owner.
//
//   node --experimental-strip-types scripts/verify-extension-pricing.ts
//
// Plain script, no framework: prints each check and exits non-zero on failure.
// The rules it checks are written out in ImportantFiles/extensions.md.

import {
    calculateExtensionPrice,
    extensionMode,
    EXTENSION_REQUEST_CUTOFF_MINUTES,
} from '../src/lib/extension.ts'

const results: boolean[] = []
const pass = (ok: boolean, name: string, detail = '') => {
    results.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok && detail) console.log(`        ${detail}`)
}
const eq = (a: number, b: number) => Math.abs(a - b) < 0.005

const base = {
    startDate: '2026-10-01',
    startTime: '10:00',
    basePricePerDay: 100,
}

console.log('Price')
{
    // 5 days -> 8 days: three added days, at the weekly tier the trip now reaches.
    const q = calculateExtensionPrice({
        ...base,
        currentEndDate: '2026-10-06', currentEndTime: '10:00',
        newEndDate: '2026-10-09', newEndTime: '10:00',
    })
    pass(q.fromBillableDays === 5 && q.toBillableDays === 8, '5 -> 8 billable days', JSON.stringify(q))
    pass(q.days.map(d => d.date).join() === '2026-10-06,2026-10-07,2026-10-08', 'the added days are the dates after the paid ones')
    pass(eq(q.subtotal, 300) && eq(q.discountAmount, 30) && eq(q.total, 270),
        'added days discounted at the NEW length\'s tier (weekly 10%): 300 - 30 = 270', `total ${q.total}`)
}
{
    const q = calculateExtensionPrice({
        ...base, bookingRate: 'refundable',
        currentEndDate: '2026-10-06', currentEndTime: '10:00',
        newEndDate: '2026-10-09', newEndTime: '10:00',
    })
    pass(eq(q.refundableSurchargeAmount, 27) && eq(q.total, 297), 'a refundable trip\'s extension carries the 10% premium', `total ${q.total}`)
}
{
    // 2 days 2 hours already bills 3 days. Returning at 8pm instead of noon
    // is still inside day 3.
    const q = calculateExtensionPrice({
        ...base,
        currentEndDate: '2026-10-03', currentEndTime: '12:00',
        newEndDate: '2026-10-03', newEndTime: '20:00',
    })
    pass(q.days.length === 0 && q.total === 0, 'time inside an already-billed day costs nothing')
}
{
    const q = calculateExtensionPrice({
        ...base,
        overrides: { '2026-10-04': 150 },
        currentEndDate: '2026-10-03', currentEndTime: '10:00',
        newEndDate: '2026-10-05', newEndTime: '10:00',
    })
    pass(eq(q.subtotal, 250) && q.days.some(d => d.date === '2026-10-04' && d.isOverride),
        'per-date price overrides apply to the added days', `subtotal ${q.subtotal}`)
}
{
    const q = calculateExtensionPrice({
        ...base,
        tripExtraIds: ['unlimited-mileage', 'child-seat', 'prepaid-refuel'],
        currentEndDate: '2026-10-03', currentEndTime: '10:00',
        newEndDate: '2026-10-05', newEndTime: '10:00',
    })
    const ids = q.extras.map(e => e.id).join()
    pass(ids === 'unlimited-mileage' && eq(q.extrasTotal, 160),
        'per-day extras extend with the trip (2 days x $80); per-trip ones are not charged again', `${ids} ${q.extrasTotal}`)
    // The trip is now 4 days, so the 3-day tier's 5% comes off the two added
    // days ($200 -> $190) — but not off the extras.
    pass(eq(q.discountAmount, 10) && eq(q.total, 190 + 160), 'the tier discount skips the extras: 190 + 160', `total ${q.total}`)
}
{
    // 25 -> 32 days crosses the 3-week tier (20%) and the 30-day long-trip
    // discount (5% on top), applied to the 7 added days only.
    const q = calculateExtensionPrice({
        ...base,
        currentEndDate: '2026-10-26', currentEndTime: '10:00',
        newEndDate: '2026-11-02', newEndTime: '10:00',
    })
    pass(q.days.length === 7 && eq(q.discountAmount, 140) && eq(q.extraDiscountAmount, 28) && eq(q.total, 532),
        '700 - 20% (140) - 5% of the rest (28) = 532', JSON.stringify({ d: q.discountAmount, x: q.extraDiscountAmount, t: q.total }))
}

console.log('\nWhen it needs an owner')
{
    const end = new Date('2026-10-06T15:00:00Z')
    const minutes = (m: number) => new Date(end.getTime() - m * 60_000)
    pass(extensionMode(end, minutes(120)) === 'instant', '2 hours before the end: automatic')
    pass(extensionMode(end, minutes(EXTENSION_REQUEST_CUTOFF_MINUTES)) === 'request', `exactly ${EXTENSION_REQUEST_CUTOFF_MINUTES} minutes before: a request`)
    pass(extensionMode(end, minutes(10)) === 'request', '10 minutes before: a request')
    pass(extensionMode(end, minutes(0)) === 'closed', 'at the end: closed (a late return, not an extension)')
    pass(extensionMode(end, minutes(-30)) === 'closed', 'after the end: closed')
}

const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed\n`)
process.exit(failed === 0 ? 0 : 1)