-- Pre-launch hardening, 2026-10-07. ImportantFiles/pre-launch-audit.md.
--
-- Run this in the Supabase SQL editor BEFORE deploying the code from the same
-- change: that code writes canceled_by = 'system' and moves expired checkouts to
-- canceled, which the old constraint and trigger refuse. Every statement is safe
-- with the currently deployed code too, so running it early is fine.
--
-- Idempotent: safe to run twice.

begin;

-- ── 1. A refunded trip can never be confirmed again ─────────────────────────
-- The status trigger allowed canceled -> confirmed outright. That transition
-- exists for one reason: cancelBooking releasing its claim when the refund
-- fails, before any money has moved. It was also the door every "revive a
-- refunded trip" bug walked through (a second cancel, confirmBooking called
-- after a refund). Now it's allowed only while no refund has been recorded.
--
-- expired/failed -> canceled is new: a payment that arrives after its hold
-- lapsed, for dates booked by someone else meanwhile, is refunded and the row
-- marked canceled by 'system' (confirmPaidCheckout in payments.server.ts).
create or replace function public.bookings_guard_status()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claims', true)::json->>'role', '');
  is_service boolean := jwt_role = 'service_role';
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending'::booking_status and not is_service then
      raise exception 'New bookings must start as pending';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not is_service then
      raise exception 'status is server-managed and cannot be changed by this role';
    end if;

    if not (
      (old.status = 'pending'   and new.status in ('confirmed', 'expired', 'canceled', 'failed')) or
      (old.status = 'expired'   and new.status in ('confirmed', 'canceled')) or
      (old.status = 'failed'    and new.status in ('confirmed', 'canceled')) or
      (old.status = 'confirmed' and new.status in ('canceled', 'completed')) or
      (old.status = 'canceled'  and new.status = 'confirmed'
                                and old.refund_id is null and new.refund_id is null)
    ) then
      raise exception 'Illegal status transition: % -> %', old.status, new.status;
    end if;
  end if;

  return new;
end;
$function$;

-- ── 2. Who cancelled: add 'system' ──────────────────────────────────────────
alter table public.bookings drop constraint if exists bookings_canceled_by_chk;
alter table public.bookings add constraint bookings_canceled_by_chk
  check (canceled_by is null or canceled_by in ('guest', 'admin', 'system'));

-- ── 3. Nobody can make themselves an admin ──────────────────────────────────
-- The guard trigger protected identity and payment columns but not is_admin.
-- The only thing stopping a guest from setting their own is_admin was the
-- update policy below, whose subquery compares `p.id = p.id` (always true) and
-- only worked because RLS happened to narrow it to the caller's own row.
-- Both are fixed: the trigger now guards is_admin, and the policy says what it
-- means.
create or replace function public.profiles_guard_server_columns()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claims', true)::json->>'role', '');
begin
  if jwt_role = 'service_role' or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- nullif: these columns default to '' (see 20261008120000_fix_signup.sql;
    -- without it every sign-up was refused).
    if coalesce(new.is_admin, false)
       or coalesce(new.identity_verified, false)
       or new.identity_verified_at is not null
       or nullif(new.stripe_identity_session_id, '') is not null
       or nullif(new.stripe_customer_id, '') is not null then
      raise exception 'admin, identity and payment fields are server-managed';
    end if;
    return new;
  end if;

  if new.is_admin                   is distinct from old.is_admin
     or new.identity_verified       is distinct from old.identity_verified
     or new.identity_verified_at    is distinct from old.identity_verified_at
     or new.stripe_identity_session_id is distinct from old.stripe_identity_session_id
     or new.stripe_customer_id      is distinct from old.stripe_customer_id then
    raise exception 'admin, identity and payment fields are server-managed';
  end if;

  return new;
end;
$function$;

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and is_admin is not distinct from (select p.is_admin from public.profiles p where p.id = auth.uid())
  );

-- ── 4. The hourly jobs leave a trip open while an extension request waits ───
-- auto_complete_bookings closed a trip at its end even with a last-hour
-- extension request unanswered, and an approval after that took the guest's
-- money without moving the end (the code now refuses that approval). Trips
-- with an open request stay confirmed for up to 48 hours past their end, so
-- the owners can still answer; after that they close as before.
create or replace function public.auto_complete_bookings()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  set local session_replication_role = 'replica';

  update public.bookings b
  set status = 'completed'
  where b.status = 'confirmed'
    and b.end_time < now()
    and (
      b.end_time < now() - interval '48 hours'
      or not exists (
        select 1 from public.booking_extensions e
        where e.booking_id = b.id and e.status in ('pending', 'requested')
      )
    );

  reset session_replication_role;
end;
$function$;

-- Same body as before; only the pinned search_path is new.
create or replace function public.expire_stale_pending_bookings()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  set local session_replication_role = 'replica';

  update public.bookings
  set status = 'expired'
  where status = 'pending'
    and created_at < now() - interval '1 hour';

  reset session_replication_role;
end;
$function$;

alter function public.get_car_unavailability(bigint) set search_path = public;

-- ── 5. Internal functions are not part of the public API ────────────────────
-- Supabase grants EXECUTE on every function to anon and authenticated, which
-- put these on /rest/v1/rpc for anyone. pg_cron runs the jobs as the owner, and
-- triggers don't need EXECUTE at fire time, so nothing legitimate changes.
-- is_admin, can_access_trip_media and get_car_unavailability stay callable:
-- RLS policies and the public calendar use them.
revoke execute on function public.auto_complete_bookings()        from public, anon, authenticated;
revoke execute on function public.expire_stale_pending_bookings() from public, anon, authenticated;
revoke execute on function public.bookings_guard_status()         from public, anon, authenticated;
revoke execute on function public.profiles_guard_server_columns() from public, anon, authenticated;
revoke execute on function public.handle_new_user()               from public, anon, authenticated;
revoke execute on function public.handle_user_updated()           from public, anon, authenticated;
-- Revoking from PUBLIC also took these from the role Supabase Auth runs as.
grant execute on function public.handle_new_user()     to supabase_auth_admin;
grant execute on function public.handle_user_updated() to supabase_auth_admin;

commit;
