-- Abandoned checkouts: reap them on a schedule instead of opportunistically.
--
-- A `pending` booking is a soft hold created when someone reaches the payment
-- step. Until now the only cleanup was a delete inside getUserBookings, scoped
-- to one user and running only when that user happened to load their trips, so
-- rows from every other account accumulated forever.
--
-- Two decisions worth recording, because both are load-bearing:
--
-- 1. These rows are MARKED, never deleted. The Stripe webhook confirms a
--    payment by matching on stripe_payment_intent_id alone, with no status
--    filter. Deleting the row leaves its PaymentIntent live and payable, so a
--    customer who leaves the checkout tab open past the hour and then pays
--    would be charged against a booking that no longer exists: the webhook
--    matches nothing, returns 500, Stripe retries for ~3 days and gives up.
--    Money captured, no booking, no admin email. Keeping the row means that
--    same late payment instead flips it to `confirmed` and notifies the admin.
--
-- 2. `expired` rather than `canceled`. A trip the customer called off and a
--    checkout they wandered away from are different events; conflating them
--    fills a customer's trip history with abandoned tabs and makes the two
--    indistinguishable in reporting.
--
-- Note this job is hygiene, not enforcement. assertCarIsAvailable and
-- getBookedDates in src/lib/db.ts both compute the 60-minute cutoff at read
-- time (PENDING_HOLD_MS), so a stale row stops holding the car whether or not
-- this has run yet. Nothing about availability depends on the schedule.

alter type "public"."booking_status" add value if not exists 'expired';

-- The interval mirrors PENDING_HOLD_MS in src/lib/db.ts. They describe the same
-- rule from two sides — if one moves, move the other.
create or replace function "public"."expire_stale_pending_bookings"() returns void
    language plpgsql security definer
    as $$
begin
  -- Same replica-mode guard as auto_complete_bookings: a status change made by
  -- housekeeping shouldn't fire the triggers a real booking transition does.
  set local session_replication_role = 'replica';

  update public.bookings
  set status = 'expired'
  where status = 'pending'
    and created_at < now() - interval '1 hour';

  reset session_replication_role;
end;
$$;

alter function "public"."expire_stale_pending_bookings"() owner to "postgres";

grant all on function "public"."expire_stale_pending_bookings"() to "service_role";
