// The security deposit: a hold on the guest's saved card, placed before pickup
// and released after the car comes back.
//
// Pure and isomorphic like pricing.ts: the checkout consent line, the terms
// page, the FAQ, the trip page and the admin reservation page all state these
// numbers, and every one of them imports them from here. The hold itself is
// placed by src/lib/payments.server.ts.
//
// The full policy, written for review: ImportantFiles/deposit.md.

// ═══════════════════════════════════════════════════════════════════════════
// ▶▶ DEPOSIT AMOUNT — EXPECTED TO CHANGE ◀◀
//
// Set by the owners on 2026-09-25 as a starting figure, "most likely going to
// change". This is the one place it lives. Changing it changes the checkout
// consent line, the terms, the FAQ and every hold placed from then on — holds
// already placed keep the amount they were placed for.
//
// After editing it, run `node --experimental-strip-types
// scripts/verify-policy-docs.ts` and update ImportantFiles/deposit.md.
// ═══════════════════════════════════════════════════════════════════════════
export const DEPOSIT_AMOUNT = 1500

// How far ahead of pickup the hold is placed. A trip booked closer to pickup
// than this gets its hold as soon as its payment confirms.
//
// Why not at checkout: an ordinary card hold lasts 7 days, so a hold placed
// when a trip is booked a month out would lapse weeks before the car moved.
export const DEPOSIT_PLACE_BEFORE_HOURS = 24

// How long after the trip ends the hold stays on, so the car can be inspected
// before the money is let go. An owner can capture part of it, or press
// "keep holding", inside this window.
export const DEPOSIT_RELEASE_AFTER_HOURS = 72

// A hold within this long of Stripe's own capture deadline is renewed if it's
// still needed. The payments sweep runs every 15 minutes, so a day's margin
// leaves room for several failed attempts before the deadline arrives.
export const DEPOSIT_RENEW_BEFORE_HOURS = 24

// Whether to ask Stripe for an extended authorization (a hold lasting up to 30
// days on vehicle rentals instead of ~7). OFF until Stripe enables the feature
// on the account: it needs IC+ pricing, or a request to Stripe support. Asking
// for it while it's off doesn't fall back to a normal hold — Stripe refuses the
// whole request ("This account is not eligible for the requested card
// features"), which is what every deposit hold did on 2026-09-29 until this
// switch existed. Turn it on once Stripe confirms, and long trips renew their
// hold once a month instead of weekly. See ImportantFiles/deposit.md.
export const EXTENDED_AUTHORIZATION_ENABLED = false

// Gap between retries after a hold is declined. Retrying every 15 minutes
// would look like card testing to the guest's bank and could get the card
// blocked outright.
export const DEPOSIT_RETRY_AFTER_HOURS = 6

const MS_PER_HOUR = 60 * 60 * 1000

/** When a trip's hold should be placed. */
export function depositPlaceAt(tripStart: Date): Date {
    return new Date(tripStart.getTime() - DEPOSIT_PLACE_BEFORE_HOURS * MS_PER_HOUR)
}

/** When a trip's hold is released if nobody acts on it. */
export function depositReleaseAt(tripEnd: Date): Date {
    return new Date(tripEnd.getTime() + DEPOSIT_RELEASE_AFTER_HOURS * MS_PER_HOUR)
}

/**
 * Whether a trip is inside the window where it's owed a hold — and so where the
 * lockbox code is withheld until it has one.
 *
 * From DEPOSIT_PLACE_BEFORE_HOURS before pickup until the automatic release.
 */
export function depositIsDue(tripStart: Date, tripEnd: Date, now: Date = new Date()): boolean {
    return now >= depositPlaceAt(tripStart) && now < depositReleaseAt(tripEnd)
}

export type DepositState =
    /** Not yet inside the placement window. */
    | 'not-yet'
    /** An authorized hold is on the card. */
    | 'held'
    /** Owed a hold, and none has succeeded. The lockbox code is withheld. */
    | 'missing'
    /** An owner waived it for this trip. */
    | 'waived'
    /** Released, captured, or past the window. */
    | 'done'

/** "$1,500" — the one way the amount is written in copy. */
export function formatDepositAmount(amount: number = DEPOSIT_AMOUNT): string {
    return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}