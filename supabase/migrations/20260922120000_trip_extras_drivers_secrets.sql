-- Pre-launch trip features: guest welcome email, per-car lockbox codes, and
-- additional drivers on a booking.

begin;

-- ── Guest welcome email claim ────────────────────────────────────────────────
-- Same mechanism and same reasoning as admin_notified_at
-- (20260821190000_bookings_admin_notified_at.sql): three separate paths flip a
-- booking to confirmed and Stripe retries webhooks, so "has this been sent?"
-- has to be decided by the database, not by whichever code path got there.
-- Nullable, no default, no backfill — existing bookings were never owed this
-- email and must not receive one retroactively.
alter table public.bookings
    add column if not exists guest_notified_at timestamp with time zone;

comment on column public.bookings.guest_notified_at is
    'Claim held by whichever confirmation path is sending the guest welcome email. Null means unsent, or a send failed and released it.';


-- ── Per-car lockbox codes ────────────────────────────────────────────────────
-- Deliberately NOT a column on public.cars. That table has
-- "Public cars are viewable by everyone" (using true) plus GRANT ALL to anon,
-- and the anon key ships in the client bundle — so a lockbox_code column there
-- is every car's door code published to anyone who types the REST URL.
--
-- A column-level REVOKE does not fix that: in Postgres a table-level SELECT
-- grant is not narrowed by a column revoke, so the only in-place fix is
-- revoking table SELECT and re-granting an explicit column list, which then
-- re-leaks silently the next time someone adds a column.
--
-- No policies at all here, so RLS denies anon and authenticated outright. Every
-- read goes through a server function that has already authorized the caller —
-- the same posture public.reviews uses for writes.
--
-- Keyed per car even though every car currently shares one code: moving to real
-- per-car codes is then just different rows, and rotating a code after each
-- trip is an update rather than a schema change.
create table if not exists public.car_secrets (
    car_id       bigint primary key references public.cars(id) on delete cascade,
    lockbox_code text,
    updated_at   timestamp with time zone not null default now()
);

alter table public.car_secrets enable row level security;
revoke all on public.car_secrets from anon, authenticated;
grant all on public.car_secrets to service_role;

comment on table public.car_secrets is
    'Service-role-only access details for a car. Never exposed to anon or authenticated; read only by server functions that have authorized the caller.';


-- ── Additional drivers on a booking ──────────────────────────────────────────
-- Same write posture as public.reviews: no insert/update/delete policies at
-- all, so every write goes through a server function using the service-role
-- client after its own access check.
--
-- The cascade is on the driver row. Deleting a booking clears its drivers; a
-- driver never reaches back toward the booking.
create table if not exists public.booking_additional_drivers (
    id            uuid primary key default gen_random_uuid(),
    booking_id    uuid not null references public.bookings(id) on delete cascade,
    full_name     text not null,
    email         text not null,
    date_of_birth date not null,
    created_at    timestamp with time zone not null default now(),
    created_by    uuid references public.profiles(id) on delete set null
);

-- One person per trip, however they capitalized their address.
create unique index if not exists booking_additional_drivers_email_idx
    on public.booking_additional_drivers (booking_id, lower(email));

create index if not exists booking_additional_drivers_booking_idx
    on public.booking_additional_drivers (booking_id);

alter table public.booking_additional_drivers enable row level security;
revoke all on public.booking_additional_drivers from anon, authenticated;
grant all on public.booking_additional_drivers to service_role;

commit;
