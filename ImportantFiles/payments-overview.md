# Payments overview

How money moves at Bluefin, end to end. Each rule says what happens in plain words,
then **where the code enforces it** and **where customers are told**. Rules marked
**Proposed** were filled in to cover a gap and are waiting for your review
([decisions-log.md](decisions-log.md)).

*Last checked against the code: 2026-09-29.*

---

## 1. The checkout charge

- At checkout the guest pays the **trip total**: the days (after any discount), the
  same-day surcharge if any, the refundable-rate premium if chosen, the pickup fee,
  checkout extras, and **tax**. One Stripe PaymentIntent, charged immediately.
- **Pickup fee:** free at the home base; a flat
  <!-- const:LISTED_PICKUP_FEE -->$100<!-- /const --> at MSP airport, the MSP light rail
  station or the Grand Hotel Minneapolis; a flat <!-- const:DELIVERY_FEE -->$120<!-- /const -->
  to deliver within <!-- const:DELIVERY_RADIUS_MILES -->10<!-- /const --> miles of the home base.
  → `src/lib/pickup.ts#resolvePickup`. **Customers are told:** the pickup picker on the car
  page, the homepage and the FAQ.
- The server re-prices everything itself. Nothing the browser sends decides an amount.
  → `src/lib/db.ts#createCheckoutSession`, `src/lib/pricing.ts#calculateTripPrice`
- The full breakdown is **frozen** into `bookings.price_quote` (now version 2, which
  carries tax) and never rewritten. It is the checkout receipt.
  → `src/lib/receipt.ts#storedQuote`
- **Customers are told:** the checkout summary and the receipt page.

## 2. Payment methods: cards only

- Credit and debit cards, including **Apple Pay and Google Pay** (they are cards). The
  old "Other payment options" (Cash App, Amazon Pay, Affirm, Klarna) were removed on
  2026-09-25. **Why:** the deposit hold and every later charge need a saved card;
  Affirm can't be saved at all, and none of the others can hold a deposit for a trip's
  length.
- **Bank debits (ACH) must never be added.** They take ~4 business days to settle, far
  longer than the 1-hour hold on a car during checkout, which can end in two paid
  bookings for one car.
  → `src/lib/db.ts#PAYMENT_METHOD_TYPES`
- Sources: [Stripe payment method support](https://docs.stripe.com/payments/payment-methods/payment-method-support)

## 3. The card on file

- Every checkout **saves the card** to a Stripe Customer for the guest
  (`setup_future_usage: off_session`). This can only be set on the checkout payment,
  because that's when the guest consents.
  → `src/lib/db.ts#checkoutIntentParams`, `src/lib/payments.server.ts#getOrCreateCustomer`
- **What the guest agrees to** (the checkout checkbox): pay the total, and let Bluefin
  save the card and use it for this trip as the terms describe: a
  <!-- const:DEPOSIT_AMOUNT -->$1,500<!-- /const --> refundable hold about
  <!-- const:DEPOSIT_PLACE_BEFORE_HOURS -->24<!-- /const --> hours before pickup,
  extensions and extras they ask for, and charges for damage, mileage, fuel, tolls or
  other costs from the trip.
  → `src/components/checkout/PaymentStep.tsx#PaymentStep`
- **The saved card is per trip.** `bookings.payment_method_id` is the card the guest
  consented to for that booking. A guest can replace it from the trip page (card
  update), and a card paid with on the pay page becomes the trip's card.
  → `src/lib/payments.server.ts#recordBookingPaymentMethod`, `src/lib/payments.server.ts#finishCardUpdate`
- Bookings made **before** card saving existed have no saved card and can never be
  charged again; the owners' charge form says so. (All such bookings are sandbox tests.)
- **Customers are told:** checkout consent line; `/policies/terms` sections 2–3; FAQ
  "When am I charged?".

## 4. One booking, many charges: the ledger

- Every charge **after** checkout is one row in `booking_charges` with its own
  PaymentIntent, amount, tax, line items, status, capture and refund.
  The checkout receipt is never rewritten. Later charges are **added below it** on the
  receipt page, each as its own dated receipt.
  → `supabase/migrations/20260927120000_payments_ledger.sql#booking_charges`,
  `src/components/trip/AdditionalReceipts.tsx#AdditionalReceipts`
- Kinds: `extension`, `extra`, `deposit`, `adjustment` (an owner's charge).
  → `src/lib/charges.ts#ChargeKind`
- A row is written **before** its PaymentIntent exists, and the intent carries the row's
  id, so a Stripe event can always find its row.
  → `src/lib/payments.server.ts#insertCharge`, `src/lib/payments.server.ts#chargeSavedCard`
- A row's status only moves in one place, and only forward.
  → `src/lib/payments.server.ts#syncChargeFromIntent`
- Details: [charges-and-invoicing.md](charges-and-invoicing.md), [deposit.md](deposit.md),
  [extensions.md](extensions.md).
- **A vehicle swap is not a charge.** Moving a trip onto another car (before it starts)
  writes no ledger row and leaves `price_quote` alone; the deposit, extras and extensions
  follow the booking. Mileage keeps the quoted car's per-mile rate. Decisions 36–40.
  → `src/lib/vehicle-swap.server.ts#performVehicleSwap`

## 5. The Stripe webhook

`/api/stripe-webhook` is the source of truth for money arriving. Every event is routed
by whether its PaymentIntent is the **checkout** charge or a **ledger** charge.
→ `src/routes/api/stripe-webhook.ts`

**These events must be subscribed** on the Stripe webhook destination. Missing one
doesn't cause an error; that feature just silently stops working:

| Event | What it does |
|---|---|
| `payment_intent.succeeded` | Confirms a booking, or settles a ledger charge |
| `payment_intent.payment_failed` | Ledger: records the decline. Checkout: logged only; the guest can retry |
| `payment_intent.canceled` | Ledger: closes the row. Checkout: a still-pending booking becomes canceled |
| `payment_intent.amount_capturable_updated` | A hold (deposit, extension request, extra) went through |
| `payment_intent.requires_action` | The bank wants the guest to authenticate; the pay link goes out |
| `charge.succeeded` | Backup path for either kind |
| `charge.refunded` | Records the refunded amount on the booking or the charge |
| `charge.refund.updated`, `refund.failed` | A refund reversed: records it, emails the owners |
| `charge.dispute.created` | A chargeback: emails the owners with the evidence deadline |
| `setup_intent.succeeded` | A card saved from the trip page (backup for the page) |
| `identity.verification_session.verified` / `.requires_input` / `.canceled` | Driver's license verification |

- **Fixed 2026-09-27:** the webhook used to mark a booking `failed` on the first
  declined card, even though the guest can retry with another card; a successful retry
  then couldn't confirm it. It no longer does.
- **Fixed 2026-09-27:** a late `succeeded` event can no longer revive a canceled or
  completed booking.

## 6. What happens when a booking is confirmed

Four paths can confirm a booking: both webhook events, the page's `confirmBooking`, and
the trip page repairing a booking whose webhook never came. **Since 2026-10-07 all four are
one function** (`confirmPaidCheckout`): it decides from the booking's status whether the
payment confirms it (never a cancelled, completed or refunded one), re-checks the dates of a
payment that arrived after its hold lapsed (refunding it if they were taken), and then runs
the follow-ups. Before that, `confirmBooking` confirmed any matching row, cancelled ones
included. → `src/lib/payments.server.ts#confirmPaidCheckout`

The follow-ups are one function too, and every step in it claims itself in the database, so
each happens once:
1. record the saved card on the booking;
2. place the deposit hold if the trip starts within <!-- const:DEPOSIT_PLACE_BEFORE_HOURS -->24<!-- /const --> hours;
3. email the owners; 4. email the guest.
→ `src/lib/payments.server.ts#onBookingConfirmed`

## 7. The payments sweep (every 15 minutes)

A scheduled job calls `/api/cron/payments`. It places deposit holds ahead of pickup,
retries declined ones, renews holds on long trips, releases holds after trips, lets
go of extension payments nobody finished, and finishes any cancellation that stopped partway
(refund, later charges, emails; see [cancellation-and-refunds.md](cancellation-and-refunds.md)).
→ `src/lib/payments.server.ts#runPaymentsSweep`, `src/routes/api/cron/payments.ts`,
`supabase/migrations/20260927130000_schedule_payments_sweep.sql`
**Why 15 minutes:** it's a backstop. Everything triggered by a person happens
immediately. The sweep only catches deadlines passing; 15 minutes is the worst-case
delay, which matters near pickup.

## 8. Emails about money

| Email | To | When |
|---|---|---|
| Charge receipt | Guest | Every successful charge after checkout (once) |
| Payment needed (pay link) | Guest + owners | A charge the saved card couldn't pay |
| Refund of a later charge | Guest + owners | An owner refunds a charge from the reservation page (cancellation refunds are in the cancellation email instead) |
| Security hold placed (with lockbox code) | Guest | The deposit hold goes through |
| Security hold renewed | Guest | A long trip's hold is replaced |
| Couldn't place your hold | Guest + owners | First decline in a run of declines |
| Part of your hold was kept | Guest | An owner captures from the deposit |
| Hold released | Guest | The deposit hold is released |
| Extension request | Owners | A last-hour extension needs an answer |
| Trip extended / couldn't extend | Guest (+ owners) | An extension is confirmed or declined |
| Refund failed, chargeback, charge problems | Owners | Something needs a person |
| Payment refunded: dates taken | Guest + owners | A late payment for dates booked meanwhile was refunded (once) |

→ `src/lib/charge-email.ts`

## 9. Security fixes made alongside this (2026-09-27)

- **Guests could edit their own bookings** directly with the public API key: any column,
  including the rate (to get refunds they didn't pay for) and the end time. The two
  policies that allowed it were dropped. All booking writes now go through the server.
- **Guests could mark their own ID as verified.** A database trigger now makes identity
  and Stripe fields on profiles server-only.
→ `supabase/migrations/20260927120000_payments_ledger.sql#profiles_guard_server_columns`

**More found 2026-10-07** (full list in [pre-launch-audit.md](pre-launch-audit.md)): anyone
could read the business inbox through an unguarded debugging function; nothing in the
database stopped a guest making themselves an admin; the status trigger let a refunded trip
be confirmed again; a guest could get a refunded trip back by calling `confirmBooking`
directly. All fixed, partly in `supabase/migrations/20261007120000_prelaunch_hardening.sql`.

## 10. Sandbox vs live

Stripe test mode and live mode are separate worlds: customers, saved cards and identity
checks made with test keys **do not exist** under live keys. A stored test customer id
is replaced automatically the first time it's used in live mode
(`src/lib/payments.server.ts#getOrCreateCustomer`). The rest of the switch is in
[go-live-checklist.md](go-live-checklist.md).
