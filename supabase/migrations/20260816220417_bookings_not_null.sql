-- Tighten nullability on public.bookings.
--
-- These four columns were nullable by omission, not by design: the app's single
-- insert path (createCheckoutSession in src/lib/db.ts) writes all four on every
-- booking, and an audit of all 29 existing rows found zero NULLs in any of them.
--
-- `status` is the one that matters most. It is nullable with a DEFAULT of
-- 'pending', which means a row could exist with a NULL status — and a NULL status
-- is invisible to every `.eq('status', ...)` filter in the app, including the
-- availability check in assertCarIsAvailable. That is a booking the system cannot
-- see when deciding whether a car is free, i.e. a double-booking.
--
-- Deliberately NOT included:
--   stripe_payment_intent_id — 2 completed trips from June 2026 have no intent id.
--     They were entered by hand for off-platform (Turo/direct) trips that never
--     touched Stripe. That is a legitimate ongoing case, so the column stays
--     nullable and the application guards it instead.
--   miles_driven — only populated after a trip is finished; NULL on all 29 rows
--     today, including the 24 completed ones.

alter table public.bookings
  alter column status          set not null,
  alter column created_at      set not null,
  alter column updated_at      set not null,
  alter column pickup_location set not null;