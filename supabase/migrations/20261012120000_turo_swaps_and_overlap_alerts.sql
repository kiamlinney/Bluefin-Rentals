-- Turo vehicle swaps, and alerts for trips that overlap on the same car.
--
-- 1. turo_bookings.swap_accepted_at / swap_car_confirmed_at
--
--    Turo's "X accepted your vehicle swap request" email (Notification-Name
--    VehicleSwapAccepted) names the reservation but not the replacement car, so
--    the sync can only flag the trip; an owner picks the car on /admin/calendar.
--    swap_accepted_at is when Turo sent that email; swap_car_confirmed_at is when
--    the car was settled (picked by an owner, or named by a later Turo email). A
--    swap is pending while accepted and not confirmed since. Two timestamps rather
--    than a boolean so that a catch-up sync re-reading an old swap email can't
--    re-open a swap that was already resolved.
--
-- 2. schedule_overlap_alerts
--
--    One row per pair of trips that overlap on the same car, claimed before the
--    owners are emailed about it, so each overlap is emailed once however many
--    sync runs see it. pair_key is "booking:<id>|turo:<id>" (sorted), built by
--    findScheduleOverlaps in src/lib/schedule-overlaps.ts. No foreign keys, on
--    purpose: a pair names rows in two different tables, and an FK to bookings
--    would be one more thing blocking a booking delete. Same write posture as
--    booking_vehicle_swaps: RLS on, no policies, service role only.
--
-- Additive only: the deployed code ignores both. Run in the SQL editor, before
-- or after deploying. Safe to run twice. Then run the check at the bottom.

begin;

alter table public.turo_bookings
    add column if not exists swap_accepted_at      timestamptz,
    add column if not exists swap_car_confirmed_at timestamptz;

create table if not exists public.schedule_overlap_alerts (
    pair_key    text primary key,
    car_id      bigint not null,
    notified_at timestamptz not null default now()
);

alter table public.schedule_overlap_alerts enable row level security;

revoke all on public.schedule_overlap_alerts from anon, authenticated;
grant all on public.schedule_overlap_alerts to service_role;

commit;

-- ── Check (changes nothing) ─────────────────────────────────────────────────
-- Expect: two rows for the columns, rls_enabled = true, and no privileges for
-- anon or authenticated.
--
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'turo_bookings'
--    and column_name in ('swap_accepted_at', 'swap_car_confirmed_at');
--
-- select relrowsecurity as rls_enabled from pg_class
--  where oid = 'public.schedule_overlap_alerts'::regclass;
--
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name = 'schedule_overlap_alerts' and grantee in ('anon', 'authenticated');
