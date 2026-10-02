# Security deposit

*Last checked against the code: 2026-09-29.* Constants: `src/lib/deposit.ts#DEPOSIT_AMOUNT`
and the lines below it. Engine: `src/lib/payments.server.ts#ensureDepositHold`.

## The rules

| Rule | Value | Status |
|---|---|---|
| Amount, every car | <!-- const:DEPOSIT_AMOUNT -->$1,500<!-- /const --> | Decided 2026-09-25, **expected to change** |
| Placed before pickup | <!-- const:DEPOSIT_PLACE_BEFORE_HOURS -->24<!-- /const --> hours | Decided |
| Released after return | <!-- const:DEPOSIT_RELEASE_AFTER_HOURS -->72<!-- /const --> hours | Decided |
| Renewed when this close to Stripe's deadline | <!-- const:DEPOSIT_RENEW_BEFORE_HOURS -->24<!-- /const --> hours | Implementation choice |
| Wait between retries after a decline | <!-- const:DEPOSIT_RETRY_AFTER_HOURS -->6<!-- /const --> hours | Implementation choice |

**To change the amount:** edit `DEPOSIT_AMOUNT` in `src/lib/deposit.ts`, then run
`node --experimental-strip-types scripts/verify-policy-docs.ts` and update the figures in
these documents. The checkout consent line, the terms, the FAQ and the trip pages all
read the constant, so they change together. Holds already placed keep their amount.

## What a hold is, for the guest

A hold (a card "authorization") reserves the amount on the card without taking it. On a
credit card it lowers the available credit; **on a debit card it sets aside real money**
from the balance. After the trip the hold is released, or some or all of it is kept
("captured"). Nothing is charged unless captured.

## When the hold is placed

- About <!-- const:DEPOSIT_PLACE_BEFORE_HOURS -->24<!-- /const --> hours before pickup,
  by the payments sweep. A trip booked closer to pickup than that gets its hold the
  moment its payment confirms.
  → `src/lib/payments.server.ts#onBookingConfirmed`, `src/lib/payments.server.ts#runPaymentsSweep`
- **Why not at checkout:** an ordinary card hold lasts only about 7 days, so a hold
  placed when a trip is booked a month out would lapse weeks before pickup.
- The hold is placed **off-session** (the guest isn't there) on the booking's saved card.
  It asks Stripe for an **extended authorization** only once that's switched on
  (`src/lib/deposit.ts#EXTENDED_AUTHORIZATION_ENABLED` =
  <!-- const:EXTENDED_AUTHORIZATION_ENABLED -->false<!-- /const -->). Asking while Stripe
  hasn't enabled it doesn't fall back to a normal hold: Stripe refuses the whole request.
  That made every hold fail in the sandbox rehearsal on 2026-09-29.
- **If Stripe refuses the request itself** (a setup problem, not the guest's card), the
  guest is **not** told their card was declined; you get an alert instead.
  → `src/lib/payments.server.ts#chargeSavedCard`
- **The lockbox code is withheld until a hold is in place** (or you waive it). A guest
  never sees the code on the trip page, in an email, or through a direct server call
  without one. You always see it.
  → `src/lib/lockbox.server.ts#guestLockboxCode`
- The code is emailed in the **"Your security hold is placed"** email. The booking
  confirmation email only carries it when the hold is already in place, i.e. for trips
  booked within a day of pickup.

## Long trips

Stripe cancels a hold on its own after a network-set time:

| | Standard | Extended authorization (vehicle rental) |
|---|---|---|
| How long | ~7 days | up to 30 days (Visa 29d 18h) on Visa, Mastercard, Amex, Discover |
| Available to | everyone | **IC+ pricing only**, or ask Stripe support to enable it |

Source: [Stripe: extended authorizations](https://docs.stripe.com/payments/extended-authorization)

When a hold would expire before the trip ends plus the
<!-- const:DEPOSIT_RELEASE_AFTER_HOURS -->72<!-- /const -->-hour inspection window, the
sweep places **a fresh hold first, then releases the old one**, about
<!-- const:DEPOSIT_RENEW_BEFORE_HOURS -->24<!-- /const --> hours before Stripe's deadline.
The guest may briefly see two pending holds; the guest is emailed about the renewal.
→ `src/lib/payments.server.ts#runPaymentsSweep`
**Why new-then-old:** releasing first risks ending up with no hold if the new one declines.
**Action for you:** ask Stripe to enable extended authorization, and once they confirm,
set `EXTENDED_AUTHORIZATION_ENABLED = true` in `src/lib/deposit.ts`. Until then every hold
is a standard ~7-day one, so a 45-day trip needs ~7 renewals instead of 1, and each is a
chance to decline.
Card holds saved through Link don't get extended authorization; they renew more often.

## When the hold declines

1. The guest and you are emailed on the **first** decline in a run (not every retry).
2. The sweep retries every <!-- const:DEPOSIT_RETRY_AFTER_HOURS -->6<!-- /const --> hours.
   **Why not faster:** rapid repeated attempts look like card testing to banks and can
   get the card blocked.
3. The guest can **update their card** on the trip page. The new card is saved and the
   hold is tried immediately while they're there, so their bank can ask them to confirm.
   → `src/lib/payments.server.ts#finishCardUpdate`, `src/components/trip/CardUpdateDialog.tsx#CardUpdateDialog`
4. The lockbox code stays withheld until a hold goes through.
5. **You can:** "Try the hold now" (skips the wait), or **Waive deposit** (the code is
   released, the sweep stops trying). Both on the reservation page.
   → `src/lib/payments.ts#placeTripDeposit`, `src/lib/payments.ts#setDepositWaived`

## After the trip

- **Automatic release** <!-- const:DEPOSIT_RELEASE_AFTER_HOURS -->72<!-- /const --> hours
  after the trip ends, unless you captured some of it or pressed **Keep holding**. The
  guest is emailed.
  → `src/lib/payments.server.ts#releaseDepositHold`
- **Capture for damage** (reservation page): enter an amount up to the hold and what it's
  for; the guest is told the reason. Whatever isn't captured is released in the same
  step. **A hold can only be captured once.**
  → `src/lib/payments.server.ts#captureDeposit`
- **Damage costing more than the hold:** capture all of it, then charge the difference
  under Additional charges ([charges-and-invoicing.md](charges-and-invoicing.md)).
- Tax on a captured deposit: none (damage is treated as not taxable, a placeholder;
  see [tax.md](tax.md)).

## Cancellation

Cancelling a trip releases any hold. → `src/lib/payments.server.ts#settleLedgerOnCancellation`

## Customers are told

`/policies/terms` section 3; checkout consent line; FAQ "Is a security deposit
required?" and "When am I charged?"; trip page "Security deposit" section; the emails
listed in [payments-overview.md](payments-overview.md).

## Open questions for you

- Whether to refuse prepaid cards for the deposit (they often can't hold $1,500). Not
  implemented; say if you want it.
- The amount itself, once you've settled on it.
