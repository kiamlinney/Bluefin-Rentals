# Decisions log

Every policy decision about money, in the order it was made. **Decided** means you
chose it. **Proposed** means it was filled in to cover a gap and is waiting for your
review. Change it by telling Claude, and the code, the docs and the customer pages
move together.

## 2026-09-25: Stripe overhaul

| # | Topic | Decision | Status |
|---|---|---|---|
| 1 | Payment methods | Card only (credit/debit card, Apple Pay, Google Pay). "Other payment options" (Cash App, Amazon Pay, Affirm, Klarna) removed, because a deposit hold and later charges both need a card on file, and Affirm can't be saved at all. | Decided |
| 2 | Card saving | Every checkout saves the card to a Stripe Customer for later charges, with the guest's consent in the checkout agreement. | Decided |
| 3 | Deposit amount | $1,500 flat for every car, for now. Expected to change, so it lives in one constant. | Decided |
| 4 | Deposit timing | Placed automatically about 24 hours before pickup, or immediately if the trip is booked less than 24 hours ahead. | Decided |
| 5 | Long trips | Hold requested with extended authorization where available, and renewed before it expires: new hold first, then the old one is released. | Decided |
| 6 | Deposit declined | Lockbox code withheld until a hold succeeds. Guest and owners emailed, the system retries, the guest can update their card, and the owners can waive the deposit. | Decided |
| 7 | Deposit release | Released automatically 72 hours after the trip ends, unless the owners captured some of it or chose "keep holding". | Decided |
| 8 | Extensions | Automatic if every added minute is free. Within 1 hour of the trip's end it becomes a request the owners approve (the card is held meanwhile). Refused if any of the time is taken. No extending after the trip has ended. | Decided |
| 9 | Extension price | Only the added billable days, at current prices for those dates, discounted at the tier for the new total trip length. | Decided |
| 10 | Invoicing | Charge the saved card directly. If it declines, email the guest a link to pay on rentbluefin.com. Our own ledger, not Stripe Invoicing. | Decided |
| 11 | Post-booking extras | Card held when the guest requests, charged when the owners approve, released if declined. | Decided |
| 12 | Cancellation | Extension charges follow the trip's own cancellation rules. Extras refunded in full (existing rule). Deposit holds released. Owner-entered charges refunded only by hand. | Decided |
| 13 | Terms of service | Claude drafts the payment sections, marked DRAFT until you (and ideally a lawyer) sign off. | Decided |
| 14 | $0 extensions | An extension that adds no billable day (e.g. two extra hours inside a day already rounded up) costs nothing and applies immediately. | **Proposed** |
| 15 | Extension rate | An extension is priced at the trip's own booking rate, so a refundable trip's extension carries the refundable premium. Per-day extras (unlimited mileage) extend with the trip. No same-day surcharge. The delivery fee isn't charged again. | **Proposed** |
| 16 | Extension refunds | On cancellation an extension gets the trip's outcome: full refund, none, or (refundable rate, cancelled late) everything back except its refundable premium. The one-day cancellation fee is only ever taken once, on the trip. | **Proposed** |
| 17 | Charge categories | Owners can charge for: damage, mileage overage, fuel, tolls, cleaning, late return, other. Amounts are entered case by case. No preset fees. | **Proposed** |

## 2026-09-27: Made while building (review these)

| # | Topic | Decision | Status |
|---|---|---|---|
| 22 | One hold per extra | Each extra requested after booking gets its own card hold, because each is approved or declined on its own and a hold can only be charged once. | **Proposed** |
| 23 | Declined extra request | If the card can't be held for an extra, that extra isn't requested (the guest sees why) rather than recorded unpaid. | **Proposed** |
| 24 | Later extras on cancellation | Extras added after booking are refunded exactly like checkout extras: in full, unless the trip itself gets no refund. | **Proposed** |
| 25 | Deposit declines | The guest and owners are emailed on the first decline in a run; the system retries every 6 hours (faster looks like card testing to banks). | **Proposed** |
| 26 | Hold renewal timing | A long trip's hold is renewed 24 hours before Stripe's deadline; the guest is emailed about it. | **Proposed** |
| 27 | Lockbox code in emails | The booking confirmation email includes the code only if the hold is already placed; otherwise the "hold placed" email carries it. | Follows from #6 |
| 28 | Payments sweep | Runs every 15 minutes as a backstop; anything a person triggers happens immediately. | Implementation |
| 29 | Refunds return tax | A refund returns the tax on the amount refunded; the tax on a kept cancellation fee is kept. | **Placeholder** (tax-todo 4) |
| 30 | Card paid on the pay page | A card the guest uses on the pay link becomes the trip's card on file; the page says so above the button. | **Proposed** |
| 31 | Security fixes | Guests can no longer edit their own booking rows or mark their own ID verified through the public API. | Fix (not a policy) |
| 32 | Webhook: declined checkout attempts | A declined card no longer marks the booking failed; the guest can retry. | Fix (not a policy) |
| 33 | Extended authorization off until Stripe enables it (2026-09-29) | Requesting it on an ineligible account failed every hold in the rehearsal. Holds are standard (~7 days, renewed) until you turn on `EXTENDED_AUTHORIZATION_ENABLED`. | Fix (not a policy) |
| 34 | Setup errors aren't the guest's fault (2026-09-29) | When Stripe refuses a request for a reason other than the card, the guest isn't told their card was declined; the owners are alerted instead. | Fix (not a policy) |
| 35 | Refund and payment totals (2026-09-29) | The cancel dialog and cancellation emails lead with the combined refund (trip + later charges), then split it. "Total paid" on the trip page and "Total Earnings" on the reservation page include every later charge, net of refunds. | Decided |

## 2026-09-27: Tax

| # | Topic | Decision | Status |
|---|---|---|---|
| 18 | Tax engine | Bluefin's own tax module, not Stripe Tax, which doesn't calculate Minnesota's 9.2% rental tax and taxes by where the guest lives rather than where the car is rented. | Decided |
| 19 | Unknown tax facts | Rates published by the Minnesota Department of Revenue go in with sources. Everything unconfirmed is a clearly marked placeholder. There's no accountant yet. | Decided |
| 20 | 5% rental vehicle fee | Not charged: you believe Bluefin is exempt (no more than 20 vehicles for rent, or $50,000 or less in fee-subject receipts the prior year). To confirm. | Decided (to confirm) |
| 21 | Tax display | Itemized at the end of checkout, above the trip total. The car page shows prices before tax. | Decided |
| 22a | Local rates | Saint Paul 9.875% (confirmed from the DOR guide); Minneapolis 9.025% and MSP 8.525% (placeholders); deliveries use Saint Paul's rates (placeholder). | Mixed; see tax.md |
| 22b | Taxability | Rental taxed (confirmed). Delivery, extras, mileage, fuel, cleaning, late return taxed; tolls and damage not (all placeholders). | **Placeholder** (tax-todo 4) |
| 22c | Long rentals | Trips booked for more than 28 days: sales tax only, no rental tax. Extensions don't change a trip's classification. | **Placeholder** (tax-todo 5) |
| 22d | Tax report | Sales count in the month paid; refunds reduce the month of the sale. | **Placeholder** (tax-todo 7) |
| 22e | Tax shown as two lines (2026-09-29) | Guests see "Sales tax" (state + local, one combined rate) and the rental vehicle tax, not one line per local tax. Stored and reported per rate, as the return needs. Amounts unchanged. Re-checked against Revenue Notice #06-08 (2025): the 9.2% rental tax is charged to the renter, on the same base as sales tax. | Decided |

## 2026-10-06: Vehicle swaps

An owner can move a confirmed trip onto another car before it starts, from the reservation page
(**Swap vehicle**). Only cars free for the whole trip are offered, judged the same way checkout
judges availability (other trips, Turo trips, blocked dates, the 3-hour turnaround). The owner
writes a reason, which is emailed to the guest. → `src/lib/vehicle-swap.server.ts#performVehicleSwap`

| # | Topic | Decision | Status |
|---|---|---|---|
| 36 | Swap price | The price doesn't change. There's no charge and no refund, whichever car costs more. The checkout receipt is untouched. | Decided |
| 37 | Swap mileage rate | Overage is still billed at the per-mile rate the guest was quoted, i.e. the original car's. → `src/lib/receipt.ts#buildReceipt` | Decided |
| 38 | Swap and cancellation | No special cancellation right. The normal policy applies; the email tells the guest to reply or call if the new car doesn't work, and an owner can still cancel as host (full refund). | Decided |
| 39 | Swap emails | Only the guest is emailed (the new car, the reason, and the new car's lockbox code if the deposit hold is already in place). The swap and its reason are listed on both trip pages. | Decided |
| 40 | Swap timing | Only before the trip starts, and only for confirmed trips (not unpaid holds). | Decided |

## 2026-10-07: Pickup fees and prepaid refuel

| # | Topic | Decision | Status |
|---|---|---|---|
| 41 | Pickup fees | Pickup at the home base is free. MSP airport, the MSP light rail station and the Grand Hotel Minneapolis are a flat <!-- const:LISTED_PICKUP_FEE -->$100<!-- /const --> each (they were free). Delivery stays <!-- const:DELIVERY_FEE -->$120<!-- /const -->. → `src/lib/pickup.ts#PICKUP_LOCATIONS` | Decided |
| 42 | Pickup fee refunds and tax | A pickup-location fee is treated exactly like the delivery fee: refunded in full on any refund-bearing cancellation, not charged again on an extension, and taxed (placeholder, tax-todo 4). | Decided |
| 43 | Prepaid refuel | <!-- const:EXTRA_PREPAID_REFUEL -->$70/trip<!-- /const --> (was $45). Bookings already made keep the price on their receipt. | Decided |
| 43a | Owner charges open at pickup | **Charge guest** only works once the trip has started. Before that a trip can't have caused a cost (terms, section 6). The saved card could technically be charged any time after checkout, and the deposit hold plays no part in it, so this rule is the only thing stopping it. Sits on top of which statuses can be charged at all. → `src/lib/charges.ts#ownerChargeBlockedReason` | Decided |

## 2026-10-07: Cancellation and status fixes

Found while fixing a cancelled trip that still showed "starts in" and a Cancel button. Full
list: [pre-launch-audit.md](pre-launch-audit.md).

| # | Topic | Decision | Status |
|---|---|---|---|
| 44 | Owner's cancellation reason | When we cancel, we can give a reason, and it is emailed to the guest under "Why we cancelled". A guest's reason still goes only to us. The owners' email now says the trip was cancelled from the reservation page instead of saying the guest cancelled. → `src/lib/cancellation-email.ts#notifyBookingCanceled` | **Proposed** |
| 45 | What can be cancelled | Only a confirmed trip or an unpaid hold. A trip already cancelled or expired is left as it is (a second click does nothing), and a completed trip can't be cancelled: refund it by hand from its charges. → `src/lib/cancellation-policy.ts#cancelDecisionFor` | **Proposed** |
| 46 | Deposit on a cancelled trip | A deposit hold still waiting on the guest's bank is cancelled with the trip. A hold that lands on the card after the trip was cancelled is released at once, with no "hold placed" email. → `src/lib/cancellation-policy.ts#ledgerActionOnCancel` | **Proposed** |
| 47 | Late extension approvals | An extension request can't be approved once the trip is no longer confirmed (it was completed by the hourly job, or cancelled), because the money would be taken without the end time moving. Decline it, and charge for any extra time separately. → `src/lib/payments.server.ts#decideExtension` | **Proposed** |
| 48 | Late payments for dates since taken | A checkout holds the car for <!-- const:PENDING_HOLD -->1 hour<!-- /const -->. If the guest pays after that and someone else has booked any of the dates meanwhile, the payment is stopped before charging when possible; if it gets through, it is refunded in full automatically, the booking is marked cancelled ("Dates taken, refunded"), and the guest and we are both emailed. Stated in the terms, section 1. → `src/lib/payments.server.ts#confirmPaidCheckout`, `src/lib/db.ts#checkCheckoutStillBookable` | Decided (Liam: "do both fixes for A") |
| 49 | Owner charges after a cancellation | We can bill a trip that was cancelled after it had started (the guest had the car), but not one cancelled before pickup, an unpaid hold or an abandoned checkout. → `src/lib/booking-status.ts#ownerChargeAllowed` | **Proposed** |
| 50 | Finishing interrupted cancellations | If a cancellation stops partway (the server goes down after the trip is marked cancelled), the payments sweep completes it within about 15 minutes: the refund the guest was quoted, the later charges, the emails. We're emailed once if its refund keeps failing. → `src/lib/payments.server.ts#completeCancellation` | **Proposed** |
| 51 | Extension request at the trip's end | The hourly job leaves a trip open for up to 48 hours after its end while an extension request is unanswered, so it can still be approved. → `supabase/migrations/20261007120000_prelaunch_hardening.sql` | **Proposed** |
| 52 | An owner's own booking | An owner who books a trip for themselves and cancels it gets the guest's terms, not the full "we cancelled" refund. Only cancelling someone else's booking counts as the business cancelling. Found in the 2026-10-08 rehearsal, where an owner's non-refundable test booking was refunded in full. → `src/lib/booking-status.ts#cancelsAsBusiness` | **Proposed** |
