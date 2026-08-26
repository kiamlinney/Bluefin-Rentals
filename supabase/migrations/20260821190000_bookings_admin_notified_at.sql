-- Adds the column that makes the admin "trip is booked" email exactly-once.
--
-- Three code paths independently flip a booking to 'confirmed', and that is on
-- purpose: the Stripe webhook handles both payment_intent.succeeded and
-- charge.succeeded because Stripe does not guarantee which arrives first, and
-- confirmBooking() is a client-driven fallback that checks the PaymentIntent
-- directly. Stripe also retries a webhook it did not get a 2xx for. So "have we
-- already emailed the owners about this booking?" cannot live in the process —
-- an in-memory guard resets on deploy and does not span instances — and it
-- cannot be inferred from status, which every one of those paths sets to the
-- same value.
--
-- This column is a CLAIM, not a log. The sender takes it with a conditional
-- update:
--
--   update bookings set admin_notified_at = now()
--   where id = $1 and status = 'confirmed' and admin_notified_at is null
--
-- Postgres serializes the concurrent writers, so exactly one of them gets a row
-- back and owns the send; the losers get zero rows and return without sending.
-- If the send then fails, the sender sets the column back to null so a later
-- path can retry — which is why this is nullable with no default.
--
-- No backfill. Bookings confirmed before this migration stay null and are never
-- notified about retroactively; the alternative would email the owners about
-- every trip already in the table the first time one of them opens a page that
-- calls confirmBooking.

alter table public.bookings
    add column if not exists admin_notified_at timestamp with time zone;

comment on column public.bookings.admin_notified_at is
    'Claim held by whichever confirmation path is sending the admin notification email. Null means unsent (or a send failed and released it).';