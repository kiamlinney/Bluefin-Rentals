# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

BlueFin Rentals — a self-hosted car rental platform migrating BlueFin Rentals LLC off Turo to cut commission fees. React 19 + TypeScript + TanStack Start (full-stack, SSR) + Tailwind CSS v4, with Supabase (Postgres + Auth) and Stripe (payments + identity verification).

## Commands

```bash
npm run dev     # vite dev — TanStack Start dev server
npm run build   # vite build — outputs to .output/
npm run start   # node .output/server/index.mjs — run the production build
npx tsc --noEmit   # type-check (no dedicated script in package.json)
```

There is no test suite in this repo. `eslint.config.js` exists but `eslint` is not installed (missing from `package.json`/`node_modules`), so linting is currently non-functional — don't rely on `npm run lint`.

## Architecture

### TanStack Start structure

- `src/router.tsx` builds the router from the auto-generated `src/routeTree.gen.ts`. **Never hand-edit `routeTree.gen.ts`** — it's regenerated from the `src/routes/` file tree.
- `src/ssr.tsx` is the server entry (`createStartHandler`); `src/client.tsx` hydrates on the client.
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

- `createCheckoutSession` creates a Stripe `PaymentIntent` and a `bookings` row with `status: 'pending'`, reusing an existing pending booking/intent if one already matches (car, user, time range) to avoid duplicates on retry.
- `src/routes/api/stripe-webhook.ts` is the source of truth for confirming payment: it verifies the Stripe signature against the **raw request body** (must call `request.text()` before any JSON parsing) and flips bookings to `confirmed` on `payment_intent.succeeded` / `charge.succeeded` (handled as a backup path since event ordering isn't guaranteed). `confirmBooking` in `db.ts` is a client-driven fallback that checks the PaymentIntent status directly.
- Stripe Identity (`createIdentitySession` / `finalizeIdentitySession`) handles driver's license verification separately from payment, storing `stripe_identity_session_id` on `profiles` and flipping `identity_verified` via webhook or finalize call.

### Turo email sync (`syncTuroBookings` in `db.ts`)

Admin-only server function that reads Gmail via the `googleapis` OAuth2 client (refresh token in env) to find Turo booking-confirmation emails, regex-parses trip dates/car/renter/reservation ID out of the plain-text MIME body, and inserts into `turo_bookings`. Matching against `cars` is done by year + make substring match on the parsed car string. This is a bridge during the Turo migration, not a general-purpose email integration — treat the parsing regexes as fragile/format-specific if Turo changes their email template.

### Types

- `src/lib/database.types.ts` is generated from the Supabase schema; `src/types.ts` re-exports row types from it (`Car`, `Booking`, `Profile`, `CarPriceOverride`, `CarBlockedDate`). Regenerate `database.types.ts` from Supabase after any schema change rather than hand-editing it.
- The `supabase/` directory only contains `.temp/linked-project.json` (CLI link metadata) — there are no tracked local migrations in this repo; schema changes happen against the linked Supabase project directly.

### Imports & UI conventions

- `tsconfig.json` defines `@/*` → `./src/*`, but the codebase is inconsistent: some files use `@/components/...` and others use relative or bare `src/components/...` imports for the same modules. Match whatever the surrounding file already does rather than "fixing" it.
- UI components follow shadcn/ui (`components.json`: "new-york" style, zinc base, Tailwind v4, Lucide icons). `src/lib/utils.ts` exports the standard `cn()` (clsx + tailwind-merge) helper used throughout for conditional classNames.
- `src/components/admin/*` are admin-shell-only components (sidebar, calendar grid/toolbar, trip cards); everything else under `src/components/` is used by the public-facing site.

## Environment variables

Required in `.env` (see `.env` locally, never commit real values): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`.
