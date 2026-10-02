# Go-live checklist

Everything between "the code is done" and "a stranger can pay us". Do the steps in order.
Step 1 is the only rehearsal; don't skip it.

*Last checked against the code: 2026-09-29.*

---

## 1. Rehearse in the sandbox, on your laptop

Test locally **before** deploying anything. Untested code never goes to the live site.

> **Status (2026-09-29): Tests 1–12 all passed.** Fixes made during the rehearsal were
> re-tested in place. Next: **1c**, then step 2. Re-run any test whose area you change
> before deploying again.

### 1a. Set up (at the start of each testing session)

**Why:** Stripe sends webhooks from its own servers, which can't reach `localhost`, so the
Stripe CLI forwards them to your laptop. Your laptop and Railway also share **one
database**, so the rentbluefin.com endpoint (still running the old code) must be off while
you test, or it acts on your test bookings too.

- [ ] **Turn off the live endpoint.** Stripe dashboard (sandbox) → Developers → Event
  destinations → the `rentbluefin.com` endpoint → **Disable**. Don't delete it. Leaving it
  off is safe: production uses sandbox keys and bookings are paused there.
- [ ] **Start the listener** in its own terminal window, and leave it running until you're done:
  ```
  stripe listen --forward-to localhost:5173/api/stripe-webhook
  ```
  Ignore two things in Stripe's own "local listener" instructions: `--all-snapshot` (needs a
  newer CLI and isn't needed) and `stripe trigger …` (makes a payment with no booking, which
  the webhook correctly rejects with a 500).
- [ ] **Check the signing secret.** The listener prints `whsec_…`. It should match
  `STRIPE_WEBHOOK_SECRET` in your local `.env` (it stays the same on your machine). Railway
  has a **different** secret, for the rentbluefin.com endpoint. That's correct; never copy one
  into the other.
- [ ] **Bookings are open locally.** `VITE_BOOKINGS_PAUSED` isn't in your `.env`, so the Book
  button shows on your laptop. (It stays set in Railway, so the live site stays paused.)
- [ ] **Lockbox code exists.** Every available car should have a row in `car_secrets` (the
  test code is `0000`). Without one, no code ever shows and the lockbox tests can't pass.
- [ ] **Know that real emails go out**, to the owners' inbox and whatever email the test
  guest account uses. Links in them point at `localhost:5173` (your `.env` `SITE_URL`).

**Reading the listener:** each event appears as `--> event_name` followed by
`<-- [200] POST …`. Every line should say `[200]`. Anything else, paste it to Claude. A
`[400]` means the signing secret doesn't match, or the dev server needs a restart.

**Times in Supabase are UTC**, 5 hours ahead of Central (6 in winter), so they won't match
the site. Don't convert by hand: the tests that move a booking's time give SQL to paste into
the Supabase **SQL editor** using `now()`, which is timezone-proof. `BOOKING_ID` is the long
id at the end of the trip page's URL (`/trips/…`). To see a trip's times in Central:
```sql
select id,
       start_time at time zone 'America/Chicago' as start_central,
       end_time   at time zone 'America/Chicago' as end_central
from public.bookings
where id = 'BOOKING_ID';
```

**Test cards:** any future expiry, any CVC, any ZIP. [All of Stripe's test cards](https://docs.stripe.com/testing)

| Card | Behaviour |
|---|---|
| `4242 4242 4242 4242` | Always works |
| `4000 0000 0000 0341` | Saves fine, then **declines every charge** |
| `4000 0027 6000 3184` | **Asks for authentication** (a Stripe pop-up) every time |

### 1b. Tests

Each test says what to **do** and what to **expect**. Tick it only when every expected thing
happened.

#### Test 1: Booking saves the card
**Do:**
1. Book a trip on `localhost:5173` starting **more than 24 hours** from now. Pay with `4242…`.

**Expect:**
- The listener shows only `[200]`s.
- In Supabase, the new booking's `payment_method_id` is filled in (`pm_…`), and the guest's
  profile has a `stripe_customer_id` (`cus_…`).
- The guest trip page shows **Security deposit**: "A $1,500 refundable hold will be placed…"
  and **no lockbox code** yet.

Keep this booking; Test 3 uses it.

#### Test 2: Deposit placed at booking (trip starts within a day)
**Do:**
1. Book a trip starting **between 3 and 24 hours** from now (3 hours is the minimum) with `4242…`.

**Expect:**
- In Stripe → Payments, a **$1,500 "Uncaptured"** payment for this trip.
- The guest trip page shows the hold as placed, and the **lockbox code (`0000`) shows**.
- A "Your security hold is placed" email to the guest, including the code.

#### Test 3: The sweep places the hold later
**Do:**
1. Take the booking from Test 1 and move its start to 12 hours from now, in the SQL editor:
   ```sql
   update public.bookings
   set start_time = now() + interval '12 hours'
   where id = 'BOOKING_ID';
   ```
2. Run the sweep by hand. Replace `YOUR_CRON_SECRET` with the `CRON_SECRET` value from `.env`
   (just the value, no brackets):
   ```
   curl -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" localhost:5173/api/cron/payments
   ```

**Expect:**
- The response includes `"holdsAttempted":1` and `"errors":[]`. (A `%` at the very end is just
  your terminal marking a missing newline.)
- A $1,500 uncaptured payment in Stripe, the lockbox code on the trip page, and the
  "hold is placed" email.

#### Test 4: A declined deposit
**Do:**
1. Pick a trip that starts within 24 hours and has a hold (Test 2's or Test 3's).
2. On its **admin reservation page** → Security deposit → **Release now**. (Updating the card
   only tries a new hold when the trip has none.)
3. On its **guest trip page** → Security deposit → **Update card** → enter `4000 0000 0000 0341`.
4. In the **same pop-up**, enter `4242 4242 4242 4242` and save.

**Expect:**
- After step 2: the hold disappears from Stripe, a "hold released" email arrives, and the
  lockbox code disappears from the guest page.
- After step 3: the card saves but the hold **declines**. An amber warning, **no lockbox
  code**, a decline email to the guest ("your bank declined it"), and an alert to you. The
  pop-up stays open with the message, ready for another card.
- After step 4: the hold is placed immediately and the lockbox code is back.

#### Test 5: Charging a guest after checkout, and the pay link
Use any confirmed trip whose card on file is `4242…`.

**Part A: a charge that goes through.**
1. Admin reservation page → **Additional charges** → **Charge guest**.
2. Choose **Fuel**, description "Test fuel charge", amount `10`, then **Review** (check the
   tax shown) and **Charge**.

**Expect:** the charge shows as Paid; a receipt email to the guest; on the guest's receipt page,
a new "Charged after booking" section **below** the unchanged checkout receipt.

**Part B: a charge the saved card can't pay.**
1. Guest trip page → Security deposit → **Update card** → `4000 0000 0000 0341`. (The trip
   already has a hold, so nothing is charged. This just changes the card on file.)
2. Admin reservation page → **Charge guest** again, $10.

**Expect:** the charge shows **Awaiting payment**; you get an alert email; the guest gets a
"payment needed" email with a **Pay** button.

**Part C: the guest pays it themselves.**
1. Open the **Pay** link from that email, or **Pay now** next to the charge on the guest trip
   page. Pay with `4242…`.

**Expect:** the page says "Paid", and a receipt email arrives. The `4242` card is now the
trip's card on file again. (The deposit hold stays on whichever card it was placed on;
changing the card only affects future charges.)

**Part D: refunding a charge.**
1. Admin reservation page → Additional charges → **Refund** on the Part A charge → refund
   **part** of it (say $5), with a note.
2. Refund the rest.

**Expect:** after each refund, an email to the guest (without your note) and a confirmation
to you (with it). The charge shows a green **Partly refunded** badge, then **Refunded** with
its amount struck through, on both trip pages. On the receipt its block shows **Refunded**
and **Net paid** lines. Stripe shows two refunds on that payment.

#### Test 6: Extending a trip
Use a confirmed trip that hasn't ended, whose card on file is `4242…`, and that has **no other
booking of the same car right after it**. The extra time must be free, including a 3-hour
turnaround.

**Do:**
1. Guest trip page → **Extend trip**.
2. Choose a return **a full day later** at the same time. Adding only a few hours can cost
   $0, because partial days are already billed as whole days.
3. Check the price shown, then confirm.

**Expect:** the card is charged; the trip's end moves; the **Extensions** section says
Confirmed; a "Your trip has been extended" email to the guest and a notice to you; the
extension appears on the receipt page below the checkout receipt.

#### Test 7: Extending with card authentication (3D Secure)
**Do:**
1. On the same trip: Security deposit → **Update card** → `4000 0027 6000 3184`. A Stripe
   pop-up asks you to authenticate: click **Complete**.
2. **Extend trip** by another full day. The Stripe pop-up appears again: click **Complete**.

**Expect:** the extension is confirmed exactly as in Test 6.
(Optional: repeat, but click **Fail** in the pop-up. The extension shouldn't go through, and
the dialog offers "Pay with a different card".)

#### Test 8: An extension request in the trip's last hour
Extensions asked for within 60 minutes of a trip's end become a request you approve. Any time
of day works; just pick a **new return** between 10:00 AM and 10:30 PM (returns must be in
business hours).

**Do:**
1. Pick a confirmed test trip whose card is `4242…`, and make it a trip that's under way and
   ends in 45 minutes, in the SQL editor:
   ```sql
   update public.bookings
   set start_time = now() - interval '1 day',
       end_time   = now() + interval '45 minutes'
   where id = 'BOOKING_ID';
   ```
   Reload the trip page: it should say the trip ends in about 45 minutes.
2. Guest trip page → **Extend trip** → choose a return the next day (e.g. 12:00 PM) → confirm.
3. Open the admin reservation page: an **Extension request** pop-up should appear in the
   middle of the screen. Click **Approve** there. (Reloading the page shouldn't show it
   again; the request would also be answerable from the Extensions section.)
4. Run the same SQL again (the approval moved the end), extend again, and this time click
   **Decline**.

**Expect:**
- After step 2: the dialog says the request was sent and your card is held; Stripe shows an
  **uncaptured** payment for the amount; you get an "Extension request" email; the guest's
  Extend button says "Extension in progress".
- After step 3: the payment is captured, the trip's end moves, and the guest gets "Your trip
  has been extended".
- After step 4: the hold is released (canceled in Stripe), the end doesn't move, and the guest
  gets "We couldn't extend your trip".

#### Test 9: Extras requested after booking
Use a confirmed trip that **hasn't started yet**, with card `4242…`.

**Do:**
1. Guest trip page → **Request extras** → tick **Child seat** and **Prepaid refuel** → send.
2. Admin reservation page → **Extras** → **Approve** the child seat, **Decline** the prepaid refuel.

**Expect:**
- After step 1: Stripe shows **two uncaptured payments** (each extra plus tax); you get an
  extras-request email; the guest sees both as "Requested · card held".
- After step 2: the child seat is captured (receipt email to the guest); the refuel hold is
  released.

(Unlimited mileage isn't offered here on purpose: it can only be bought at checkout.)

#### Test 10: Cancelling a trip with later charges
**Do:**
1. Book a new trip starting **between 3 and 24 hours** from now with `4242…`. It gets a
   deposit hold.
2. Extend it by a full day (Test 6), and request and **approve** a child seat (Test 9).
3. **Within 1 hour of booking**, cancel it from the guest trip page. A trip booked this close
   to pickup gets a 1-hour free-cancellation window.

**Expect:**
- The cancel dialog's headline "You'll be refunded $X" is the **whole** amount (trip +
  extension + child seat), with a line "This includes $Y back for extensions and extras…",
  and a note that any deposit hold is released.
- After cancelling: in Stripe, **refunds** on the checkout payment, the extension and the
  child seat; the deposit hold is **canceled**; cancellation emails to both sides, each
  leading with the same total and then splitting it.
- The guest trip page's Security deposit section says the hold was released (not "we
  couldn't place your hold").
- Before cancelling, the trip page's **Total paid** is the checkout plus the extension and
  child seat, with "At booking / Added since" underneath; the admin page's **Total
  Earnings** matches. After cancelling, Total Earnings drops by what was refunded.
- Cancelling **after** that hour on the non-refundable rate refunds nothing. That's also
  correct; it's what [cancellation-and-refunds.md](cancellation-and-refunds.md) says.

#### Test 11: The receipt page
**Do:** open the receipt page (`/trips/…/receipt`) of a trip with later charges (Tests 5–9).

**Expect:** the checkout receipt at the top, unchanged; below it, "Charged after booking" with
one block per charge, each with its date, lines, tax and any refund; at the bottom, **Total
paid for this trip**.

#### Test 12: Tax at checkout
**Do:** start a checkout and look at the summary on the payment step.

**Expect:** two tax lines, "Sales tax (9.875%)" and "Minnesota rental vehicle tax (9.2%)" for
a home-base pickup, **above** the Trip total, and the Trip total equals the amount Stripe
charges. A fuel or cleaning charge on the receipt shows the same two lines.

### 1c. When you're done

- [ ] Stop the listener (Ctrl+C). Nothing to change back in `.env`.
- [ ] **Turn the live endpoint back on:** Stripe (sandbox) → Event destinations →
  `rentbluefin.com` → **Enable**.
- [ ] Only now: commit and deploy.

---

## 2. Stripe: switch to live mode

- [ ] **Extended authorization.** Ask Stripe support to enable it (or check whether you're on
  IC+ pricing). Without it, holds on long trips are renewed about every 6 days instead of
  monthly. See [deposit.md](deposit.md#long-trips). **Only after Stripe confirms**, set
  `EXTENDED_AUTHORIZATION_ENABLED = true` in `src/lib/deposit.ts`. Turning it on early makes
  every hold fail.
- [ ] **Live webhook.** In Stripe **live** mode → Developers → Event destinations → add an
  endpoint: `https://rentbluefin.com/api/stripe-webhook` (no `www`), subscribed to **all 14
  events** listed in [payments-overview.md §5](payments-overview.md#5-the-stripe-webhook).
  A missing event doesn't show an error; that feature just silently stops working.
- [ ] **Live keys.** In Railway, change **all three together**, to the live values:
  `STRIPE_SECRET_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET` (from the
  live endpoint you just made). Mixing live and test keys breaks payment.
- [ ] Optional, Stripe's recommendation: use a **restricted API key** (`rk_…`) on the server
  instead of the full secret key.
- [ ] Optional: rotate `CRON_SECRET` (it was pasted in a chat on 2026-09-29). Change it in `.env`,
  Railway, and the `turo_sync_cron_secret` Vault entry together.

## 3. Clear out sandbox test data

Test-mode customers, saved cards and ID checks don't exist in live mode, so leftovers would
point at nothing.

- [ ] **Test bookings** (and their charges, extensions and extras). Ask Claude for the cleanup
  SQL at this point: it has to delete in the right order, because charges reference bookings.
- [ ] **Test accounts' ID verification.** Reset `identity_verified` to false on test profiles,
  or they stay "verified" in live mode.
- [ ] **Test Stripe customers.** Clear `profiles.stripe_customer_id` on test profiles. (The code
  also replaces a stale one automatically, so this is tidiness.)

## 4. Turn on the scheduled payments sweep

Needs step 1c's deploy first: the `/api/cron/payments` route must be live.

- [ ] In the Supabase SQL editor, create the Vault secret with the live URL (don't commit this):
  ```sql
  select vault.create_secret('https://rentbluefin.com/api/cron/payments', 'payments_sweep_url');
  ```
- [ ] Run `supabase/migrations/20260927130000_schedule_payments_sweep.sql` in the SQL editor.
- [ ] Check it's running with the two queries at the top of that file. After 15 minutes you
  should see successful runs.

## 5. Policies and money

- [ ] **Replace the test lockbox code** (`0000`) with the real one. In the Supabase SQL editor,
  with the real code in place of `REAL_CODE`:
  ```sql
  insert into public.car_secrets (car_id, lockbox_code)
  select id, 'REAL_CODE' from public.cars where is_available
  on conflict (car_id) do update
    set lockbox_code = excluded.lockbox_code, updated_at = now();
  ```
  Then open any trip page as an admin and check the real code shows.
- [ ] **Deposit amount.** Confirm it (<!-- const:DEPOSIT_AMOUNT -->$1,500<!-- /const --> for now),
  or change it in `src/lib/deposit.ts#DEPOSIT_AMOUNT`.
- [ ] **Decisions.** Review every row marked **Proposed** or **Placeholder** in
  [decisions-log.md](decisions-log.md).
- [ ] **Terms of service.** Read the draft payment sections on `/policies/terms`, have a lawyer
  look if you can, write the remaining sections, then remove the "Draft" banner and set the
  revision date.
- [ ] **Tax.** Work through [tax-todo.md](tax-todo.md), at least items 1–5 (the sales tax permit
  first), then set `TAX_CONFIG_REVIEWED = true` in `src/lib/tax.ts`.
- [ ] **Privacy policy.** `/policies/privacy` is still empty.

## 6. Open for real bookings

- [ ] Remove `VITE_BOOKINGS_PAUSED` from Railway (it's already absent from `.env`), then delete
  `src/lib/bookings-paused.ts` and the code that imports it (`grep -rn BOOKINGS_PAUSED src`).
- [ ] Make one real booking with a real card, then cancel it for a refund. Check Stripe shows
  the webhook delivered (Developers → Events → the payment → no pending deliveries).
- [ ] Set `VITE_ALLOW_INDEXING=true` in Railway so search engines can list the site.
