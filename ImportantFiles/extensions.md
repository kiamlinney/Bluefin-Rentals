# Trip extensions

*Last checked against the code: 2026-09-29.* Pricing: `src/lib/extension.ts#calculateExtensionPrice`.
Engine: `src/lib/payments.server.ts#startExtension`.

## Who, when, and how

- The guest extends from the trip page (**Extend trip**) any time **before the trip ends**.
  After the end it's a late return, not an extension. (The server would also let an
  owner extend a trip for a guest, charging the card without them present, but the
  reservation page has no button for that yet.) Whoever clicks counts as present if the
  trip is theirs, so an owner extending **their own** booking gets the guest's flow,
  authentication pop-up included.
- **Automatic** if every added minute is free: charged to the saved card and applied on
  the spot. *(Decided 2026-09-25.)*
- **A request** if asked within <!-- const:EXTENSION_REQUEST_CUTOFF_MINUTES -->60<!-- /const -->
  minutes of the trip's end: the card is **held** for the amount, you're emailed, and you
  **Approve** (the hold is charged, the trip's end moves) or **Decline** (the hold is
  released) on the reservation page. *(Decided 2026-09-25.)* The first time you open that
  reservation after the request arrives, it **pops up in the middle of the screen** with
  Approve / Decline / Decide later (once per request, per browser; it also stays in the
  Extensions section). → `src/components/admin/ExtensionRequestModal.tsx#ExtensionRequestModal`
  → `src/lib/extension.ts#extensionMode`, `src/lib/payments.server.ts#decideExtension`
- **Refused** if any of the added time is taken (another trip, the 3-hour turnaround
  buffer, a Turo trip, a blocked date, or another extension in progress).
  → `src/lib/availability.server.ts#assertCarIsAvailable`
- Only one extension can be in progress per trip.
- Returns must be during business hours, on the half hour.

## Holding the car while it's paid for

An extension being paid for (up to <!-- const:PENDING_HOLD -->1 hour<!-- /const -->) or
waiting on your answer **holds its added time** against other renters, exactly like a
checkout hold, so the calendar and checkout both see it. An unpaid one is let go by the
payments sweep after that hour.
→ `src/lib/availability.server.ts#extensionHoldRows`

## Price

*(Decided 2026-09-25: added days only, discount tier of the new total length.)*
- Only the **billable days the extension adds**, at **current** daily prices (including
  any per-date price overrides) for those dates.
- Discounted at the length-discount tier for the trip's **new total length**
  (<!-- const:DISCOUNT_TIERS -->5% from 3 days, 10% from 7 days, 15% from 14 days, 20% from 21 days<!-- /const -->,
  plus <!-- const:LONG_DURATION_DISCOUNT -->5% from 30 days<!-- /const --> on top). Days
  already paid keep the price on their receipt.
- **Proposed:** time added within a day already paid for (billing rounds partial days
  up) **costs nothing**.
- **Proposed:** the trip's own booking rate applies. A refundable trip's extension
  carries the <!-- const:REFUNDABLE_SURCHARGE -->10%<!-- /const --> refundable premium,
  because it's refundable on the same terms.
- **Proposed:** per-day extras on the trip (unlimited mileage) extend with it. Per-trip
  extras and the delivery fee are not charged again. No same-day surcharge.
- Tax is added on top, the same way as the trip ([tax.md](tax.md)).
- Each added billable day brings the usual <!-- const:MILES_INCLUDED_PER_DAY -->200<!-- /const -->-mile
  allowance. → `src/lib/receipt.ts#buildReceipt`

**Worked example** (checked by `scripts/verify-extension-pricing.ts`): a 5-day trip at
$100/day extended to 8 days pays for 3 added days = $300, less the weekly 10% = **$270**
(plus tax); $297 on the refundable rate.

## Payment

The guest is on the page, so their bank can ask them to confirm (3D Secure) in the
dialog. If the saved card is declined, the dialog offers **Pay with a different card**
(the pay page), and the added time stays held for up to
<!-- const:PENDING_HOLD -->1 hour<!-- /const -->.

## Cancellation of an extended trip

The extension follows the trip's refund outcome ([cancellation-and-refunds.md](cancellation-and-refunds.md)).

## Customers are told

`/policies/terms` section 4; the Extend trip dialog (price and whether it's a request);
the "trip extended" / "couldn't extend" emails.
