# Cancellation & refunds

*Last checked against the code: 2026-09-29.* Rules: `src/lib/cancellation-policy.ts#refundForCancellation`
and `src/lib/cancellation-policy.ts#laterChargeRefund`. Engine: `src/lib/db.ts#cancelBooking`.
Tested by `scripts/verify-cancellation-policy.ts` (32 checks).

The published version is `/policies/cancellation`, linked from checkout. It is what
customers hold the business to, and every number on it is read from the constants.
The rules are modelled on Turo's published guest policy.

## The two rates

| | Free cancellation until | Price |
|---|---|---|
| **Non-refundable** (default) | <!-- const:FREE_CANCELLATION_HOURS -->24<!-- /const --> hours after booking, or 24 hours before pickup, whichever is first | the anchor price |
| **Refundable** | <!-- const:FREE_CANCELLATION_HOURS -->24<!-- /const --> hours before pickup | + <!-- const:REFUNDABLE_SURCHARGE -->10%<!-- /const --> on the trip price |

Booked within <!-- const:LATE_BOOKING_WINDOW_HOURS -->24<!-- /const --> hours of pickup:
<!-- const:LATE_BOOKING_GRACE_HOURS -->1<!-- /const --> hour after booking instead.
→ `src/lib/cancellation-policy.ts#effectiveFreeCancellationDeadline`

## The checkout charge

| When | Outcome |
|---|---|
| Inside the free window, either rate | **Full refund** |
| Bluefin cancels | **Full refund**, always |
| Refundable, after the window, before pickup | **Partial**: keep a one-day fee (half a day for trips of <!-- const:SHORT_TRIP_DAYS -->2<!-- /const --> days or less) and the refundable premium; pickup or delivery fee and extras back in full |
| Non-refundable, after the window | **No refund** |
| At or after trip start | **No refund** |

**Tax on a partial refund** (since 2026-09-27): tax comes back in proportion to the
pre-tax amount refunded, so the tax on the kept fee is kept. **Placeholder** until an
accountant confirms whether a kept cancellation fee is taxable (tax-todo.md, item 4).

The refund for the checkout charge is computed against the trip **as booked**; an
extension is refunded separately (below). → `src/lib/payments.server.ts#originalEndTime`

## Charges made after booking

*Decided 2026-09-25: extensions follow the trip's policy. The partial rule is Proposed.*

| | Trip: full refund | Trip: partial | Trip: none |
|---|---|---|---|
| **Extension** | all back | all back **except its refundable premium** (and tax on it) | nothing |
| **Extra added after booking** | all back | all back | nothing |
| **Deposit hold** | released | released | released |
| **Deposit hold still waiting on the guest's bank** | cancelled | cancelled | cancelled |
| **Unanswered extra / extension hold** | released | released | released |
| **Owner's charges** (damage, tolls…) | not refunded by cancelling; refund by hand | | |

- The one-day cancellation fee is only ever taken **once**, on the trip, never again
  on an extension.
- Extras added after booking follow the same rule as extras bought at checkout (back
  in full unless the trip gets no refund at all).
→ `src/lib/cancellation-policy.ts#laterChargeRefund`, `src/lib/payments.server.ts#settleLedgerOnCancellation`
- Which of those happens to each charge is one function, checked for every kind of charge
  in every state by `scripts/verify-cancellation-policy.ts`.
  → `src/lib/cancellation-policy.ts#ledgerActionOnCancel`
- Nothing unfinished is left payable after a cancellation. If Stripe won't cancel a payment
  (one still processing at that moment), it is **not** marked cancelled; you're emailed to
  check it in Stripe. Marking it anyway would leave money that later lands with no record.
  → `src/lib/payments.server.ts#abandonUnfinishedCharge`
- The cancel dialog shows the extra refund before the guest confirms, from the same
  function. Its headline ("You'll be refunded …") is the **combined** figure, trip plus
  later charges, with a line saying how much of it is for extensions and extras.
  → `src/lib/db.ts#previewCancellation`, `src/components/CancelTripDialog.tsx#CancelTripDialog`
- The cancellation emails lead with the same combined total and then split it
  ("… in total: $X for your trip and $Y for extensions and extras"), because the guest's
  statement shows separate refunds. The owners' copy states the trip outcome first, then
  the later refunds and the total. → `src/lib/cancellation-email.ts#notifyBookingCanceled`
- If a later-charge refund fails, the trip is still cancelled and you're emailed to
  settle it by hand.

## Owner-initiated cancellations

"Owner-initiated" means an owner cancelling **someone else's** booking. An owner cancelling a
booking they made for themselves is the guest on it and gets the guest's terms (decisions-log
52). → `src/lib/booking-status.ts#cancelsAsBusiness`

Everything comes back in full: the trip, extensions and extras. Holds are released.
Your own charges are not refunded automatically. The cancel dialog on the reservation page
quotes the exact refund before you confirm, and any reason you type is included in the
guest's email. → `src/components/admin/CancelTripModal.tsx#CancelTripModal`

Only a confirmed trip or an unpaid hold can be cancelled. A trip that is already cancelled
or expired is left as it is, and a completed trip is refused, so a second click can never
refund twice or revive a cancelled trip. *(Proposed 2026-10-07, decisions-log 45.)*
→ `src/lib/cancellation-policy.ts#cancelDecisionFor`, `src/lib/db.ts#cancelBooking`

A cancelled trip also can't be confirmed again by its old payment: the webhook and the
checkout page's own confirmation both refuse a cancelled or completed booking.
→ `src/lib/booking-status.ts#checkoutPaymentEffect`

## Abandoned checkouts

A checkout nobody paid for holds the car for <!-- const:PENDING_HOLD -->1 hour<!-- /const -->,
then stops blocking it. The row is marked `expired`, never deleted: a late payment on it
still confirms the booking **if its dates are still free**. If someone else has booked any of
them meanwhile, the payment is stopped before charging where possible, and otherwise refunded
in full automatically, the booking marked cancelled by `system`, and both sides emailed
(decisions-log 48). → `src/lib/payments.server.ts#confirmPaidCheckout`
Discarding one sends no emails; nothing was charged. A checkout whose payment is cancelled in
Stripe is marked `expired` too, never `canceled`: `canceled` always means a paid trip was
called off.

## A cancellation that stops partway

If the server goes down after a trip is marked cancelled but before the refund or the emails,
the payments sweep finishes it (decisions-log 50): the refund is recomputed as of the moment
of cancelling, so it's the figure the guest was quoted; whatever Stripe has already refunded
on the payment is counted, so nothing is refunded twice; then later charges and the emails.
The cancel button and the sweep run the same function.
→ `src/lib/payments.server.ts#completeCancellation`

## How refunds are paid

To the card that paid, usually 5–10 business days. Each refund carries a key so a
retried request can't refund twice. If a refund later fails at the bank, you're emailed:
**the guest has not been paid**, settle by hand.

## Customers are told

`/policies/cancellation` (including the new "Charges made after booking" section, revised
2026-09-27); the cancel dialog; the cancellation email (combined total, then the split).

A cancelled trip's deposit section reads "released", never "we couldn't place your hold":
a cancelled or completed trip isn't owed a hold. → `src/lib/lockbox.server.ts#depositStateFor`
