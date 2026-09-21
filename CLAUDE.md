# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

BlueFin Rentals — a self-hosted car rental platform migrating BlueFin Rentals LLC off Turo to cut commission fees. React 19 + TypeScript + TanStack Start (full-stack, SSR) + Tailwind CSS v4, with Supabase (Postgres + Auth) and Stripe (payments + identity verification).

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

- `_authed.tsx` is a pathless layout route: its `beforeLoad` calls `getUser()` and, if not logged in, renders `<LoginOrSignUp>` inline instead of the child routes (no redirect).
- `admin.tsx` is a real layout route: its `beforeLoad` calls `getUserWithProfile()`, redirects to `/login` if unauthenticated and `/403` if `!user.is_admin`.
- There is **no centralized admin middleware for data access** — every admin-only function in `src/lib/db.ts` independently re-fetches the caller's profile and checks `profile.is_admin` before doing privileged work. When adding a new admin server function, copy this per-function check rather than assuming route-level auth covers it (server functions can be called directly, not just through a loader).

### Data layer (`src/lib/db.ts`, `src/lib/auth.ts`)

All Supabase access is centralized as TanStack `createServerFn` server functions (not a REST/GraphQL API) — these run server-side and are called directly from route `loader`s or client components, e.g. `getCars()`, `getConfirmedBookings()`, `createCheckoutSession({ data })`.

Two different Supabase clients are used, and picking the right one matters:
- `getSupabaseServerClient()` (`src/lib/supabase.server.ts`) — cookie-based, respects RLS as the calling user. Used for normal reads/writes and for `auth.getUser()` checks.
- `createClient(url, SUPABASE_SERVICE_ROLE_KEY)` — bypasses RLS. Used only for privileged server-to-server operations: the Stripe webhook, `confirmBooking`/`cancelBooking`, and cleanup of stale pending bookings in `getUserBookings`. Never expose the service role key to the client.

### Booking / payment flow

- Pickup location is chosen on the car page via `PickupLocationPicker` and modelled as the `PickupSelection` union in `src/lib/pickup.ts` (home base / a listed location / a custom delivery address). Listed locations are free; delivery is a flat `DELIVERY_FEE` and only allowed within `DELIVERY_RADIUS_MILES` of `HOME_BASE`. The selection travels to checkout as structured search params (`pickupKind`/`pickupId`/`pickupAddress`/…) alongside the human-readable `pickupLocation` string — the string is display-only, and `createCheckoutSession` re-resolves the selection server-side (re-geocoding delivery addresses via `src/lib/geocode.ts`) to recompute the fee and the stored `pickup_location`.
- `createCheckoutSession` creates a Stripe `PaymentIntent` and a `bookings` row with `status: 'pending'`, reusing an existing pending booking/intent if one already matches (car, user, time range) to avoid duplicates on retry.
- `src/routes/api/stripe-webhook.ts` is the source of truth for confirming payment: it verifies the Stripe signature against the **raw request body** (must call `request.text()` before any JSON parsing) and flips bookings to `confirmed` on `payment_intent.succeeded` / `charge.succeeded` (handled as a backup path since event ordering isn't guaranteed). `confirmBooking` in `db.ts` is a client-driven fallback that checks the PaymentIntent status directly.
- Stripe Identity (`createIdentitySession` / `finalizeIdentitySession`) handles driver's license verification separately from payment, storing `stripe_identity_session_id` on `profiles` and flipping `identity_verified` via webhook or finalize call.

### Pending holds — the rule three places have to agree on

A `pending` booking is a **soft hold** on the car, lasting `PENDING_HOLD_MS` (1 hour, `src/lib/db.ts`). Three places encode that rule and they must not drift, which is exactly the bug they were introduced to fix — the calendar showed a date as open and checkout then refused it, self-healing an hour later so it looked random:

- `assertCarIsAvailable` — the enforcement point. `confirmed` always blocks; `pending` blocks only while live.
- `getBookedDates` — what the calendar greys out. The `get_car_unavailability` RPC returns `confirmed` **only**, so live holds are read separately with the service-role client and tagged `kind: 'booking'`. They're deliberately *not* added to the RPC: it's `SECURITY DEFINER` and public, so it has no viewer to scope against and would leak in-progress checkouts to anonymous callers. The gathering itself lives in `loadUnavailabilityRows`, which `getFeaturedCars` (the homepage's "Available this week" cars) also calls — so a new source of unavailability added there reaches the calendar and the homepage together. Don't give the homepage its own availability query.
- `expire_stale_pending_bookings()` — housekeeping only (see below).

**The cutoff is computed at read time**, so a stale hold stops blocking the car whether or not the sweep has run. Nothing about availability depends on the schedule.

A customer's own live hold is invisible and non-blocking **to them** (`viewerId` on `assertCarIsAvailable`, `.neq('user_id', viewerId)` in `getBookedDates`) and blocking to everyone else. Holding a car against the person trying to book it is never useful — nudge the dates by an hour and your own abandoned row refuses the new range, turnaround buffer included. `confirmed` still blocks unconditionally, including your own.

### Abandoned checkouts are marked, never deleted

`expire_stale_pending_bookings()` (pg_cron, hourly) marks stale `pending` rows `expired`. **Do not change this to a delete**, and don't add new code that deletes a `pending` row.

The webhook confirms payment by matching `stripe_payment_intent_id` alone, with **no status filter**. Deleting a row leaves its PaymentIntent live and payable, so a customer who leaves the checkout tab open past the hour and then pays is charged against a booking that no longer exists: the webhook matches nothing, returns 500, Stripe retries ~3 days and gives up. Money captured, no booking, no admin email. Keeping the row means that same late payment flips it to `confirmed` and notifies the admin instead.

For the same reason `getBookingById`'s fallback treats `expired` as revivable alongside `pending`. `canceled`, `failed` and `completed` are not.

`expired` is distinct from `canceled` on purpose — a trip the customer called off and a tab they wandered away from are different events. `getUserBookings` filters `expired` out of the customer's trip list.

### Cancellation & refunds — the policy page is part of the code

`src/lib/cancellation-policy.ts` owns the refund rules (modelled on Turo's published policy, `ClaudeFiles/turocancellationpolicy.pdf`). It is pure and isomorphic like `pricing.ts`, because the cancel dialog quotes the guest a figure and `cancelBooking` re-derives it server-side — two implementations would eventually disagree, and the failure mode is showing a customer one refund and paying another. **Never accept a refund amount from the client.**

**When cancellation behavior changes, update `src/routes/policies/cancellation.tsx` in the same change.** That page is linked from checkout, so it is the terms customers agreed to; drift isn't cosmetic, it's a promise the code won't keep. The same goes for the other three surfaces that state the rules: `BookingRateSection.tsx`, `BookingRateInfoModal.tsx`, and the policy line on `admin/reservation.$bookingId.tsx`. Interpolate every number from the constants rather than typing it as prose.

Two rules that are easy to get wrong and have both already caused bugs:

- **The two rates measure their free window from opposite ends** — non-refundable runs 24h from *booking*, refundable runs 24h before *trip start*. They cross on any booking made under ~48h ahead, which let a non-refundable guest out-refund the one who paid `REFUNDABLE_SURCHARGE` for flexibility. `effectiveFreeCancellationDeadline` caps non-refundable by the refundable deadline to prevent it. Don't "simplify" that cap away.
- **A rule stated without a rate qualifier is probably wrong.** The policy page once claimed "cancel at least 24 hours before trip start" as a general full-refund rule; that's the refundable rule only, and a non-refundable guest reading it would expect money they don't get.

`scripts/verify-cancellation-policy.ts` (`node --experimental-strip-types scripts/verify-cancellation-policy.ts`) is the standing suite — 19 checks including an invariant sweep over 290 lead-time × cancel-time combinations asserting refundable is never worse than non-refundable. Run it after touching the deadline logic. There's no test framework in the repo; it's a plain script that exits non-zero.

`cancelBooking` claims the status transition *before* refunding and releases the claim if Stripe fails, so a refund can never succeed against a row that stayed `confirmed`. The refund carries `idempotencyKey: refund_<bookingId>`, so a retry returns the same refund rather than making a second one.

### Ratings & reviews (`src/lib/reviews.ts`, review functions at the end of `db.ts`)

A review belongs to a **booking** (`reviews.booking_id`, unique), and only a `completed` one. `createReview` takes just the booking id and copies `car_id`/`user_id` off the row, so a guest can only review a car they actually rented. Never accept a car id from the client for a guest review. Imported Turo reviews (`source = 'turo'`, admin-entered) are the only rows without a booking.

Reviews disappear in two ways, and they're different on purpose. A guest deleting their own review **hard-deletes** it, so the trip can be reviewed again. An admin removing one **sets `removed_at`**, so the booking stays taken and the review can't just be re-posted. Every read filters `removed_at is null`.

The table has no write policies: all writes go through the service-role client after the server function's own checks. Anonymous reads go through a column grant that leaves out `user_id` and `booking_id`. `getReviews` works out `is_mine` server-side and strips `user_id` before returning. All three pages (`/reviews`, `/fleet/$carSlug`, `/admin/business/ratings-reviews`) summarise through `summarizeRatings` so their numbers can't disagree.

### Scheduled jobs

Recurring work runs as **pg_cron jobs inside the linked Supabase project**, calling `security definer` SQL functions — `auto_complete_bookings()` and `expire_stale_pending_bookings()`, both hourly. There is no CI, no cron config in the repo, and no scheduler in the Node server, so **grepping the codebase will not tell you what is scheduled**; query `cron.job`. Both functions wrap their `UPDATE` in `set local session_replication_role = 'replica'` to bypass table triggers. Follow that pattern for new jobs rather than adding an app route or in-process timer.

The exception is work that needs app code, like reaching Gmail. `sync-turo-bookings` runs every 15 minutes and uses `pg_net` to `POST` to `/api/cron/sync-turo` (`src/routes/api/cron/sync-turo.ts`), authenticated by `CRON_SECRET`. The URL and secret live in Supabase Vault, not in the job's command, because `cron.job` stores commands as plain text. See `supabase/migrations/20260915130000_schedule_turo_sync.sql`, which only works once the site is deployed at a public URL.

### Outbound email (`src/lib/email.ts`, `src/lib/booking-email.ts`)

`sendEmail()` sends through the Gmail API using the same OAuth client `syncTuroBookings` reads with — it knows about messages, not bookings. `booking-email.ts` holds the admin "trip is booked" template (modelled on the Turo host email it replaces) and `notifyAdminBookingConfirmed()`.

Three paths independently flip a booking to `confirmed` — `payment_intent.succeeded` and `charge.succeeded` in the webhook, plus the `confirmBooking` fallback — and Stripe retries webhooks, so **all three call `notifyAdminBookingConfirmed` and the database decides who actually sends**. It claims the send with a conditional update on `bookings.admin_notified_at` (`.is('admin_notified_at', null)`), so exactly one caller gets a row back; the rest no-op. It never throws, and releases the claim if the send fails. When adding a fourth confirmation path, call it there too rather than reasoning about which path "really" confirms.

`sendTestBookingEmail` (admin-only, in `db.ts`) re-sends the email for any existing booking ignoring the claim, so the template can be checked without paying for a trip.

### Turo email sync (`runTuroSync` in `src/lib/turo-sync.server.ts`)

Called by the admin-only `syncTuroBookings` server function (a full 400-day catch-up) and by the cron route (the last 1 day). It lives in its own `.server.ts` file rather than in `db.ts` because `db.ts` is imported by browser pages: the build strips `createServerFn` handler bodies for the client but keeps plain exported functions, so a plain export there drags `googleapis` into the browser bundle and fails `vite build`. Keep new server-only helpers out of `db.ts` for the same reason.

It reads Gmail via the `googleapis` OAuth2 client (refresh token in env) to find Turo booking-confirmation emails, regex-parses trip dates/car/renter/reservation ID out of the plain-text MIME body, and writes `turo_bookings`. Matching against `cars` requires year, make **and** model to match the parsed car string. Turo's emails carry no trim or plate, so identical cars can't be told apart. Active cars (`is_available`) win over retired ones (there are two 2018 Jeep Cherokees, id 6 retired, id 5 active), and anything still ambiguous is reported as an error, not guessed. `AddDriverToTripOwner` and `ReservationReminder*` emails are skipped, and Gmail rate limits are retried with backoff. This is a bridge during the Turo migration, not a general-purpose email integration — treat the parsing regexes as fragile/format-specific if Turo changes their email template.

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
- `src/components/admin/*` are admin-shell-only components (sidebar, calendar grid/toolbar, trip cards); everything else under `src/components/` is used by the public-facing site.

## Environment variables

Required in `.env` (see `.env` locally, never commit real values): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `MAPBOX_TOKEN`, `ADMIN_NOTIFICATION_EMAIL`, `SITE_URL`, `CRON_SECRET`.

`CRON_SECRET` authenticates the scheduled Turo sync endpoint, and must match the `turo_sync_cron_secret` Vault secret. If it's unset the endpoint refuses every request with a 500 rather than running unauthenticated.

`GMAIL_REFRESH_TOKEN` must carry **both** `gmail.readonly` (for `syncTuroBookings`) and `gmail.send` (for the admin booking email in `src/lib/email.ts`). `scripts/gmail-refresh-token.mjs` requests both; a token minted before that script gained the `send` scope fails with "insufficient authentication scopes" and has to be re-minted.

`ADMIN_NOTIFICATION_EMAIL` is who the booking-confirmed email goes to, and `SITE_URL` is only used to build the "View reservation" link inside it. Both are server-side only (no `VITE_` prefix, same as `MAPBOX_TOKEN`) and both have code defaults, so a missing one degrades rather than throws.

`MAPBOX_TOKEN` needs the Geocoding scope and is intentionally **not** `VITE_`-prefixed — it's read only in `src/lib/geocode.ts`, which runs server-side, so the token never reaches the client bundle. Without it, delivery address search returns an empty list and the delivery pickup option is effectively disabled; every other pickup option still works.
