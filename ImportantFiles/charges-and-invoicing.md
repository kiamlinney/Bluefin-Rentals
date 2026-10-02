# Charges after checkout & invoicing

*Last checked against the code: 2026-09-29.* Vocabulary: `src/lib/charges.ts#CHARGE_CATEGORIES`.
Engine: `src/lib/payments.server.ts#createAdjustmentCharge`.

Decided 2026-09-25: **charge the saved card directly; if it can't be charged, email the
guest a link to pay.** Our own ledger, not Stripe Invoicing (which adds ~0.4% per paid
invoice and would split receipts between Stripe and the site).

## What an owner can charge for

**Proposed (2026-09-25), awaiting your review:** damage, mileage overage, fuel, tolls,
cleaning, late return, other. **There are no preset fees.** You enter every amount for
the specific trip. The one pre-filled figure is **mileage overage**, calculated from
`bookings.miles_driven` at the per-mile rate the guest was shown when booking; you still
confirm it. **Nothing on the site records miles driven yet**: it's entered by hand in
Supabase until an odometer form exists, so without it there's no pre-fill.
→ `src/lib/distance.ts#calculateOverage`

Each charge's tax is shown before you confirm, computed the same way the server charges
it ([tax.md](tax.md)).

## How to charge a guest

Reservation page → **Additional charges** → **Charge guest**: choose what it's for, write
the description (**the guest sees it on their receipt**), enter the amount, review, charge.
- The saved card is charged immediately, without the guest present.
- They get an **emailed receipt**, and the charge is added below the checkout receipt on
  their receipt page.
→ `src/lib/payments.ts#createTripCharge`, `src/components/trip/TripChargesSection.tsx#TripChargesSection`

## When the card can't be charged: the pay link

If the bank declines, or wants the guest to confirm (3D Secure), the charge stays
**Awaiting payment**, and:
- the guest is emailed a link to `/trips/{trip}/pay/{charge}`, where they pay with the
  same card or a different one (a new card becomes the trip's card on file; the page
  says so);
- you're emailed that it needs the guest.
→ `src/lib/charge-email.ts#sendPayLinkEmail`, `src/lib/payments.server.ts#preparePayLink`

## Extras requested after booking

Decided 2026-09-25: **held at request, charged on approval, released on decline.**
- The guest requests extras on `/trips/{trip}/extras`. Each extra gets its **own hold**
  on the saved card (each is answered separately, and a hold can only be charged once).
  If the bank wants confirmation, it happens on that page.
- A declined card refuses that extra rather than recording a request nobody can pay for.
- You **Approve** (the hold is charged, receipt emailed) or **Decline** (released) on the
  reservation page.
→ `src/lib/db.ts#requestTripExtras`, `src/lib/db.ts#decideTripExtra`,
`src/lib/payments.server.ts#holdExtraRequest`
- Unlimited mileage is **checkout-only**: it changes how the trip is billed, so it can't
  be added after booking.
- Current catalogue: prepaid refuel <!-- const:EXTRA_PREPAID_REFUEL -->$45/trip<!-- /const -->,
  unlimited mileage <!-- const:EXTRA_UNLIMITED_MILEAGE -->$80/day<!-- /const -->,
  child seat <!-- const:EXTRA_CHILD_SEAT -->$25/trip<!-- /const -->.
- Requests made before holds existed (sandbox only) are still "collect at pickup".

## Receipts

- The **checkout receipt never changes**. A receipt records a transaction, and a disputed
  charge turns on showing exactly what was charged when.
- Every later charge that actually took money appears **below it**, dated, with its own
  lines, tax, and refunds, then **Total paid for this trip**. Released holds, declined
  requests and failed attempts aren't transactions and don't appear.
→ `src/components/trip/AdditionalReceipts.tsx#AdditionalReceipts`
- The trip pages' totals include them too. The guest's **Total paid** (and "Total cost") is
  the checkout plus every later charge net of refunds, including any part of a deposit
  that was kept, with an "At booking / Added since" split underneath. The owners' **Total
  Earnings** is the same, less the checkout's own refund.
→ `src/lib/charges.ts#paidAfterCheckout`

## Refunding a charge

Reservation page → Additional charges → **Refund** (up to what's left on it). It goes
back to the card that paid it (5–10 business days). Partial refunds are fine; a retried
request never refunds or emails twice.
- The guest is emailed the amount and what it was for; you get a confirmation with your
  note. **Your note is for your records and isn't shown to the guest.**
- The charge shows a green **Refunded** / **Partly refunded** badge on both reservation
  pages, and the receipt adds **Refunded** and **Net paid** lines under it.
- Refunds made by a **cancellation** aren't emailed separately; the cancellation email
  lists them.
→ `src/lib/payments.server.ts#refundCharge`, `src/lib/charge-email.ts#sendChargeRefundedEmails`

## Disputes (chargebacks)

When a guest's bank disputes a payment, you're emailed immediately with the evidence
deadline. **Respond in the Stripe dashboard** (Payments → Disputes); the trip's receipts,
photos and messages are the evidence. Nothing on the site responds automatically.

## Customers are told

`/policies/terms` sections 2, 5 and 6; the checkout consent line; the extras page ("held
on your card now"); the pay page; the receipt and pay-link emails.
