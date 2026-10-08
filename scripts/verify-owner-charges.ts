// Verification for ownerChargeBlockedReason in src/lib/charges.ts: when an
// owner may bill a trip's saved card after checkout.
//
//   node --experimental-strip-types scripts/verify-owner-charges.ts
//
// The status half of the rule is ownerChargeAllowed (booking-status.ts), which
// verify-booking-status.ts covers; this checks that the pickup rule sits on top
// of it. Plain script: prints each check, exits non-zero on failure.

import { ownerChargeBlockedReason } from '../src/lib/charges.ts'

const results: boolean[] = []
const pass = (ok: boolean, name: string, detail = '') => {
    results.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok && detail) console.log(`        ${detail}`)
}

const now = new Date('2026-11-01T12:00:00Z')
const future = '2026-11-03T17:00:00Z'
const past = '2026-10-30T17:00:00Z'
const trip = (status: string, start_time: string, canceled_at: string | null = null) =>
    ownerChargeBlockedReason({ status, start_time, canceled_at }, now)

console.log('Before pickup')
{
    const reason = trip('confirmed', future)
    pass(reason !== null && reason.startsWith('Charges open at pickup'), 'a confirmed trip that hasn\'t started is refused', `${reason}`)
    pass(trip('confirmed', now.toISOString()) === null, 'charges open at the exact start time')
}

console.log('\nOnce the trip has started')
{
    pass(trip('confirmed', past) === null, 'a confirmed trip under way can be charged')
    pass(trip('completed', past) === null, 'a completed trip can be charged')
    pass(trip('canceled', past, '2026-10-31T12:00:00Z') === null, 'a trip cancelled after it started can be charged (the guest had the car)')
}

console.log('\nNever')
{
    for (const status of ['pending', 'expired', 'failed']) {
        pass(trip(status, past) !== null, `${status}: refused even after the start time`)
    }
    const early = trip('canceled', past, '2026-10-29T12:00:00Z')
    pass(early !== null && early.includes('before it started'), 'a trip cancelled before it started is refused', `${early}`)
    pass(trip('canceled', future, '2026-10-31T12:00:00Z') !== null, 'a future trip cancelled now is refused')
}

const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed\n`)
process.exit(failed === 0 ? 0 : 1)
