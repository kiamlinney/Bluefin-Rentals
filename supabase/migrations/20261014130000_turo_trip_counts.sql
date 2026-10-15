-- Each car's Turo trip count, so the Vehicles pages can show lifetime trips
-- (Turo + Bluefin).
--
-- An owner enters the count shown on the car's Turo listing once, together
-- with the moment they entered it. From then on the site adds every Turo trip
-- the email sync sees end after that moment, plus every completed Bluefin trip
-- (src/lib/fleet-view.ts#tripCount). Until a car has a count it shows Bluefin
-- trips only.
--
-- On cars rather than car_secrets: the count is public on Turo anyway, so
-- there's nothing to hide. Both columns are set together or not at all (the
-- check below), because a count without its date can't be added to.
--
-- Additive: the deployed code ignores both columns. Safe to run twice.

begin;

alter table public.cars add column if not exists turo_trip_count integer;
alter table public.cars add column if not exists turo_trip_count_at timestamp with time zone;

do $$
begin
    alter table public.cars add constraint cars_turo_trip_count_chk
        check (turo_trip_count is null or turo_trip_count >= 0);
exception when duplicate_object then null;
end $$;

do $$
begin
    alter table public.cars add constraint cars_turo_trip_count_pair_chk
        check ((turo_trip_count is null) = (turo_trip_count_at is null));
exception when duplicate_object then null;
end $$;

commit;

-- ── Check (changes nothing) ─────────────────────────────────────────────────
-- Expect both rows to end in "OK".
--
-- select 'columns: ' || case when (select count(*) from information_schema.columns
--          where table_schema = 'public' and table_name = 'cars'
--          and column_name in ('turo_trip_count', 'turo_trip_count_at')) = 2
--        then 'OK' else 'MISSING' end
-- union all
-- select 'constraints: ' || case when (select count(*) from pg_constraint
--          where conname in ('cars_turo_trip_count_chk', 'cars_turo_trip_count_pair_chk')) = 2
--        then 'OK' else 'MISSING' end;

-- ── Entering the counts ─────────────────────────────────────────────────────
-- One line per car, with the number Turo shows on the listing right now.
-- now() is the moment the count was true. Run it all at once; the commit is
-- at the end.
--
-- begin;
-- update public.cars set turo_trip_count = TURO_COUNT, turo_trip_count_at = now() where id = 1;   -- Honda Civic 2013
-- update public.cars set turo_trip_count = TURO_COUNT, turo_trip_count_at = now() where id = 3;   -- Ford Fusion 2015
-- update public.cars set turo_trip_count = TURO_COUNT, turo_trip_count_at = now() where id = 4;   -- Ford Fusion Hybrid 2012
-- update public.cars set turo_trip_count = TURO_COUNT, turo_trip_count_at = now() where id = 5;   -- Jeep Cherokee 2018
-- update public.cars set turo_trip_count = TURO_COUNT, turo_trip_count_at = now() where id = 7;   -- Toyota Camry 2016
-- update public.cars set turo_trip_count = TURO_COUNT, turo_trip_count_at = now() where id = 8;   -- Toyota Prius 2014
-- update public.cars set turo_trip_count = TURO_COUNT, turo_trip_count_at = now() where id = 9;   -- Honda CR-V 2017
-- update public.cars set turo_trip_count = TURO_COUNT, turo_trip_count_at = now() where id = 10;  -- Subaru Outback 2018
-- update public.cars set turo_trip_count = TURO_COUNT, turo_trip_count_at = now() where id = 11;  -- Toyota Corolla 2015
-- commit;
--
-- If a car is on a Turo trip when you enter its count, compare with Turo the
-- day after that trip ends: the two should agree. If Turo had already counted
-- the trip in progress, lower that car's count by one.
