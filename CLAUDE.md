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

- `_authed.tsx` is a pathless layout route: its `beforeLoad` calls `getUser()` and, if not logged in, renders `<LoginOrSignUp>` inline instead of the child routes (no redirect). On `/checkout` it adds an "Almost there" heading and a back link above the form, because checkout is a bare shell with no navbar.
  - **The `redirect` it passes must be a relative path** (`useLocation().href`, e.g. `/checkout/11?startDate=…`), never `window.location.href`. `SignUpForm` only follows redirects starting with `/`. Passing an absolute URL sent customers who signed up mid-checkout to `/fleet` and lost their trip.
  - **Child loaders still run for signed-out visitors** even though the child component isn't rendered. The checkout loader skips `getProfile()` when `context.isLoggedIn` is false, because it throws without a session.
- `admin.tsx` is a real layout route: its `beforeLoad` calls `getUserWithProfile()`, redirects to `/login` if unauthenticated and `/403` if `!user.is_admin`.
- There is **no centralized admin middleware for data access** — every admin-only function in `src/lib/db.ts` independently re-fetches the caller's profile and checks `profile.is_admin` before doing privileged work. When adding a new admin server function, copy this per-function check rather than assuming route-level auth covers it (server functions can be called directly, not just through a loader).

### Data layer (`src/lib/db.ts`, `src/lib/auth.ts`)

All Supabase access is centralized as TanStack `createServerFn` server functions (not a REST/GraphQL API) — these run server-side and are called directly from route `loader`s or client components, e.g. `getCars()`, `getConfirmedBookings()`, `createCheckoutSession({ data })`.

Two different Supabase clients are used, and picking the right one matters:
- `getSupabaseServerClient()` (`src/lib/supabase.server.ts`) — cookie-based, respects RLS as the calling user. Used for normal reads/writes and for `auth.getUser()` checks.
- `createClient(url, SUPABASE_SERVICE_ROLE_KEY)` — bypasses RLS. Used only for privileged server-to-server operations: the Stripe webhook, `confirmBooking`/`cancelBooking`, and cleanup of stale pending bookings in `getUserBookings`. Never expose the service role key to the client.

### Booking / payment flow

- Pickup location is chosen on the car page via `PickupLocationPicker` and modelled as the `PickupSelection` union in `src/lib/pickup.ts` (home base / a listed location / a custom delivery address). Listed locations are free; delivery is a flat `DELIVERY_FEE` and only allowed within `DELIVERY_RADIUS_MILES` of `HOME_BASE`. The selection travels to checkout as structured search params (`pickupKind`/`pickupId`/`pickupAddress`/…) alongside the human-readable `pickupLocation` string — the string is display-only, and `createCheckoutSession` re-resolves the selection server-side (re-geocoding delivery addresses via `src/lib/geocode.ts`) to recompute the fee and the stored `pickup_location`.
- **Anyone can price a trip and press Continue.** The car page's booking widget (`src/routes/fleet/$carSlug.tsx`) shows whether or not you're signed in; sign-in happens at checkout through `_authed`.
- **Signing in at checkout relies on a remount.** `CheckoutPage` is a thin wrapper that renders `<CheckoutFlow key={profile?.id ?? 'signed-out'} />`. **Don't remove the key.** After a login or sign-up on that page, `router.invalidate()` flips `_authed`'s context to logged-in *before* the checkout loader re-runs. `CheckoutFlow` therefore first mounts on the signed-out load's data (`profile: null`), and its starting step, `currentProfile` and the driver form are all seeded once from that. Without the key they stayed null for good: ID-verified customers were sent back to step 1 with a blank form, and new sign-ups had to retype their email. (The profile row itself, with the email filled in, is created by the `handle_new_user` trigger.) Any other `_authed` child that seeds `useState` from loader data has the same problem.
- **Trip times start empty.** `startTime`/`endTime` are `""` ("Select Time") until the customer picks one, and everything that prices or validates the trip waits on `tripComplete` (both dates and both times set). `timeToMinutes("")` returns 0 (midnight) rather than failing, so an unguarded empty time silently disables slots or skews pricing. If a date change makes a chosen time unavailable, the time is cleared, never snapped to another slot: every time must be one the customer chose.
- **Choosing a start time opens the end-time dropdown**, the same hand-off as the date calendars. `TimeDropdown` is controlled for this (`isOpen`/`onOpenChange`, with one `openTime` state in the page). It centres the selected option by setting `scrollTop` on its own list. Don't use `scrollIntoView` there: it also scrolls the window and made the page jump.
- `createCheckoutSession` creates a Stripe `PaymentIntent` and a `bookings` row with `status: 'pending'`, reusing an existing pending booking/intent if one already matches (car, user, time range) to avoid duplicates on retry.
- **Every payment method must settle inside `PENDING_HOLD_MS`.** `PAYMENT_METHOD_TYPES` in `db.ts` names them explicitly (`card`, or "other" = Cash App / Affirm / Klarna / Amazon Pay) rather than letting Stripe's automatic payment methods decide. `us_bank_account` (ACH) was removed and must not come back without first changing how a booking holds a car: ACH sits in `processing` for ~4 business days, so the 1-hour hold lapses, the sweep marks the row `expired`, someone else books those dates, and when the debit finally clears the webhook's `payment_intent.succeeded` — which matches on `stripe_payment_intent_id` with no status filter — revives the expired row to `confirmed`. Two paid bookings, one car. (Reviving `expired` rows is correct for a late *card* payment; see below.) ACH can also bounce after the guest has driven off. Anything enabled in the Stripe dashboard is irrelevant unless it is also in that list — but an unenabled or ineligible type there makes the whole PaymentIntent fail to create.
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

`getUserBookings` filters on the stored status only, so it is the one surface that *doesn't* apply the read-time cutoff: between a hold lapsing and the hourly sweep running, My Bookings still lists an abandoned checkout under "Pending Checkouts". Harmless — the car isn't held — but it looks like a bug when you hit the window. Filtering `pending` rows older than `PENDING_HOLD_MS` there would make the page independent of the cron schedule, like everything else.

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
- **Check phone layouts against a real iPhone, or a short viewport like 390×664.** Devtools' default phone heights leave out Safari's toolbars, and the cramped homepage calendar only ever showed up on the real device.
- **The search bar has no location field.** Every car serves the same Twin Cities pickup spots, and the real pickup choice is `PickupLocationPicker` on the car page. `/fleet`'s search params are just `start`/`end`.
- **`TripCalendar` is a bottom sheet on phones** (below Tailwind's `sm`, 639px, checked with `matchMedia` when it opens) and an anchored popover from `sm` up. The sheet is portalled to `<body>`, locks page scroll while open and closes on a backdrop tap. The larger day cells in `tripCalendarClassNames` switch at the same `sm` breakpoint, so they only ever appear inside the sheet. Every caller gets this for free, including the car page's start/end calendars.
- **Car page below `lg`** (Turo-style):
  - **Order:** the photo comes first and runs edge to edge, then the title and spec chips, then "Your trip" (`order-first` on the widget column), then features and reviews. Desktop keeps its original layout.
  - **Main photo:** takes `aspect-[5/3]`, because every main photo is 1242×745. A fixed height on a narrow screen cropped the sides off each car.
  - **Bottom bar:** a sticky bar carries the total and a single button that walks through "Select dates", "Select times", then "Continue". It's `sticky`, not `fixed`, so it settles above the site footer instead of covering it.
- **`PhotoGallery`** (`src/components/PhotoGallery.tsx`) opens *on top of* the car page rather than replacing it, so closing it keeps the scroll position. Tapping a photo opens a lightbox (arrow buttons, arrow keys, swipe), and Esc backs out one layer at a time: lightbox, then grid, then the page.
- `src/components/admin/*` are admin-shell-only components (sidebar, calendar grid/toolbar, trip cards); everything else under `src/components/` is used by the public-facing site.

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
(apex, no `www`). **Subscribe to all ten events the handler implements** — subscribing to
fewer doesn't error, it silently disables that code path (miss `charge.refunded` and
cancellations never record a refund):

```
payment_intent.succeeded   payment_intent.payment_failed   payment_intent.canceled
charge.succeeded           charge.refunded                 charge.refund.updated
refund.failed
identity.verification_session.{verified,requires_input,canceled}
```

New destinations can't choose an API version in the UI; they use the account's current one
(`2026-03-25.dahlia`). That is fine — the handler only reads ids, statuses, amounts and
metadata, all stable since 2023-10-16, and the installed Stripe SDK (v21) is *built* for
dahlia, so the payloads match the types `tsc` checks against. Note `db.ts` and
`stripe-webhook.ts` both still pin `apiVersion: '2023-10-16'` with a comment claiming it
matches the account; it doesn't, and removing both pins is a wanted cleanup.

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

`CRON_SECRET` authenticates the scheduled Turo sync endpoint, and must match the `turo_sync_cron_secret` Vault secret. If it's unset the endpoint refuses every request with a 500 rather than running unauthenticated.

`GMAIL_REFRESH_TOKEN` must carry **both** `gmail.readonly` (for `syncTuroBookings`) and `gmail.send` (for the admin booking email in `src/lib/email.ts`). `scripts/gmail-refresh-token.mjs` requests both; a token minted before that script gained the `send` scope fails with "insufficient authentication scopes" and has to be re-minted.

`ADMIN_NOTIFICATION_EMAIL` is who the booking-confirmed email goes to, and `SITE_URL` is only used to build the "View reservation" link inside it. Both are server-side only (no `VITE_` prefix, same as `MAPBOX_TOKEN`) and both have code defaults, so a missing one degrades rather than throws.

`MAPBOX_TOKEN` needs the Geocoding scope and is intentionally **not** `VITE_`-prefixed — it's read only in `src/lib/geocode.ts`, which runs server-side, so the token never reaches the client bundle. Without it, delivery address search returns an empty list and the delivery pickup option is effectively disabled; every other pickup option still works.
