# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Keep this file current.** When a change teaches something a future session would need — a
rule, a trap, a decision and its reason, a bug's real cause, where something lives — write it
here (and in memory, and in `ImportantFiles/` if it touches money) in the same piece of work,
before calling it done. Liam clears chats often; anything left only in a conversation is lost.

## Project

Bluefin Rentals — a self-hosted car rental platform migrating BlueFin Rentals LLC off Turo to cut commission fees. React 19 + TypeScript + TanStack Start (full-stack, SSR) + Tailwind CSS v4, with Supabase (Postgres + Auth) and Stripe (payments + identity verification).

## Commands

```bash
npm run dev     # vite dev — TanStack Start dev server
npm run build   # vite build — outputs to dist/client and dist/server
npm run start   # serves the production build on :3000 via srvx (run `npm run build` first)
npx tsc --noEmit   # type-check (no dedicated script in package.json)
```

`npm run start` is `srvx serve --prod --entry dist/server/server.js --static ../client`.
**The `--static` path is relative to the entry file's directory, not the cwd** — srvx
resolves it as `resolve(dirname(entry), static)` (`node_modules/srvx/dist/cli.mjs:24`),
so from `dist/server` the client build is `../client`. Writing `dist/client` there
silently resolves to `dist/server/dist/client`, finds nothing, and falls back to serving
`public/` — the server still boots and SSR still returns 200, but every asset 404s and
the site renders as unstyled HTML with no JS. The startup banner is the tell: it must
read `Static files: ./dist/client/`, not `(create public/ dir)`.

There is no test suite in this repo. `eslint.config.js` exists but `eslint` is not installed (missing from `package.json`/`node_modules`), so linting is currently non-functional — don't rely on `npm run lint`.

## Architecture

### TanStack Start structure

- `src/router.tsx` builds the router from the auto-generated `src/routeTree.gen.ts`. **Never hand-edit `routeTree.gen.ts`** — it's regenerated from the `src/routes/` file tree.
- There is **no hand-written server entry**. `vite build` emits `dist/server/server.js`, which default-exports a `{ fetch }` handler wired up by the Start plugin's own default entry (`createStartHandler(defaultStreamHandler)`). A `src/ssr.tsx` used to exist here and was deleted: it was written against an older API (`{ router, streamHandler }`), the plugin had stopped picking it up, and it only ever produced a type error. Don't re-add one unless you actually need to customise the handler — and if you do, match the current signature, which takes either the stream handler directly or `{ handler, transformAssets }`. `src/client.tsx` hydrates on the client.
- Routes live in `src/routes/` using TanStack Router's file-based conventions: dot-segments nest under a layout route (e.g. `_authed.checkout.$carId.tsx` is nested under `_authed.tsx`), and directories mirror URL paths (e.g. `admin/trips/booked.tsx` → `/admin/trips/booked`).
- `src/routes/__root.tsx` loads `getUserWithProfile()` in its root loader and renders `<Navbar>` for all non-`/admin` routes.

### Auth & authorization layers

- `_authed.tsx` is a pathless layout route: its `beforeLoad` calls `getUser()` and, if not logged in, renders `<LoginOrSignUp>` inline instead of the child routes (no redirect). On `/checkout` it adds an "Almost there" heading and a back link above the form, because checkout is a bare shell with no navbar.
  - **The `redirect` it passes must be a relative path** (`useLocation().href`, e.g. `/checkout/11?startDate=…`), never `window.location.href`. `SignUpForm` only follows redirects starting with `/`. Passing an absolute URL sent customers who signed up mid-checkout to `/fleet` and lost their trip.
  - **Child loaders still run for signed-out visitors** even though the child component isn't rendered. The checkout loader skips `getProfile()` when `context.isLoggedIn` is false, because it throws without a session.
- `admin.tsx` is a real layout route: its `beforeLoad` calls `getUserWithProfile()`, redirects to `/login` if unauthenticated and `/403` if `!user.is_admin`.
- There is **no centralized admin middleware for data access** — every admin-only function in `src/lib/db.ts` independently re-fetches the caller's profile and checks `profile.is_admin` before doing privileged work. When adding a new admin server function, copy this per-function check rather than assuming route-level auth covers it (server functions can be called directly, not just through a loader).

### Data layer (`src/lib/db.ts`, `src/lib/auth.ts`)

All Supabase access is centralized as TanStack `createServerFn` server functions (not a REST/GraphQL API) — these run server-side and are called directly from route `loader`s or client components, e.g. `getCars()`, `getConfirmedBookings()`, `createCheckoutSession({ data })`.

Two different Supabase clients are used, and picking the right one matters:
- `getSupabaseServerClient()` (`src/lib/supabase.server.ts`) — cookie-based, respects RLS as the calling user. Used for normal reads/writes and for `auth.getUser()` checks.
- `createClient(url, SUPABASE_SERVICE_ROLE_KEY)` (`getServiceRoleClient` in `src/lib/access.server.ts`) — bypasses RLS. Used for privileged writes after the server function's own checks: the Stripe webhook, `confirmBooking`/`cancelBooking`, the payment functions, and **every booking insert and update** (below). Never expose the service role key to the client.

**Guests cannot write `bookings` through their own client at all.** The "Users can insert/update their own bookings" policies were dropped on 2026-09-27 (`20260927120000_payments_ledger.sql`): the status trigger only guarded `status`, so a guest could PATCH their own row with the anon key — flip `booking_rate` to refundable and cancel for money they never paid, move `end_time`, or insert a pending hold with any `created_at`. `createCheckoutSession`'s insert and re-price now use the service role. Likewise a trigger (`profiles_guard_server_columns`) stops a guest setting their own `identity_verified`, identity session or `stripe_customer_id`. **Don't add a guest write policy to either table**; write through a server function.

**Don't give `bookings` a second foreign key to `profiles`.** It makes every `profiles(...)` embed from `bookings` ambiguous (PostgREST `PGRST201`) — that took down the trip, reservation and trip-list pages in production on 2026-09-27 until the `deposit_waived_by` FK was dropped. Store another profile id as a plain `uuid`.

### Booking / payment flow

- Pickup location is chosen on the car page via `PickupLocationPicker` and modelled as the `PickupSelection` union in `src/lib/pickup.ts` (home base / a listed location / a custom delivery address). Listed locations are free; delivery is a flat `DELIVERY_FEE` and only allowed within `DELIVERY_RADIUS_MILES` of `HOME_BASE`. The selection travels to checkout as structured search params (`pickupKind`/`pickupId`/`pickupAddress`/…) alongside the human-readable `pickupLocation` string — the string is display-only, and `createCheckoutSession` re-resolves the selection server-side (re-geocoding delivery addresses via `src/lib/geocode.ts`) to recompute the fee and the stored `pickup_location`.
- **Anyone can price a trip and press Continue.** The car page's booking widget (`src/routes/fleet/$carSlug.tsx`) shows whether or not you're signed in; sign-in happens at checkout through `_authed`.
- **Signing in at checkout relies on a remount.** `CheckoutPage` is a thin wrapper that renders `<CheckoutFlow key={profile?.id ?? 'signed-out'} />`. **Don't remove the key.** After a login or sign-up on that page, `router.invalidate()` flips `_authed`'s context to logged-in *before* the checkout loader re-runs. `CheckoutFlow` therefore first mounts on the signed-out load's data (`profile: null`), and its starting step, `currentProfile` and the driver form are all seeded once from that. Without the key they stayed null for good: ID-verified customers were sent back to step 1 with a blank form, and new sign-ups had to retype their email. (The profile row itself, with the email filled in, is created by the `handle_new_user` trigger.) Any other `_authed` child that seeds `useState` from loader data has the same problem.
- **Trip times start empty.** `startTime`/`endTime` are `""` ("Select Time") until the customer picks one, and everything that prices or validates the trip waits on `tripComplete` (both dates and both times set). `timeToMinutes("")` returns 0 (midnight) rather than failing, so an unguarded empty time silently disables slots or skews pricing. If a date change makes a chosen time unavailable, the time is cleared, never snapped to another slot: every time must be one the customer chose.
- **Choosing a start time opens the end-time dropdown**, the same hand-off as the date calendars. `TimeDropdown` is controlled for this (`isOpen`/`onOpenChange`, with one `openTime` state in the page). It centres the selected option by setting `scrollTop` on its own list. Don't use `scrollIntoView` there: it also scrolls the window and made the page jump.
- `createCheckoutSession` creates a Stripe `PaymentIntent` and a `bookings` row with `status: 'pending'`, reusing an existing pending booking/intent if one already matches (car, user, time range) to avoid duplicates on retry.
- **Cards only, and every card is saved.** `PAYMENT_METHOD_TYPES` in `db.ts` is `['card']` (Apple Pay / Google Pay are cards; Stripe adds `link` itself). The "Other payment options" (Cash App / Affirm / Klarna / Amazon Pay) were removed on 2026-09-25 because the deposit hold and every later charge need a saved card, and Affirm can't be saved at all. Every checkout intent is created with the guest's Stripe Customer and `setup_future_usage: 'off_session'` (`checkoutIntentParams`); `intentForBooking` rebuilds any older intent that lacks either, so no booking can be paid without its card being kept. The checkout consent line in `PaymentStep.tsx` is the guest's authorization for that — change it only together with `/policies/terms`.
- **Every payment method must settle inside `PENDING_HOLD_MS`.** `us_bank_account` (ACH) was removed and must not come back without first changing how a booking holds a car: ACH sits in `processing` for ~4 business days, so the 1-hour hold lapses, the sweep marks the row `expired`, someone else books those dates, and when the debit finally clears the webhook's `payment_intent.succeeded` — which matches on `stripe_payment_intent_id` with no status filter — revives the expired row to `confirmed`. Two paid bookings, one car. (Reviving `expired` rows is correct for a late *card* payment; see below.) ACH can also bounce after the guest has driven off. Anything enabled in the Stripe dashboard is irrelevant unless it is also in that list.
- `src/routes/api/stripe-webhook.ts` is the source of truth for confirming payment: it verifies the Stripe signature against the **raw request body** (must call `request.text()` before any JSON parsing) and flips bookings to `confirmed` on `payment_intent.succeeded` / `charge.succeeded` (handled as a backup path since event ordering isn't guaranteed). `confirmBooking` in `db.ts` is a client-driven fallback that checks the PaymentIntent status directly.
  - **Every event is routed first**: a PaymentIntent with `metadata.chargeId` (or a `kind` other than `'trip'`) is a ledger charge and goes to `syncChargeFromIntent`; anything else is a checkout. Before the ledger, a second PaymentIntent on a booking matched no row, returned 500, and would have been retried for three days.
  - `confirmCheckout` **reads the row before updating**: no row → 500 (the insert may not have committed; retry); `canceled`/`completed` → left alone (a refunded trip is never revived); `pending`/`expired`/`failed` → confirmed.
  - **`payment_intent.payment_failed` no longer marks a checkout `failed`.** Stripe fires it for every declined attempt and the guest can retry on the same intent; marking the row failed made the successful retry unconfirmable.
- Stripe Identity (`createIdentitySession` / `finalizeIdentitySession`) handles driver's license verification separately from payment, storing `stripe_identity_session_id` on `profiles` and flipping `identity_verified` via webhook or finalize call.

### Pending holds — the rule three places have to agree on

A `pending` booking is a **soft hold** on the car, lasting `PENDING_HOLD_MS` (1 hour, `src/lib/availability.server.ts`). A trip **extension** that is being paid for (`pending`, inside the same hour) or waiting on an owner (`requested`) holds its added time the same way — `extensionHoldRows`, read by both of the first two places below. Three places encode that rule and they must not drift, which is exactly the bug they were introduced to fix — the calendar showed a date as open and checkout then refused it, self-healing an hour later so it looked random:

- `assertCarIsAvailable` (`src/lib/availability.server.ts`, shared by checkout and extensions) — the enforcement point. `confirmed` always blocks; `pending` blocks only while live.
- `getBookedDates` — what the calendar greys out. The `get_car_unavailability` RPC returns `confirmed` **only**, so live holds are read separately with the service-role client and tagged `kind: 'booking'`. They're deliberately *not* added to the RPC: it's `SECURITY DEFINER` and public, so it has no viewer to scope against and would leak in-progress checkouts to anonymous callers. The gathering itself lives in `loadUnavailabilityRows`, which `getFeaturedCars` (the homepage's "Available this week" cars) also calls — so a new source of unavailability added there reaches the calendar and the homepage together. Don't give the homepage its own availability query.
- `expire_stale_pending_bookings()` — housekeeping only (see below).

**The cutoff is computed at read time**, so a stale hold stops blocking the car whether or not the sweep has run. Nothing about availability depends on the schedule.

A customer's own live hold is invisible and non-blocking **to them** (`viewerId` on `assertCarIsAvailable`, `.neq('user_id', viewerId)` in `getBookedDates`) and blocking to everyone else. Holding a car against the person trying to book it is never useful — nudge the dates by an hour and your own abandoned row refuses the new range, turnaround buffer included. `confirmed` still blocks unconditionally, including your own.

### Abandoned checkouts are marked, never deleted

`expire_stale_pending_bookings()` (pg_cron, hourly) marks stale `pending` rows `expired`. **Do not change this to a delete**, and don't add new code that deletes a `pending` row.

The webhook confirms payment by matching `stripe_payment_intent_id`, and revives `expired` (and `failed`) rows — only `canceled` and `completed` are left alone. Deleting a row leaves its PaymentIntent live and payable, so a customer who leaves the checkout tab open past the hour and then pays is charged against a booking that no longer exists: the webhook matches nothing, returns 500, Stripe retries ~3 days and gives up. Money captured, no booking, no admin email. Keeping the row means that same late payment flips it to `confirmed` and notifies the admin instead.

For the same reason `getBookingById`'s fallback treats `expired` as revivable alongside `pending`. `canceled`, `failed` and `completed` are not.

`expired` is distinct from `canceled` on purpose — a trip the customer called off and a tab they wandered away from are different events. `getUserBookings` filters `expired` out of the customer's trip list.

`getUserBookings` filters on the stored status only, so it is the one surface that *doesn't* apply the read-time cutoff: between a hold lapsing and the hourly sweep running, the Trips page still lists an abandoned checkout under "Pending Checkouts". Harmless — the car isn't held — but it looks like a bug when you hit the window. Filtering `pending` rows older than `PENDING_HOLD_MS` there would make the page independent of the cron schedule, like everything else.

### Extras (`src/lib/extras.ts`)

Optional add-ons — prepaid refuel, unlimited mileage, a child seat, post-trip cleaning.
**The whole catalogue is one array, `EXTRAS`.** Adding or removing an offering is editing one
entry; nothing else in the codebase enumerates them, because every surface iterates that array.

Pure and isomorphic like `pricing.ts`. Extras are priced **inside `calculateTripPrice`**, not
passed in pre-priced the way `pickupFee` is: a per-day extra needs `billableDays`, which is
computed in there, and pricing them outside would mean a second implementation of the
ceil-of-duration rule. `TripQuoteInput.extraIds` is optional so in-flight requests across a
deploy fall back to no extras — the one value that can never overcharge.

- Extras are **added last and never discounted**, and are **not** in the base the refundable
  premium is a percentage of. That premium buys flexibility on the trip, not on a child seat.
- Each line is **snapshotted** into `price_quote` with its name and unit price, like
  `QuoteDay.price`, so a receipt reprinted after an extra is retired or repriced still shows
  what that guest bought.
- `resolveExtras` canonicalises — unknown ids dropped, duplicates collapsed, `EXTRAS` order.
  That stable order is load-bearing: `createCheckoutSession` compares canonicalised id lists to
  decide whether a pending booking needs re-quoting.
- **Extras are refunded in full on cancellation**, same as the delivery fee — see below.
- **`unlimited-mileage` changes four mileage displays.** `hasUnlimitedMileage(quote)` gates
  `TripSummaryCard`, `TripReceipt`, the guest trip page and `admin/reservation.$bookingId.tsx`,
  where it must also zero `calculateOverage`. Selling unlimited miles and then billing for them
  is the failure this guards.

Chosen on the **checkout payment step**, not the car page — same pattern `bookingRate` set: in
the URL with a `.catch()` fallback, re-resolved server-side, with a snap-back when the server
declines. `initKey` on the checkout page must include the extras, alongside `paymentMode` and
`bookingRate`; leaving an amount input out means the control moves, the summary updates, and
Stripe charges the previous total.

The two resume paths in `createCheckoutSession` differ on purpose: the **dedup path** re-quotes
when the rate *or* the extras changed (it matched on the exact trip range, so `data` provably
describes that row), while the **`bookingId` path** never re-quotes from `data` and returns the
row's own extras for the client to snap back to.

**Extras live in two places, answering two different questions.** This is the one thing to
understand before touching them:

- **`bookings.price_quote.extras`** — the *frozen pricing record*: what was quoted, agreed and
  charged at booking. `refundForCancellation` reads it, and it is never rewritten once a trip
  is paid for. That is what makes a refund describe the money Stripe actually took.
- **`booking_extras`** — *what the trip has now*. Mutable. Every page asking "what extras does
  this trip have?" reads this, including the add-extras form deciding what to hide.

Checkout extras are written to both (`source: 'checkout'`, `charged: true`) by
`syncCheckoutExtras`, which is called after the booking insert **and** after the dedup-path
re-quote — a pending booking can be re-quoted repeatedly before payment, so the rows have to
follow the quote. It's best-effort: `price_quote` remains the authority on what was charged, so
failing a checkout over a mirror table would be the tail wagging the dog.

**Post-booking extras are a request the owners answer — with a hold behind it.**
`/trips/$bookingId/extras` → `requestTripExtras` puts **one card hold per extra** on the saved
card (`holdExtraRequest`: each is answered on its own, and a hold captures only once), then
inserts `source: 'post-booking'`, `status: 'requested'`, `charged: false`, `charge_id` and emails
the owners. A declined hold refuses that extra instead of recording it; a hold the bank wants
the guest to confirm comes back as an `action` the page runs. `decideTripExtra` (admin-only)
flips it to `approved` (hold captured → `charged: true` via the charge's effects) or `declined`
(hold released), and releases its claim if Stripe fails. Only an *approved* row is on the trip.
Rows from before holds existed have no `charge_id` and are still "collect at pickup".

The charge is its own ledger row (below, "Charges after checkout"). It deliberately does not
touch `total_price` or `price_quote` — writing them into `price_quote` is the obvious-looking
shortcut and would make the checkout receipt describe money the checkout never took.

**Requesting is gated on `start_time`, not `end_time`.** Extras are handed over at pickup, so a
request made mid-trip has no moment to be fulfilled in.

**`checkoutOnly: true` on an `ExtraDefinition` keeps it out of post-booking requests entirely.**
Unlimited mileage carries it: that extra is a *billing term*, not an item handed over at pickup,
so requesting it once a trip is priced is a way to erase a mileage bill the guest can already
see coming. `checkoutOnlyExtraIds()` is read by both the request form (to leave them out) and
`requestTripExtras` (to refuse them), so the rule has one definition. Checkout is unaffected —
the full catalogue is offered there.

`decideTripExtra` claims the transition conditionally (`.eq('status', 'requested')`), so a
double-clicked button or two open tabs can't flip an answered request back and forth — the same
pattern as `cancelBooking`.

**Declined rows are kept, and `loadTripExtras` filters them out.** The unique index on
`(booking_id, extra_id)` is partial (`where status <> 'declined'`), so a decline is an answer to
one request rather than a permanent ban — without that, declining a child seat in March makes it
impossible to ask again in April, failing as a raw constraint violation. That index is also the
real guard against duplicates: the form hiding an owned extra and the server filtering it are
both good, but neither survives a retry or two tabs.

**An extra a trip already owns is excluded from that form, and refused by the server.**
`ownedExtraIds(quote)` drives both — `ExtrasSection`'s `exclude` prop hides them, and
`requestTripExtras` filters them out and errors if nothing is left. Asking to add unlimited
mileage to a trip that already has it describes nothing, and acting on it would mean charging
twice for the same thing.

**Both reservation pages must show what a trip bought.** `TripExtrasSection` renders
`price_quote.extras` on the guest trip page and the admin one. Extras were charged, stored and
itemised on the receipt for a while before either page said a word about them, and the only
visible sign was the mileage line reading "Unlimited" — which is how the duplicate-request bug
above went unnoticed.

### Additional drivers

`booking_additional_drivers`, one row per extra driver. Name, email and date of birth, captured
by the guest and **deliberately unverified** — no invite flow and no Stripe Identity check, so
the licence is checked in person at pickup. `validateDriver`'s age floor is the only automatic
gate. Same write posture as `reviews`: no policies, service-role writes behind each server
function's own `assertBookingAccess`.

Pages use `TripDriver` from `src/lib/additional-drivers.ts`, not the generated Row type — it
leaves out `created_by`, which no page displays. Same reasoning as `BOOKING_PROFILE_COLUMNS`.

`removeAdditionalDriver` reads the row to find its booking *before* authorizing, because a
driver id alone must not be enough to delete someone off another guest's trip.

### Guest welcome email (`src/lib/welcome-message.ts`, `src/lib/welcome-email.ts`)

The arrival instructions a guest gets when payment clears, modelled on the message BlueFin sent
by hand through Turo. `welcome-message.ts` is pure and isomorphic and is the **single source of
the text**: the email builds from it and the trip page's Messages section renders the same
output, so the two cannot drift.

`notifyGuestBookingConfirmed` mirrors `notifyAdminBookingConfirmed` exactly, claiming on
`bookings.guest_notified_at`. **There are four confirmation paths** — both webhook events,
`confirmBooking`, and the revival branch in `getTripForGuest` that confirms a booking whose
webhook never arrived. **All four call `onBookingConfirmed`** (`src/lib/payments.server.ts`),
which records the saved card, places the deposit hold if the trip starts within a day, then
sends both emails — in that order, so a same-day trip's welcome email can carry the lockbox
code. A fifth path must call it too; never call the notify functions directly.

**The lockbox code is withheld from a guest until the trip's deposit hold is in place** (or an
owner waived it) — `guestLockboxCode` in `src/lib/lockbox.server.ts` is the only way a guest
gets it: the trip page, `getTripLockboxCode` (callable directly, so it gates non-admins too)
and the welcome email all go through it. Owners always see the code. A trip booked more than
a day out gets a welcome email *without* the code; the "hold placed" email carries it.

The **lockbox code lives in `car_secrets`, not on `cars`** — `cars` is readable by `anon` with
`GRANT ALL`, so a column there would publish every car's door code with the anon key. A
column-level `REVOKE` does not fix that (a table-level grant isn't narrowed by one). The table
has no policies at all and is granted only to `service_role`; `getTripForGuest` reads it fresh
each load, so a rotated code is right on the page even when the emailed one has gone stale.

**There is no admin UI for the codes yet — rows are inserted by hand in Supabase.** The table
starts empty, and an empty table is silent: `buildWelcomeMessage` drops the code sentences
entirely rather than printing "null", so the email and trip page simply say the code will follow.
If a guest reports not getting a code, check for a row before debugging anything else.

```sql
insert into public.car_secrets (car_id, lockbox_code)
select id, '<code>' from public.cars where is_available
on conflict (car_id) do update
  set lockbox_code = excluded.lockbox_code, updated_at = now();
```

Rotating a code is a one-row `update`; the trip page is correct immediately. **The emailed copy
goes stale** — the "hold placed" email goes out about a day before pickup, which narrows that
window but doesn't close it.

### Money is a legal record, not just an implementation detail

**Every payment behaviour must be written down here and stated on a customer-facing
page, in the same change that implements it.** What is charged, when, on whose
consent, and what is refundable. The terms and policy pages are what a customer will
hold the business to, so a charge that exists only in code — with no written statement
of when it applies — is a promise nobody can check.

This covers the checkout charge, extras, trip extensions, damage billing, deposits and
holds, refunds and cancellation fees. It is the general form of the cancellation-policy
rule below.

**Never invent a price, fee or offering.** If a number or a rule didn't come from the
owners, it doesn't go in the product — ask, or leave an obvious placeholder. A
plausible invented detail is worse than a visible gap because nobody questions it.

**The written record is `ImportantFiles/*.md`** (README, payments-overview, deposit,
extensions, charges-and-invoicing, cancellation-and-refunds, tax, tax-todo, decisions-log,
go-live-checklist). Any money change updates the matching document and adds a dated row to
`decisions-log.md` (Decided vs **Proposed**, i.e. filled in to cover a gap). Documents refer to
code as `` `path#Symbol` `` (never line numbers) and tag numbers as
`<!-- const:NAME -->…<!-- /const -->`; `scripts/verify-policy-docs.ts` fails if either drifts
from the code. Run it after touching any payment constant. `ImportantFiles/` is committed
(unlike the git-ignored `ClaudeFiles/`), so these documents are versioned with the code.

**What exists today, precisely** (since 2026-09-27; full detail in those documents):

- The checkout charge, for `quote.total` (tax included), saves the card to the guest's Stripe
  Customer. The guest's consent is the checkout agreement line.
- **Bookings made before card saving have no card on file and can never be charged again** —
  `setup_future_usage` can only be set on the original payment. (Only sandbox bookings.)
- Every charge after checkout is **one row in `booking_charges`** with its own PaymentIntent —
  *one booking, many charges*. **`price_quote` and the checkout receipt are never rewritten**;
  later charges are listed below it (`AdditionalReceipts`). A receipt records a transaction,
  and a disputed charge turns on being able to say what was charged when.

### Charges after checkout (`src/lib/payments.server.ts`, `src/lib/payments.ts`)

`payments.server.ts` holds the rules (plain server-only exports); `payments.ts` holds thin
`createServerFn` wrappers that each authorize first. Shared helpers moved out of `db.ts` for the
same bundling reason as `turo-sync.server.ts`: `access.server.ts` (`getServiceRoleClient`,
`assertBookingAccess`, `requireAdmin`), `availability.server.ts` (`assertCarIsAvailable`,
`PENDING_HOLD_MS`), `lockbox.server.ts`. **Never re-export a `.server.ts` function from a file
browser pages import** — type-only imports are fine.

- **The ledger row is inserted before its PaymentIntent**, which carries
  `metadata.{kind, bookingId, chargeId}`, so the webhook always finds its row.
  `syncChargeFromIntent` is the only place a row's status moves (forward only; settled rows
  never change) and `applyChargeEffects` the only place a change has consequences — the webhook,
  the sweep and the page all behave identically. Every Stripe call carries a per-row
  idempotency key (`charge_<id>`, `capture_<id>`, `refund_<id>_<refundedCents>_<cents>`).
- **Deposit** (`ensureDepositHold`): `DEPOSIT_AMOUNT` in `src/lib/deposit.ts` (the one place the
  figure lives), off-session manual-capture PI, placed `DEPOSIT_PLACE_BEFORE_HOURS` before
  pickup — never earlier, because a
  hold lasts ~7 days. At most one attempt in flight per booking
  (`booking_charges_one_deposit_in_flight`). Renewed new-hold-first before `capture_before`,
  released `DEPOSIT_RELEASE_AFTER_HOURS` after the trip unless `keep_holding`. Capture is
  partial-allowed, once only.
- **Extensions** (`startExtension`, pricing in `src/lib/extension.ts`): automatic if free,
  a held request inside `EXTENSION_REQUEST_CUTOFF_MINUTES` of the end, refused if any added
  time is taken. The `booking_extensions` row is inserted before charging so the time is held;
  `bookings.end_time` only moves in `confirmExtension`, conditional on the end not having moved.
- **Extended authorization is behind `EXTENDED_AUTHORIZATION_ENABLED` (off).**
  `request_extended_authorization: 'if_available'` does *not* fall back when the account isn't
  eligible: Stripe rejects the whole request ("This account is not eligible for the requested
  card features"), which failed every hold in the 2026-09-29 rehearsal. Turn it on only after
  Stripe enables the feature (IC+ pricing or a support request).
- **Only a `StripeCardError` is the guest's problem.** `chargeSavedCard` treats any other Stripe
  error as ours: it cancels the intent, closes the row as `failed` with "Stripe refused the
  request", alerts the owners and gives the guest a neutral message. It never runs the
  guest-facing decline emails for it.
- **Owner charges** (`createAdjustmentCharge`): off-session; a decline or 3DS leaves the row
  `requires_payment` and emails the guest `/trips/$bookingId/pay/$chargeId`.
- **The payments sweep** (`runPaymentsSweep`, `/api/cron/payments`, every 15 min via pg_cron):
  places, retries, renews and releases holds, and expires abandoned extension payments.
- An extended trip's mileage allowance and receipt billable days come from its *current* times
  (`billableDaysFor` in `receipt.ts` takes the larger), so overage isn't billed on paid-for days.
- **`syncChargeFromIntent` treats a row's first sync as a change** even when the status didn't
  move (`requires_payment` → `requires_payment`). Without that, a declined owner charge never
  sent the guest its pay link.
- **On-session vs off-session is decided by who is present, not who is an admin.**
  `startExtension` takes `callerIsAdmin` and treats the guest as present unless an admin is
  extending *someone else's* trip. An admin extending their own booking was charged
  off-session, so 3D Secure failed instead of prompting.
- **Totals include later charges.** The guest's "Total paid" / "Total cost" and the admin's
  "Total Earnings" are the checkout plus `paidAfterCheckout(charges + deposit history)` (net of
  refunds, a kept deposit included); earnings also subtract the checkout's own refund. The
  receipt itself is unchanged — later charges stay below it.
- **Refunds are announced.** An owner refund (`refundCharge` with `notify`) emails the guest
  (without the owner's note) and the owners, and shows a Refunded badge. Cancellation refunds
  are covered by the cancellation email instead, which — like the cancel dialog — leads with the
  combined total (trip + later charges) and then splits it, since the statement shows separate
  refunds. Owners' copy states the trip outcome first.
- **A cancelled or completed trip isn't owed a deposit hold.** `depositStateFor` returns `done`
  for any status other than confirmed/pending — checked *after* the held check, so a completed
  trip whose hold is still on for the inspection window still reads `held`. Before this, a
  trip cancelled inside the hold window told the guest "we couldn't place your hold".

### Testing payments locally (`ImportantFiles/go-live-checklist.md`, step 1)

**Untested payment code is never deployed** — Liam's rule. Test against the sandbox on his dev
server (`:5173`) with `stripe listen --forward-to localhost:5173/api/stripe-webhook`, which
prints the same `whsec_…` already in local `.env` (Railway's differs; that's correct).
**Disable the sandbox's rentbluefin.com event destination while testing**: laptop and Railway
share one database, so the deployed old code would act on test bookings too. Re-enable it
afterwards. Real emails go out during tests. Timestamps in Supabase display in UTC (5 hours
ahead of Central). Test cards: `4242…` normal; `4000 0027 6000 3184` always asks for 3D
Secure; `4000 0000 0000 0341` attaches but declines later, so it **can't complete a checkout**
— book with 4242, then switch the trip's card to 0341 to test declines. Sweep:
`curl -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" localhost:5173/api/cron/payments`.
In instructions for Liam, write placeholders as `YOUR_CRON_SECRET`, not `<CRON_SECRET>`.

### Cancellation & refunds — the policy page is part of the code

`src/lib/cancellation-policy.ts` owns the refund rules (modelled on Turo's published policy, `ClaudeFiles/turocancellationpolicy.pdf`). It is pure and isomorphic like `pricing.ts`, because the cancel dialog quotes the guest a figure and `cancelBooking` re-derives it server-side — two implementations would eventually disagree, and the failure mode is showing a customer one refund and paying another. **Never accept a refund amount from the client.**

**When cancellation behavior changes, update `src/routes/policies/cancellation.tsx` in the same change.** That page is linked from checkout, so it is the terms customers agreed to; drift isn't cosmetic, it's a promise the code won't keep. The same goes for the other three surfaces that state the rules: `BookingRateSection.tsx`, `BookingRateInfoModal.tsx`, and the policy line on `admin/reservation.$bookingId.tsx`. Interpolate every number from the constants rather than typing it as prose.

Two rules that are easy to get wrong and have both already caused bugs:

- **The two rates measure their free window from opposite ends** — non-refundable runs 24h from *booking*, refundable runs 24h before *trip start*. They cross on any booking made under ~48h ahead, which let a non-refundable guest out-refund the one who paid `REFUNDABLE_SURCHARGE` for flexibility. `effectiveFreeCancellationDeadline` caps non-refundable by the refundable deadline to prevent it. Don't "simplify" that cap away.
- **A rule stated without a rate qualifier is probably wrong.** The policy page once claimed "cancel at least 24 hours before trip start" as a general full-refund rule; that's the refundable rule only, and a non-refundable guest reading it would expect money they don't get.

`scripts/verify-cancellation-policy.ts` (`node --experimental-strip-types scripts/verify-cancellation-policy.ts`) is the standing suite — 32 checks including an invariant sweep over 290 lead-time × cancel-time combinations asserting refundable is never worse than non-refundable, and the later-charges rules. Run it after touching the deadline logic. There's no test framework in the repo; it's a plain script that exits non-zero. Its siblings: `verify-extension-pricing.ts`, `verify-tax.ts`, `verify-policy-docs.ts`. Modules they reach must import with explicit `.ts` extensions (`node --experimental-strip-types` resolves specifiers literally).

**Charges made after booking follow the trip's outcome** (`laterChargeRefund`): an extension is
refunded in full on `full`, not at all on `none`, and on `partial` minus its own refundable
premium (the one-day fee is taken once, on the trip); a later extra follows the checkout-extras
rule. `cancelBooking` computes the checkout refund against the **originally booked** end
(`originalEndTime`), then `settleLedgerOnCancellation` refunds later charges, releases deposit
and request holds, and leaves owner charges alone; it never throws and emails the owners about
anything it couldn't settle. `previewCancellation` returns `laterRefund` from the same function.
A partial refund also returns tax in proportion to the pre-tax amount refunded.

`cancelBooking` claims the status transition *before* refunding and releases the claim if Stripe fails, so a refund can never succeed against a row that stayed `confirmed`. The refund carries `idempotencyKey: refund_<bookingId>`, so a retry returns the same refund rather than making a second one.

**Extras are refunded in full**, alongside the delivery fee and for the same reason: a prepaid
tank, a child seat and a cleaning are all services rendered *during* a trip, so a trip that
never happens bought none of them. They're also excluded from the day rate the cancellation fee
is a fraction of — that fee is a fraction of the *trip*, and letting it eat the extras would
quietly undo the decision to refund them.

**Cancelling a `pending` hold is not cancelling a trip.** A hold was never charged, so
`cancelBooking` skips the refund computation entirely, marks the row **`expired`** rather than
`canceled` (so `getUserBookings` filters it out of the guest's list instead of showing a trip
that never was), and **sends no email to either side**. Sending "your trip was cancelled" for a
checkout somebody wandered away from was the bug this fixes. The PaymentIntent is still
cancelled and the row is still never deleted.

The claim is `.eq('status', existing.status)`, not `.in([...])`. Just as strong, but it pins the
branch to the status actually read — with `.in`, a row flipping `pending → confirmed` between
the read and the claim got cancelled down the *pending* path: no refund, no emails, money kept.

`CancelTripDialog` only ever sees confirmed trips now. It exists to quote a refund, and a hold
has none — discarding a pending checkout gets a plain inline confirm on its card on the Trips
page instead. **Cancelling a confirmed trip lives on the guest trip page**, not on the Trips
list card, which is what let that card become a plain `<Link>` instead of an overlay-anchor wrapper.

### Ratings & reviews (`src/lib/reviews.ts`, review functions at the end of `db.ts`)

A review belongs to a **booking** (`reviews.booking_id`, unique), and only a `completed` one. `createReview` takes just the booking id and copies `car_id`/`user_id` off the row, so a guest can only review a car they actually rented. Never accept a car id from the client for a guest review. Imported Turo reviews (`source = 'turo'`, admin-entered) are the only rows without a booking.

Reviews disappear in two ways, and they're different on purpose. A guest deleting their own review **hard-deletes** it, so the trip can be reviewed again. An admin removing one **sets `removed_at`**, so the booking stays taken and the review can't just be re-posted. Every read filters `removed_at is null`.

The table has no write policies: all writes go through the service-role client after the server function's own checks. Anonymous reads go through a column grant that leaves out `user_id` and `booking_id`. `getReviews` works out `is_mine` server-side and strips `user_id` before returning. All three pages (`/reviews`, `/fleet/$carSlug`, `/admin/business/ratings-reviews`) summarise through `summarizeRatings` so their numbers can't disagree.

### Scheduled jobs

Recurring work runs as **pg_cron jobs inside the linked Supabase project**, calling `security definer` SQL functions — `auto_complete_bookings()` and `expire_stale_pending_bookings()`, both hourly. There is no CI, no cron config in the repo, and no scheduler in the Node server, so **grepping the codebase will not tell you what is scheduled**; query `cron.job`. Both functions wrap their `UPDATE` in `set local session_replication_role = 'replica'` to bypass table triggers. Follow that pattern for new jobs rather than adding an app route or in-process timer.

The exception is work that needs app code, like reaching Gmail. `sync-turo-bookings` runs every 15 minutes and uses `pg_net` to `POST` to `/api/cron/sync-turo` (`src/routes/api/cron/sync-turo.ts`), authenticated by `CRON_SECRET`. The URL and secret live in Supabase Vault, not in the job's command, because `cron.job` stores commands as plain text. See `supabase/migrations/20260915130000_schedule_turo_sync.sql`, which only works once the site is deployed at a public URL.

`payments-sweep` is the same shape: every 15 minutes to `/api/cron/payments`
(`runPaymentsSweep`), same `CRON_SECRET` (it reuses the `turo_sync_cron_secret` Vault entry)
plus a `payments_sweep_url` Vault entry. It needs the Stripe API, hence an app route.
`supabase/migrations/20260927130000_schedule_payments_sweep.sql` — **not yet run**; it needs the
route deployed first. Until it runs, deposit holds are only placed when a booking confirms within
a day of pickup, and nothing is released automatically.

### Outbound email (`src/lib/email.ts`, `src/lib/booking-email.ts`)

`sendEmail()` sends through the Gmail API using the same OAuth client `syncTuroBookings` reads with — it knows about messages, not bookings. `booking-email.ts` holds the admin "trip is booked" template (modelled on the Turo host email it replaces) and `notifyAdminBookingConfirmed()`.

Four paths independently flip a booking to `confirmed` — `payment_intent.succeeded` and `charge.succeeded` in the webhook, the `confirmBooking` fallback, and `getTripForGuest`'s revival — and Stripe retries webhooks, so **all four call `onBookingConfirmed`, which calls `notifyAdminBookingConfirmed`, and the database decides who actually sends**. It claims the send with a conditional update on `bookings.admin_notified_at` (`.is('admin_notified_at', null)`), so exactly one caller gets a row back; the rest no-op. It never throws, and releases the claim if the send fails. When adding a fifth confirmation path, call `onBookingConfirmed` there too rather than reasoning about which path "really" confirms.

Emails about money after checkout (receipts, pay links, deposit held/declined/captured/released,
extensions, owner alerts for refund failures and chargebacks) are in `src/lib/charge-email.ts`.
Each claims its send on a `booking_charges` column (`receipt_sent_at`, `action_email_sent_at`)
or is only called by whoever won a conditional update, so none can send twice.

### Tax (`src/lib/tax.ts`)

Bluefin's own, **not Stripe Tax** (no vehicle-rental tax code, no MN 9.2% rental tax, and it
sources by customer address while rental tax follows the pickup). `calculateTax` is the one
function every quote and charge goes through: state 6.875% + local rates by pickup
(`TAX_JURISDICTIONS`, via `taxJurisdictionForPickup` on `ResolvedPickup.taxJurisdiction`) + the
9.2% rental tax for bookings of `SHORT_TERM_MAX_DAYS` or less; the 5% rental fee is off
(`RENTAL_FEE_APPLIES`). What's taxable is `TAXABILITY`. **Many values are placeholders
(`confirmed: false`) and `TAX_CONFIG_REVIEWED` is false** — there's no accountant yet; never
present one as settled. The open questions, with instructions, are
`ImportantFiles/tax-todo.md`; update it, `tax.md` and the constant together.

**Re-checked 2026-09-29 against Revenue Notice #06-08 (Sept 2025) and the Q4 2026 rate guide —
the amounts are right; don't "fix" them down.** A home-base trip is taxed **19.075%**: 9.875%
Saint Paul sales tax (state 6.875 + Metro Area 1 + city 1.5 + Ramsey transit 0.5 — slices of one
rate, not compounding) plus the 9.2% rental tax. The renter pays the rental tax; the business
collects and files it like sales tax. Turo's checkout shows only ~9.875% because Turo is
peer-to-peer car sharing and has lobbied to exempt that (SF 1516 died; SF 2650 introduced 2025;
no exemption in the statute as of 2026-09-29) — irrelevant to Bluefin renting its own fleet.
Fuel taxability is the likeliest placeholder to be wrong (fuel is generally sales-tax exempt).

- `TripQuote` carries `preTaxTotal`, `taxJurisdiction`, `taxLines`, `taxTotal`, and `total`
  includes tax. `price_quote` is now `version: 2`; `storedQuote` reads a version 1 as untaxed.
- The car page shows `preTaxTotal` ("before tax"); checkout itemises tax above the total; the
  receipt prints the lines. `createCheckoutSession` compares the client's figure pre-tax.
- Later charges are taxed with the trip's own context (`taxContextFromQuote`).
- **Stored per rate, shown grouped.** `taxLines` keep one line per rate (the return and the
  tax report need each local tax), but every display goes through `displayTaxLines`: one
  "Sales tax (9.875%)" line plus the rental tax. Five lines read to guests as five taxes
  stacked on each other. Render any new tax display through it too.
- `/admin/business/tax-information` reports collected/refunded/net by month (`tax-report.ts`).

`sendTestBookingEmail` (admin-only, in `db.ts`) re-sends the email for any existing booking ignoring the claim, so the template can be checked without paying for a trip.

### Turo email sync (`runTuroSync` in `src/lib/turo-sync.server.ts`)

Called by the admin-only `syncTuroBookings` server function (a full 400-day catch-up) and by the cron route (the last 1 day). It lives in its own `.server.ts` file rather than in `db.ts` because `db.ts` is imported by browser pages: the build strips `createServerFn` handler bodies for the client but keeps plain exported functions, so a plain export there drags `googleapis` into the browser bundle and fails `vite build`. Keep new server-only helpers out of `db.ts` for the same reason.

It reads Gmail via the `googleapis` OAuth2 client (refresh token in env) to find Turo booking-confirmation emails, regex-parses trip dates/car/renter/reservation ID out of the plain-text MIME body, and writes `turo_bookings`. Matching against `cars` requires year, make **and** model to match the parsed car string. Turo's emails carry no trim or plate, so identical cars can't be told apart. Active cars (`is_available`) win over retired ones, and anything still ambiguous is reported as an error, not guessed. That tiebreak is generic, with no car id in it; it was written because there were then two 2018 Jeep Cherokees (id 5 active, id 6 retired) and trips for the active one were landing on the retired one, leaving the active Jeep bookable while it was out. Car 6 has since been deleted, so nothing exercises the tiebreak today — keep it for the next pair of identical cars. `AddDriverToTripOwner` and `ReservationReminder*` emails are skipped, and Gmail rate limits are retried with backoff. This is a bridge during the Turo migration, not a general-purpose email integration — treat the parsing regexes as fragile/format-specific if Turo changes their email template.

**One row per Turo trip, not per email.** Turo sends several emails about one trip, told apart by the `Notification-Name` header: `ReservationBookedOwner`, `AutoApprovedTripChangeHost` (renter changed dates), `ReservationReminderLongTerm` (day-before reminder) and `CancelledReservationOwner`. Rows are keyed on `turo_trip_id` (unique, taken from the `Reservation-ID` header) and the email with the newest `email_sent_at` (Gmail `internalDate`) wins, so a changed trip *replaces* its original dates. Reminders are skipped outright; cancellations delete by trip id. Don't go back to inserting per email: the table used to be unique only on `gmail_message_id`, and a changed trip kept blocking the car on its old dates alongside the new ones.

### Types

- `src/lib/database.types.ts` is generated from the Supabase schema; `src/types.ts` re-exports row types from it (`Car`, `Booking`, `Profile`, `CarPriceOverride`, `CarBlockedDate`). Regenerate it after any schema change rather than hand-editing it:

  ```bash
  npx supabase gen types typescript --linked --schema public > /tmp/db.types.ts \
    && mv /tmp/db.types.ts src/lib/database.types.ts
  ```

  The temp-file-plus-`&&` form is deliberate. A bare `> src/lib/database.types.ts` truncates the target *before* running the command, so a failed generate leaves an empty file behind — which is exactly how this file sat at 0 bytes, committed, with every type in `src/types.ts` silently resolving to nothing.

- Generated `Row` types describe one table and never include embedded relations, so a query like `.select('*, cars(*), profiles(full_name, email, id)')` returns something wider than `Booking`. `src/types.ts` carries composite types for these — `BookingWithRelations` (`getConfirmedBookings`, `getPastBookings`) and `BookingWithDetails` (`getBookingById`) — and `TripMediaItem` in `src/lib/trip-media.ts` covers the aliased `profiles:uploaded_by(full_name)` join. **When you change a `.select()` that embeds relations, update the matching composite type**, otherwise the mismatch surfaces at the call sites rather than at the query.

- `supabase/` holds `schema.sql` plus `migrations/`; `.temp/` is machine-local CLI metadata. Schema changes are generally made against the linked Supabase project directly, so a migration file existing does not mean the local directory is a complete history of the schema — treat `schema.sql` as the fuller reference.

### Imports & UI conventions

- `tsconfig.json` defines `@/*` → `./src/*`, but the codebase is inconsistent: some files use `@/components/...` and others use relative or bare `src/components/...` imports for the same modules. Match whatever the surrounding file already does rather than "fixing" it.
- UI is hand-written Tailwind v4 with Lucide icons; there is no component library (shadcn/ui was removed). `src/lib/utils.ts` exports a `cn()` (clsx + tailwind-merge) helper for conditional classNames.
- **Colours come from named tokens in `src/index.css`, never raw greys or hex values.** Use the semantic classes — `bg-page`, `bg-surface` (cards/popovers), `bg-subtle` (chips, hover fills), `border-line`, `text-ink` (main text, also the body default), `text-muted` (secondary text), `bg-brand` / `text-on-brand` — and fall back to the palette (`pine-*`, `cream-*`, `ink-*`) only for a deliberate one-off. Exceptions: text/overlays sitting on photos or the homepage video stay `white`/`black`, and `src/components/admin/*` keeps its own neutral greys inside `.admin-shell`.
- The homepage navbar is transparent over the hero video and turns solid when the element marked `data-nav-solid-from` reaches it (`Navbar.tsx`); every other route gets the solid navbar.
- **Check phone layouts against a real iPhone, or a short viewport like 390×664.** Devtools' default phone heights leave out Safari's toolbars, and the cramped homepage calendar only ever showed up on the real device.
- **The search bar has no location field.** Every car serves the same Twin Cities pickup spots, and the real pickup choice is `PickupLocationPicker` on the car page. `/fleet`'s search params are just `start`/`end`.
- **`TripCalendar` is a bottom sheet on phones** (below Tailwind's `sm`, 639px, checked with `matchMedia` when it opens) and an anchored popover from `sm` up. The sheet is portalled to `<body>`, locks page scroll while open and closes on a backdrop tap. The larger day cells in `tripCalendarClassNames` switch at the same `sm` breakpoint, so they only ever appear inside the sheet. Every caller gets this for free, including the car page's start/end calendars.
- **Car page below `lg`** (Turo-style):
  - **Order:** the photo comes first and runs edge to edge, then the title and spec chips, then "Your trip" (`order-first` on the widget column), then features and reviews. Desktop keeps its original layout.
  - **Main photo:** takes `aspect-[5/3]`, because every main photo is 5:3 (1242×745, or 1240×744 for the Cherokee). A fixed height on a narrow screen cropped the sides off each car.
  - **Bottom bar:** a sticky bar carries the total and a single button that walks through "Select dates", "Select times", then "Continue". It's `sticky`, not `fixed`, so it settles above the site footer instead of covering it.
- **`PhotoGallery`** (`src/components/PhotoGallery.tsx`) opens *on top of* the car page rather than replacing it, so closing it keeps the scroll position. Tapping a photo opens a lightbox (arrow buttons, arrow keys, swipe), and Esc backs out one layer at a time: lightbox, then grid, then the page.
- `src/components/admin/*` are admin-shell-only components (sidebar, calendar grid/toolbar, trip cards); everything else under `src/components/` is used by the public-facing site.
- **Vehicles read make → model → year** everywhere a person sees them (`carName()` in
  `email-template.ts`, and every page). The one exception is `carSlug()` in `src/lib/slug.ts`,
  which stays year-first because it is a live, indexed URL — reordering it would change every
  car's address for a cosmetic gain.
- **Pages shared between guest and host must carry `admin-shell` when the viewer is an admin.**
  `/trips/$bookingId/photos` and `/trips/$bookingId/receipt` live outside `/admin`, so without
  it an admin lands in the cream guest theme mid-admin-session. The class redefines the colour
  tokens, so it is the entire fix.
- **Business facts live in `src/lib/business.ts`** — `BUSINESS`, `CONTACT_EMAIL`,
  `CONTACT_PHONE`/`CONTACT_PHONE_HREF`. Never type a phone number, address or the company name
  into a page. The brand is **"Bluefin"**, lowercase `f`, everywhere: in copy, in email subjects
  and in the `SENDER_NAME` in `email.ts`.
- **`src/components/trip/*` is shared by the guest trip page and the admin reservation page.**
  `.admin-shell` in `src/index.css` redefines `--color-surface/-subtle/-line/-ink/-muted`, so a
  component written with the semantic tokens re-themes to the admin greys for free — sharing
  costs nothing and is why those two pages no longer carry five duplicated sections between
  them. Components take a `voice: 'guest' | 'host'` prop where the copy differs, rather than
  being forked.
- `isAirportPickup()` in `src/components/trip/TripLocation.tsx` replaced three hard-coded
  comparisons against the frozen `'MSP - Minneapolis, MN'` literal. It's a lookup in
  `PICKUP_LOCATIONS`, so that constant is now free to change.
- **The guest's trip list lives at `/trips`** (`src/routes/_authed.trips.index.tsx`, an index
  route so it isn't the parent layout of `/trips/$bookingId`). It was `/my-bookings` until
  2026-09-29; `src/routes/my-bookings.tsx` redirects the old address. The profile menu shows
  **Trips** for everyone and **Admin Page** as well for admins. Its loader returns nothing
  for a signed-out visitor, like checkout's — an unguarded `getUserBookings` made a
  signed-out visit a 500 instead of the sign-in form.
- `src/components/trips/*` (plural) is that trip list: `UpcomingTripCard`,
  `PendingCheckoutCard`, `TripHistoryRow`, `NoTripsIllustration`. These replaced a single
  `BookingCard` that tried to be all three.

### Car photos (`src/lib/car-images.ts`)

**Never hand-build a storage URL.** `carMainImageUrl(carId)` covers the single photo most
surfaces show, `carPhotoUrl(carId, 'top_left')` the car page's fixed slots, and
`carImageUrl(carId, fileName)` exact names out of `cars.gallery_images`. The URL was duplicated
across ten files before this existed, which is what made changing buckets a day's work.

All photos live in the **`car-gallery`** bucket. There was a second bucket called
`car gallery` — with a space, so every URL carried `%20`; buckets can't be renamed, so the fix
was a new bucket and a copy. **It holds nothing the site reads; it can be deleted.**

The photos are real Turo listing exports: **`.avif`, 5:3 (1242x745), ~40-190KB each**, replacing phone
screenshots that were 1206x2622 portrait and ~1.3MB. **Don't convert them to WebP or re-encode
them** — they're already lossy AVIF at the right size for every slot that renders them, so a
transcode only loses quality.

Every car has them, so the helper is **one bucket and one extension** with no per-car exception.
It briefly carried both, for the retired Cherokee (car 6), which was totalled before photos were
pulled. **Car 6 was deleted outright on 2026-10-05**, together with its two bookings — sandbox
tests, `livemode=false` intents, nothing else attached.

**Deleting a car is not normally possible.** `bookings.car_id` is `ON DELETE RESTRICT`, so a car
with any booking — including a completed one — refuses to delete until those bookings go, and
deleting a real booking destroys a financial record (see "Money is a legal record"). Six tables
reference `bookings` (`booking_additional_drivers`, `booking_charges`, `booking_extensions`,
`booking_extras`, `reviews`, `trip_media`) and six reference `cars` (`bookings`,
`car_blocked_dates`, `car_price_overrides`, `car_secrets`, `reviews`, `turo_bookings`). Car 6 was
only safe because every one of those counts was zero apart from the two test bookings. Retiring a
car normally means `is_available = false`, not a delete — and note **`getCarById` doesn't filter
`is_available`**, so a retired car's page and its trips' pages still render and still need photos.

`scripts/upload-car-images.ts` uploads from `ClaudeFiles/car_images/<Folder>` and prints the SQL
for `image_url`/`gallery_images`. Two things it exists for:

- **`cacheControl: '31536000'`.** The Supabase dashboard uploader sets its own value and gives
  you no way to change it; the old bucket's `max-age=3600` meant a revalidation round trip per
  image per page view. **Verify a cache header with GET, not HEAD** — Storage returns `no-cache`
  on HEAD regardless of what's stored, which reads exactly like the setting having failed:
  `curl -s -D- -o /dev/null -r 0-0 '<url>' | grep -i cache-control`.
- **Gallery order.** The four corners were renamed out of the middle of the numbered run, so each
  car's numbering has exactly four holes and those holes are where the corners belong
  (`bottom_left, top_right, top_left, bottom_right`, ascending). The script derives that and
  throws rather than guessing. Fusion (car 3) is numbered differently and is written out in
  `MANUAL_ORDER`. It **cannot** detect a deleted numbered file — the hole count comes out to four
  by construction — so if you remove a photo, re-read the printed SQL.

**Order of operations when adding a car:** upload the files, *then* run the SQL. The page reads
`image_url`/`gallery_images`, so a row pointing at files that aren't uploaded yet is a broken
gallery.

The car page's four corner thumbnails are `hidden lg:block` and carry `loading="lazy"`
**deliberately**: browsers fetch `display:none` images, so without it phones downloaded
280-600KB per car page that never rendered (measured in Chrome — 5 image requests down to 1).
`fetchPriority="high"` belongs on the main photo **only**; it works by ranking one resource above
others, so spreading it across all five puts the LCP image back in a five-way contest.

## Deployment (Railway + Namecheap)

The site is live at **https://rentbluefin.com** (and `www.`), served from **Railway**,
Hobby plan, one service deploying `main` from `github.com/kiamlinney/Bluefin-Rentals` on
every push. Railway was chosen over Vercel/Netlify because the app needs a real Node
runtime (`googleapis` in `turo-sync.server.ts` and `email.ts`, `node:crypto` in the cron
route) and an always-on process with no request cap — the Turo cron job budgets up to 60s
per call, and Netlify's free tier caps synchronous functions at 10s. Vercel's Hobby tier
forbids commercial use, so a site taking payments would need Pro at $20/mo.

**Nothing about the build is Railway-specific.** `vite build` emits a portable `{ fetch }`
handler, so moving to Fly/Render/a VPS is a host swap, not a port. Railway injects `PORT`
and srvx reads it (`process.env.PORT`, 3000 fallback) — **never hardcode `--port` in the
start script** or Railway can't route traffic.

**Run only one Railway service.** Two services on the same repo both build on every push
and both burn the $5 Hobby credit. Hobby's ceiling (8 vCPU / 8 GB per replica) is far
beyond what this app uses; the realistic reasons to ever reach Pro are a second team
member (Pro is per-seat), replicas, or log retention (7 days Hobby vs 30 Pro) — not
traffic. Railway logs are the only place the webhook's `console.log` lines survive, and
only for 7 days.

### DNS

Registrar and DNS are **Namecheap** (BasicDNS, `dns1/dns2.registrar-servers.com`), domain
privacy on by default. Three records, all pointing at the same Railway target:

| Type | Host | Value |
|---|---|---|
| ALIAS | `@` | `<service>.up.railway.app` |
| CNAME | `www` | `<service>.up.railway.app` |
| TXT | `_railway-verify` | `railway-verify=…` |

- **ALIAS, not A, at the apex.** DNS forbids a CNAME at the root and Railway's IPs move, so
  a static A record would silently break. Namecheap's ALIAS re-resolves.
- **The TXT is not optional.** Without it the domain returns 404 even once the CNAME
  resolves. Only the apex needs one; a subdomain verifies off its CNAME.
- **Delete Namecheap's default parking records** (`www` → `parkingpage.namecheap.com` and
  the `@` URL redirect) or they conflict.
- **Both hostnames must be added as custom domains in Railway.** Railway routes by Host
  header and issues a per-hostname certificate, so a `www` CNAME alone gets a TLS error.
  No redirect is needed between them: the canonical tag names the apex, so search engines
  consolidate there.
- If Cloudflare is ever put in front, leave the proxy **off** — Railway may not issue a
  certificate for a proxied domain, and a proxied setup additionally requires SSL mode
  "Full", not "Full (Strict)".

### Stripe environments

Stripe **sandboxes are fully isolated** — their own keys, webhook destinations, settings
and data. Nothing configured in a sandbox carries to live. Going live means changing all
three of these **together**, since a live secret key with a test publishable key creates
the PaymentIntent in one mode and confirms it in the other:

```
STRIPE_SECRET_KEY  ·  VITE_STRIPE_PUBLISHABLE_KEY  ·  STRIPE_WEBHOOK_SECRET
```

The webhook is configured in Stripe under **Event destinations** (the old "Add endpoint"),
scope **Your account**, type **Webhook endpoint**, URL `https://rentbluefin.com/api/stripe-webhook`
(apex, no `www`). **Subscribe to all fourteen events the handler implements** — subscribing to
fewer doesn't error, it silently disables that code path (miss `charge.refunded` and
cancellations never record a refund; miss `payment_intent.amount_capturable_updated` and
deposit holds only register when the page or sweep re-reads them). The four added on
2026-09-27 must be added to the **sandbox** destination too:

```
payment_intent.succeeded   payment_intent.payment_failed   payment_intent.canceled
payment_intent.amount_capturable_updated                   payment_intent.requires_action
charge.succeeded           charge.refunded                 charge.refund.updated
refund.failed              charge.dispute.created          setup_intent.succeeded
identity.verification_session.{verified,requires_input,canceled}
```

New destinations can't choose an API version in the UI; they use the account's current one
(`2026-03-25.dahlia`). That is fine — the installed Stripe SDK (v21) is *built* for dahlia, and
**no code pins an `apiVersion` any more** (the old `'2023-10-16'` pins were removed on
2026-09-27), so requests and webhook payloads are on the same version the types describe.

**Verifying a booking end-to-end without the dashboard:** `GET /v1/events` returns
`pending_webhooks` per event — `0` means the endpoint answered 2xx, which proves signature
verification against the raw body worked. Pair that with the `bookings` row (`status`,
`admin_notified_at`, `refunded_amount`, `refund_id`). Both the webhook and the
`confirmBooking` client fallback fire within the same second, so the row alone can't say
which won; the `pending_webhooks` count can.

### Search indexing

`ALLOW_INDEXING` in `src/lib/site.ts` (`VITE_ALLOW_INDEXING === 'true'`, **off unless set**)
gates three things: the `noindex, nofollow` meta tag in `__root.tsx`, whether
`sitemap.xml` serves or 404s, and whether `robots.txt` advertises the sitemap.

**`robots.txt` keeps allowing crawls even while indexing is off, deliberately.** `noindex`
is what keeps pages out of search results, and a crawler has to fetch a page to read it.
A blanket `Disallow: /` would block the crawl while leaving Google free to index the bare
URL from any external link — a listing nothing on the site can retract. Don't "fix" the
robots file by disallowing everything.

Flip `VITE_ALLOW_INDEXING=true` only once real payments work. It's `VITE_`-prefixed, so it
is baked in at build time and changing it triggers a rebuild.

## Environment variables

Required in `.env` (see `.env` locally, never commit real values): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `MAPBOX_TOKEN`, `ADMIN_NOTIFICATION_EMAIL`, `SITE_URL`, `VITE_SITE_URL`, `CRON_SECRET`, and optionally `VITE_ALLOW_INDEXING`.

**Local `.env` stays on localhost and sandbox keys.** Production values live only in
Railway's variables. A live secret key in local `.env` means a test booking on your laptop
charges a real card.

**`VITE_BOOKINGS_PAUSED` is temporary and off by default.** Set to `true` it hides the pay
button on the final checkout step and makes `createCheckoutSession` throw before creating a
PaymentIntent or a `pending` row — the site is public before it's ready to take money, so a
visitor can walk the whole checkout but not finish it. Anything other than `'true'` (including
unset) means bookings work, so a forgotten variable fails open rather than silently killing
the business. It must be set in **both** `.env` and Railway; they're independent. To open
bookings, unset it in both and delete `src/lib/bookings-paused.ts` plus its two importers
(`grep -rn BOOKINGS_PAUSED src`), then delete this paragraph.

**`VITE_`-prefixed variables are compiled into the bundle at build time**, not read at
runtime, so changing one requires a rebuild (Railway does this automatically on a variable
change). That applies to `VITE_SITE_URL`, `VITE_ALLOW_INDEXING` and the publishable key.

**`SITE_URL` and `VITE_SITE_URL` are different variables and both are needed.**
`src/lib/site.ts` reads `import.meta.env.VITE_SITE_URL` (fallback `http://localhost:5173`)
and that is what drives canonical tags, `og:url`, the sitemap, the `Sitemap:` line in
robots.txt and the `AutoRental` JSON-LD. It is `VITE_`-prefixed because the canonical tag
renders during SSR and again at hydration, and a server-only value would be invisible to
the browser. Setting only `SITE_URL` in production ships a site whose every page tells
Google its official home is `http://localhost:5173`.

`CRON_SECRET` authenticates both scheduled endpoints (`/api/cron/sync-turo` and `/api/cron/payments`), and must match the `turo_sync_cron_secret` Vault secret. If it's unset the endpoint refuses every request with a 500 rather than running unauthenticated.

`GMAIL_REFRESH_TOKEN` must carry **both** `gmail.readonly` (for `syncTuroBookings`) and `gmail.send` (for the admin booking email in `src/lib/email.ts`). `scripts/gmail-refresh-token.mjs` requests both; a token minted before that script gained the `send` scope fails with "insufficient authentication scopes" and has to be re-minted.

`ADMIN_NOTIFICATION_EMAIL` is who the booking-confirmed email goes to, and `SITE_URL` is only used to build the "View reservation" link inside it. Both are server-side only (no `VITE_` prefix, same as `MAPBOX_TOKEN`) and both have code defaults, so a missing one degrades rather than throws.

`MAPBOX_TOKEN` needs the Geocoding scope and is intentionally **not** `VITE_`-prefixed — it's read only in `src/lib/geocode.ts`, which runs server-side, so the token never reaches the client bundle. Without it, delivery address search returns an empty list and the delivery pickup option is effectively disabled; every other pickup option still works.
