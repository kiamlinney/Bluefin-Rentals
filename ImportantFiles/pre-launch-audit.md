# Pre-launch audit: money and status

**2026-10-07.** Every function that moves money or changes a booking's or charge's status
was read against five questions:

1. What if it runs on the **wrong status** (cancelled, completed, expired)?
2. What if it runs **twice** (double click, retried request, webhook redelivery)?
3. What if **two callers** run it at once (two tabs, the sweep and a page)?
4. What if the server **dies halfway**?
5. Does it **trust anything from the browser** (an amount, an id it doesn't check)?

It started because a cancelled trip still showed "starts in…" and a Cancel button, and a
second cancel could have put the refunded trip back to `confirmed`.

**Why these bugs happen.** The money *rules* (refund maths, tax, extension pricing) are pure
functions with verify scripts, and they held up. Every bug found here was in the code around
them: which status a page or function assumes. Status is plain text with six values, and
nothing fails when one is forgotten. The fix pattern is the same each time: put the decision
in one pure function, use it everywhere, and check every status against it in a script.

## Fixed

| # | Severity | Problem | Fix |
|---|---|---|---|
| 1 | **High** | `confirmBooking` (called by the checkout page) confirmed any matching row. A guest could cancel inside the free window, take the full refund, then call it from the browser and get the trip back, with its deposit hold, welcome email and lockbox code. | Only `pending`/`expired`/`failed` rows confirm, the same rule as the webhook. → `src/lib/booking-status.ts#checkoutPaymentEffect` |
| 2 | **High** | `cancelBooking` had no status check. A second cancel re-ran the refund; once Stripe refused it, the trip was restored to `confirmed`. A completed trip could be refunded in full. | → `src/lib/cancellation-policy.ts#cancelDecisionFor` |
| 3 | Medium | The admin reservation page branched on the clock, not the status: a cancelled future trip showed a countdown and Cancel. | Status first; cancelled trips show who, when, refund, reason. |
| 4 | Medium | A deposit hold waiting on the guest's bank (3D Secure) wasn't cancelled with the trip. Completed later, it put $1,500 on hold for a cancelled trip. | → `src/lib/cancellation-policy.ts#ledgerActionOnCancel` |
| 5 | Medium | A deposit hold placed at the same moment as a cancellation stayed on the card, with a "hold placed" email. | Released on landing, silently. → `src/lib/booking-status.ts#depositHoldBelongs` |
| 6 | Medium | Approving an extension request after the hourly job had closed the trip captured the money but couldn't move the end. | Approve refused unless the trip is confirmed. → `src/lib/payments.server.ts#decideExtension` |
| 7 | Medium | When Stripe refused to cancel an unfinished payment (still processing, or the guest finished at that instant), the row was closed anyway. A row that's closed never updates again, so money that then landed had no record. Also affected an extra approved at the same moment as a cancellation. | Closed only once Stripe confirms; otherwise the real status is recorded, or the owners are alerted. → `src/lib/payments.server.ts#abandonUnfinishedCharge`, `#abandonCharge` |
| 8 | Low | Placing a deposit after abandoning a stale attempt could put a second hold on the card if the stale one had gone through. | Returns "held" instead. → `src/lib/payments.server.ts#ensureDepositHold` |
| 9 | Low | Releasing a hold that was already gone in Stripe restored the row, so the sweep failed on it every 15 minutes forever. | → `src/lib/payments.server.ts#releaseDepositHold` |
| 10 | Low | Owner cancellation emails said the guest had cancelled. | → `src/lib/cancellation-email.ts#notifyBookingCanceled` |

## Second pass (2026-10-07): the open items, and the database itself

Liam asked for A–E fixed ("use your best judgement") and for the database side (RLS policies,
grants, SQL functions, scheduled jobs) checked as thoroughly as the code. The live database
was read with read-only queries (`supabase db query`, `supabase db advisors`); nothing was
changed there. Everything below that needs SQL is in two files for Liam to run (see the end).

| # | Severity | Problem | Fix |
|---|---|---|---|
| A | Medium | **Double booking from a late payment.** A guest leaves checkout open past the 1-hour hold, someone else books those dates, then the first guest pays and their expired booking is revived: two paid trips, one car. | Both fixes. (1) The payment step asks the server just before charging; once the hold has lapsed the dates are re-checked, and if they're taken the payment is cancelled before any money moves. → `src/lib/db.ts#checkCheckoutStillBookable`. (2) Every confirmation path now runs one function; a payment that arrives after its hold lapsed, for dates since taken, is refunded in full, the booking marked cancelled by `system`, and both sides emailed. → `src/lib/payments.server.ts#confirmPaidCheckout`. Stated in the terms, section 1. |
| B | Low | Owner charges on any trip. | Confirmed, completed, or cancelled *after* it started; refused otherwise, on the server and the page alike. → `src/lib/booking-status.ts#ownerChargeAllowed` |
| C | Low | A crash mid-cancellation wasn't retried, which could leave a guest unrefunded. | The payments sweep finishes any cancelled trip whose emails never went out, more than 10 minutes on: refund (counting what Stripe already refunded), later charges, emails. The cancel button and the sweep run the same function. → `src/lib/payments.server.ts#completeCancellation` |
| D | Low | Anyone could run the hourly jobs and the internal trigger functions through the public API. | `revoke execute` (migration). |
| E | Low | The hourly job closed a trip with an extension request still unanswered. | It now waits up to 48 hours for the answer (migration). |
| F | **Critical** | **`inspectTuroEmail` had no auth check.** Anyone, signed in or not, could read any email in the business Gmail inbox by its message id. Only a commented-out debugging panel used it, but a server function is callable directly. | Admin-only. → `src/lib/db.ts#inspectTuroEmail` |
| G | **High** | **Nothing in the database stopped a guest making themselves an admin.** The profile guard trigger protected identity and payment columns but not `is_admin`, and the update policy's check compared `p.id = p.id` (always true), working only because RLS happened to narrow it to the caller's own row. | Trigger guards `is_admin`; policy rewritten to say what it means (migration). |
| H | **High** | **The bookings status trigger allowed `canceled → confirmed` unconditionally**, the database-level door behind both "revive a refunded trip" bugs. | Allowed only while no refund is recorded (the one legitimate use: undoing a cancel whose refund failed) (migration). |
| I | Medium | **`/fleet`'s date search listed every car as free for every customer.** It called `get_available_cars` with the visitor's own permissions, and RLS hides other guests' bookings, admin blocks and Turo trips. Checkout still refused taken dates, so no double booking, but the search was wrong. Verified against live data: for Oct 14–16 it now hides the three cars that are booked. | Uses the calendar's own rules. → `src/lib/availability.ts#dateRangeIsBookable`; the SQL function is dropped after deploy. |
| J | Low | A cancelled checkout payment (webhook `payment_intent.canceled`) marked its pending booking `canceled`, which means "a paid trip was called off" everywhere else. | Marked `expired`, like any abandoned checkout. |
| K | Low | Trip photo paths: `bookings/<id>/../<other>/x.jpg` passed the folder check. | `..` refused. → `src/lib/db.ts#recordTripMedia` |
| L | Low | Four SQL functions had no pinned `search_path` (advisor warning). | Pinned (migration). |
| M | **High** | **Nobody could sign up from 2026-09-27 to 2026-10-08** ("Database error saving new user"). Found in rehearsal Test 15. The Sep 27 profile guard refused any new profile whose `stripe_identity_session_id` wasn't null, and that column defaults to `''`, so every new account was refused. The 2026-10-07 migration copied the check, and its revoke also took the sign-up function from the role Supabase Auth runs as. | `supabase/migrations/20261008120000_fix_signup.sql`, with a rolled-back check to prove it. |
| N | Medium | **Pages disagreed about a trip that had just ended.** A trip stays `confirmed` until the hourly job marks it `completed`; in that window the owner's page said "Booked trip", the guest's said "Past trip" under a CONFIRMED badge with nothing else in the card, and the owner's trip list said "Ending at 3:43 pm" at 4:45 pm. The list also said "Canceled by {guest}" for trips we cancelled. Found in rehearsal Test 18. | One rule for every page, from status and clock together. The guest card now says when the trip ended and links the receipt. → `src/lib/booking-status.ts#tripPhase` |
| O | Low | The pages behind sign-in (trip, receipt, photos, extras, pay link, profile, profile edit) returned HTTP 500 to a signed-out visitor, though they showed the sign-in form: their data loaders still ran and failed without a session. Every guest email links to one of them. | Each loader returns first when signed out; all now answer 200 with the form. → `src/lib/signed-out.ts#SIGNED_OUT`, tested in `tests/signed-out.test.ts` |

`npm test` could not have caught M: the fakes don't run Postgres. Every SQL change now ships
with a check to run in the SQL editor inside `begin; … rollback;`.

**Checked in the database, no problem found:** every public table has RLS on; guests have no
write policy on `bookings` and none on any ledger table; `car_secrets` and the ledger tables
are service-role only; trip photos are a private bucket served by signed URLs; the public
buckets (`car-gallery`, `background-videos`) have no write policies; anonymous review reads
go through a column grant without `user_id`/`booking_id`; the cron routes check
`CRON_SECRET` in constant time and refuse to run without one; every `db.ts` and `payments.ts`
server function that touches a booking or money authorizes first (`assertBookingAccess`,
`requireAdmin` or `requireUser`).

**One Supabase setting for Liam:** Auth → "Leaked password protection" is off (advisor
warning). Turning it on stops sign-ups with passwords known from data breaches.

## Tests

Before this there was no test of the server code at all, only of the pure rules. Now
`npm test` (Vitest, added 2026-10-07) runs:

- **The real server code** (`cancelBooking`, `confirmBooking`, the webhook route,
  `completeCancellation`, the ledger, deposits, extensions, extras, owner charges, refunds,
  the sweep, `/fleet`'s search) against an in-memory Supabase and Stripe
  (`tests/fakes/`). The fakes keep the rules the code leans on: the partial unique indexes,
  the bookings status trigger, Stripe's idempotency keys, refund limits and "can't cancel a
  succeeded payment".
- **Every `scripts/verify-*.ts`** (refund maths, statuses, extension pricing, tax, pickup
  pricing, policy documents).
- **A type check** of the app and the tests.

Each fix above was checked by putting the old bug back and confirming a test fails (mutation
testing), then restoring it. One test was missing until that check: cancelling a trip with
*no* refund and then confirming it. It's in now.

## Still to do before launch

1. **Run `supabase/migrations/20261007120000_prelaunch_hardening.sql`** in the SQL editor,
   *before* deploying.
2. Deploy.
3. **Run `supabase/migrations/20261007130000_drop_get_available_cars.sql`**, then
   `npm run gen:types`.
4. Rehearsal tests 13–20 in [go-live-checklist.md](go-live-checklist.md), and re-run 2, 4, 8
   and 10.
5. Schedule the payments sweep ([go-live-checklist.md](go-live-checklist.md) step 4). Several
   safety nets only run there: releasing holds on cancelled or finished trips, expiring
   abandoned extension payments, and finishing interrupted cancellations (C).
6. First live bookings with people you know; watch Stripe, Railway logs and owner alerts.
