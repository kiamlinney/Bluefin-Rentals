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
| Refundable, after the window, before pickup | **Partial**: keep a one-day fee (half a day for trips of <!-- const:SHORT_TRIP_DAYS -->2<!-- /const --> days or less) and the refundable premium; delivery fee and extras back in full |
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
| **Unanswered extra / extension hold** | released | released | released |
| **Owner's charges** (damage, tolls…) | not refunded by cancelling; refund by hand | | |

- The one-day cancellation fee is only ever taken **once**, on the trip, never again
  on an extension.
- Extras added after booking follow the same rule as extras bought at checkout (back
  in full unless the trip gets no refund at all).
→ `src/lib/cancellation-policy.ts#laterChargeRefund`, `src/lib/payments.server.ts#settleLedgerOnCancellation`
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

Everything comes back in full: the trip, extensions and extras. Holds are released.
Your own charges are not refunded automatically.

## Abandoned checkouts

A checkout nobody paid for holds the car for <!-- const:PENDING_HOLD -->1 hour<!-- /const -->,
then stops blocking it. The row is marked `expired`, never deleted: a late payment on it
still confirms the booking. Discarding one sends no emails; nothing was charged.

## How refunds are paid

To the card that paid, usually 5–10 business days. Each refund carries a key so a
retried request can't refund twice. If a refund later fails at the bank, you're emailed:
**the guest has not been paid**, settle by hand.

## Customers are told

`/policies/cancellation` (including the new "Charges made after booking" section, revised
2026-09-27); the cancel dialog; the cancellation email (combined total, then the split).

A cancelled trip's deposit section reads "released", never "we couldn't place your hold":
a cancelled or completed trip isn't owed a hold. → `src/lib/lockbox.server.ts#depositStateFor`
