-- An owner moving a booked trip onto another car before it starts.
--
-- One row per swap, the history the reservation page shows and the reason the
-- guest was emailed. bookings.car_id is what actually moves; this table is the
-- record of it. The first row's from_car_id is the car the trip was quoted on,
-- which is where the per-mile overage rate keeps coming from (buildReceipt).
--
-- from_car_id / to_car_id are plain bigints with NO foreign key to cars, and
-- swapped_by is a plain uuid with none to profiles. A table with FKs to both
-- bookings and cars can make every cars(...) embed from bookings ambiguous
-- (PostgREST PGRST201) — the same trap the deposit_waived_by FK fell into.
--
-- Same write posture as booking_charges: RLS on, no policies, service role only.

create table public.booking_vehicle_swaps (
    id          uuid primary key default gen_random_uuid(),
    booking_id  uuid not null references public.bookings(id) on delete restrict,
    from_car_id bigint not null,
    to_car_id   bigint not null,
    reason      text not null check (length(btrim(reason)) between 1 and 1000),
    swapped_by  uuid not null,
    created_at  timestamptz not null default now()
);

create index booking_vehicle_swaps_booking_idx
    on public.booking_vehicle_swaps (booking_id, created_at);

alter table public.booking_vehicle_swaps enable row level security;

revoke all on public.booking_vehicle_swaps from anon, authenticated;
grant all on public.booking_vehicle_swaps to service_role;
