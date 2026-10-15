-- The Vehicles admin pages and automatic pricing rules.
--
-- 1. car_secrets.vin
--
--    Each car's VIN, typed in once by an owner from Turo. On car_secrets rather
--    than cars because cars is readable by anon (a SELECT policy of `true` plus
--    GRANT ALL), so a column there would publish every car's VIN next to its
--    plate. car_secrets is service-role only.
--
-- 2. admin_changes
--
--    Who changed what, and when: a car's listing, base price, mileage fee,
--    lockbox code or VIN (car_id set), or the fleet-wide pricing rules (car_id
--    null). A lockbox change is recorded without the code. car_id has no
--    foreign key on purpose, the same as booking_vehicle_swaps: the log must
--    not stop a car from being deleted, and it must outlive one. changed_by is
--    a plain uuid for the same reason.
--
-- 3. pricing_settings
--
--    One row (id is always true): the busy, slow and weekend multipliers and
--    which weekdays count as the weekend (0 = Sunday ... 6 = Saturday). A day's
--    price is round(base x period multiplier x weekend multiplier) unless the
--    owners typed a price for that date on the calendar, which wins outright
--    (src/lib/pricing.ts#dailyPrice). Seeded with Liam's starting values: busy
--    1.40, slow 0.85, weekend 1.10 on Friday, Saturday and Sunday.
--
--    The 0.5 to 3.0 bounds guard against typos (1.4 typed as 14), not prices.
--
-- 4. pricing_periods
--
--    The busy and slow date ranges, inclusive at both ends. The exclusion
--    constraint stops any two periods overlapping, busy and slow alike, so a
--    date is never in two and no rule is needed for which one wins. Range types
--    have a built-in GiST operator class, so this needs no extension.
--
-- All four are RLS on, no policies, granted to the service role only. Prices
-- are read through a server function (src/lib/pricing-rules.ts) because every
-- visitor's quote needs them; writes go through admin-only functions.
--
-- WHEN THIS RUNS, WEEKEND PRICES GO UP 10% as soon as the code that reads it is
-- deployed. Busy and slow change nothing until an owner adds a period.
--
-- Run it in the SQL editor before deploying the code that uses it (the
-- Vehicles pages and every quote read these tables). Then run the check at the
-- bottom, then regenerate src/lib/database.types.ts. Safe to run twice.

begin;

-- 1 ──────────────────────────────────────────────────────────────────────────
alter table public.car_secrets add column if not exists vin text;

-- 2 ──────────────────────────────────────────────────────────────────────────
create table if not exists public.admin_changes (
    id          uuid primary key default gen_random_uuid(),
    car_id      bigint,
    field       text not null,
    old_value   text,
    new_value   text,
    changed_by  uuid,
    created_at  timestamp with time zone not null default now()
);
create index if not exists admin_changes_car_id_created_at_idx
    on public.admin_changes (car_id, created_at desc);

-- 3 ──────────────────────────────────────────────────────────────────────────
create table if not exists public.pricing_settings (
    id                  boolean primary key default true check (id),
    busy_multiplier     numeric(4, 2) not null default 1.40 check (busy_multiplier between 0.5 and 3),
    slow_multiplier     numeric(4, 2) not null default 0.85 check (slow_multiplier between 0.5 and 3),
    weekend_multiplier  numeric(4, 2) not null default 1.10 check (weekend_multiplier between 0.5 and 3),
    weekend_days        smallint[] not null default '{5,6,0}'
                        check (weekend_days <@ '{0,1,2,3,4,5,6}'::smallint[]),
    updated_at          timestamp with time zone not null default now(),
    updated_by          uuid
);
insert into public.pricing_settings (id) values (true) on conflict (id) do nothing;

-- 4 ──────────────────────────────────────────────────────────────────────────
create table if not exists public.pricing_periods (
    id          uuid primary key default gen_random_uuid(),
    kind        text not null check (kind in ('busy', 'slow')),
    label       text not null check (char_length(label) between 1 and 80),
    start_date  date not null,
    end_date    date not null,
    created_by  uuid,
    created_at  timestamp with time zone not null default now(),
    constraint pricing_periods_dates_chk check (end_date >= start_date),
    constraint pricing_periods_no_overlap
        exclude using gist (daterange(start_date, end_date, '[]') with &&)
);

-- Access ─────────────────────────────────────────────────────────────────────
alter table public.admin_changes    enable row level security;
alter table public.pricing_settings enable row level security;
alter table public.pricing_periods  enable row level security;

revoke all on public.admin_changes    from anon, authenticated;
revoke all on public.pricing_settings from anon, authenticated;
revoke all on public.pricing_periods  from anon, authenticated;

grant all on public.admin_changes    to service_role;
grant all on public.pricing_settings to service_role;
grant all on public.pricing_periods  to service_role;

commit;

-- ── Check (changes nothing) ─────────────────────────────────────────────────
-- Run this after the script above, in the same or a new run. Every row should
-- end in "OK". The overlap check inserts two test periods in the year 2099 and
-- removes them again whatever happens.
--
-- create or replace function pg_temp.bluefin_overlap_check() returns text
-- language plpgsql as $$
-- begin
--   insert into public.pricing_periods (kind, label, start_date, end_date)
--     values ('busy', '__check a', '2099-01-01', '2099-01-05');
--   begin
--     insert into public.pricing_periods (kind, label, start_date, end_date)
--       values ('slow', '__check b', '2099-01-05', '2099-01-07');
--     delete from public.pricing_periods where label like '\_\_check %';
--     return 'overlapping periods refused: FAILED, an overlap was accepted';
--   exception when exclusion_violation then
--     delete from public.pricing_periods where label like '\_\_check %';
--     return 'overlapping periods refused: OK';
--   end;
-- end $$;
--
-- select 'car_secrets.vin: ' || case when exists (
--          select 1 from information_schema.columns
--          where table_schema = 'public' and table_name = 'car_secrets' and column_name = 'vin')
--        then 'OK' else 'MISSING' end
-- union all
-- select 'RLS on all three tables: ' || case when (
--          select count(*) from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity
--          and relname in ('admin_changes', 'pricing_settings', 'pricing_periods')) = 3
--        then 'OK' else 'FAILED' end
-- union all
-- select 'no anon/authenticated grants: ' || case when (
--          select count(*) from information_schema.role_table_grants
--          where table_name in ('admin_changes', 'pricing_settings', 'pricing_periods')
--          and grantee in ('anon', 'authenticated')) = 0
--        then 'OK' else 'FAILED' end
-- union all
-- select 'no policies: ' || case when (
--          select count(*) from pg_policies
--          where tablename in ('admin_changes', 'pricing_settings', 'pricing_periods')) = 0
--        then 'OK' else 'FAILED' end
-- union all
-- select 'pricing settings seeded (1.40 / 0.85 / 1.10, Fri-Sat-Sun): ' || case when exists (
--          select 1 from public.pricing_settings
--          where busy_multiplier = 1.40 and slow_multiplier = 0.85 and weekend_multiplier = 1.10
--          and weekend_days @> '{5,6,0}' and weekend_days <@ '{5,6,0}')
--        then 'OK' else 'DIFFERENT (fine if an owner has since changed them)' end
-- union all
-- select pg_temp.bluefin_overlap_check();
