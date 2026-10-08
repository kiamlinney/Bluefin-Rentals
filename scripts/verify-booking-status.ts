// Verification for src/lib/booking-status.ts — what a payment or a hold landing
// means for each booking status.
//
//   node --experimental-strip-types scripts/verify-booking-status.ts
//
// A plain script like its siblings: prints a table, exits non-zero on failure.
// Every status a booking can hold is checked, because both bugs found on
// 2026-10-06 were a status nobody had thought about: a cancelled trip that could
// be confirmed again, and one that could be cancelled again.
//
// No network, no database, no Stripe.

import {
    CONFIRMABLE_BY_PAYMENT,
    checkoutPaymentEffect,
    depositHoldBelongs,
    type CheckoutPaymentEffect,
} from '../src/lib/booking-status.ts'
import { Constants } from '../src/lib/database.types.ts'

/**
 * Every value of the booking_status enum, read from the generated types. When
 * the enum gains a status, the expectation tables below lack it and the run
 * fails until someone decides what it should do.
 */
const STATUSES = Constants.public.Enums.booking_status
type Status = (typeof STATUSES)[number]

const results: boolean[] = []
const pass = (ok: boolean, name: string, detail = '') => {
    results.push(ok)
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (detail) console.log(`        ${detail}`)
}

console.log('\nA checkout payment succeeding (checkoutPaymentEffect)')
{
    const expected: Record<Status, CheckoutPaymentEffect> = {
        pending: 'confirm',
        expired: 'confirm',   // a late card payment on an abandoned checkout
        failed: 'confirm',    // a retry after a decline
        confirmed: 'already-confirmed',
        canceled: 'leave',    // refunded: never revived
        completed: 'leave',
    }
    for (const status of STATUSES) {
        const got = checkoutPaymentEffect(status)
        pass(got === expected[status], `${status} -> ${expected[status]}`, got === expected[status] ? '' : `got ${got}`)
    }
    pass(!(CONFIRMABLE_BY_PAYMENT as readonly string[]).includes('canceled'),
        'confirmBooking can never flip a cancelled trip back (canceled not confirmable)')
    pass(checkoutPaymentEffect('something-new') === 'leave', 'an unknown status is left alone')
}

console.log('\nA deposit hold landing (depositHoldBelongs)')
{
    const expected: Record<Status, boolean> = {
        confirmed: true,
        completed: true,      // held through the inspection window
        pending: false,
        canceled: false,      // cancelled while the hold was being placed
        expired: false,
        failed: false,
    }
    for (const status of STATUSES) {
        const got = depositHoldBelongs(status)
        pass(got === expected[status], `${status} -> ${expected[status] ? 'keep' : 'release'}`)
    }
}

const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed\n`)
process.exit(failed === 0 ? 0 : 1)
