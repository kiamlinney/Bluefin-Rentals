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
