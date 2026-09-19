-- Ratings & reviews.
--
-- A review belongs to a *booking*, not directly to a car. createReview copies
-- car_id and user_id off the booking server-side, so "you can only review the
-- car you rented" can't be spoofed by a client, and a guest who rents the same
-- car twice gets one review per trip (booking_id is unique).
--
-- Imported Turo reviews (source = 'turo') have no booking or user on this site:
-- the admin enters the renter's name, date and car by hand. The check below
-- keeps every first-party review tied to a booking and a user.
--
-- Two ways a review disappears, on purpose:
--   * the guest deletes their own review  -> the row is deleted, and the trip
--     can be reviewed again;
--   * the admin removes it                -> removed_at is set, the row stays,
--     and the unique booking_id stays taken, so a removed review can't simply
--     be re-posted.
--
-- Writes all go through server functions using the service-role client after
-- their own checks, so there are no insert/update/delete policies. Reads are
-- public, but only through a column grant that leaves out user_id and
-- booking_id: an anonymous PostgREST caller shouldn't be able to list which
-- account wrote which review.

begin;

create table public.reviews (
    id            uuid primary key default gen_random_uuid(),
    booking_id    uuid unique references public.bookings(id) on delete restrict,
    car_id        bigint not null references public.cars(id) on delete restrict,
    user_id       uuid references public.profiles(id) on delete set null,
    reviewer_name text not null check (char_length(btrim(reviewer_name)) between 1 and 60),
    rating        smallint not null check (rating between 1 and 5),
    body          text not null check (char_length(btrim(body)) between 1 and 2000),
    source        text not null default 'bluefin' check (source in ('bluefin', 'turo')),
    created_at    timestamp with time zone not null default now(),
    edited_at     timestamp with time zone,
    removed_at    timestamp with time zone,
    constraint reviews_bluefin_has_booking_chk
        check (source = 'turo' or (booking_id is not null and user_id is not null))
);

comment on column public.reviews.reviewer_name is
    'Snapshot of the name shown publicly: the guest''s first name at posting time, or the renter name typed in for an imported Turo review.';
comment on column public.reviews.edited_at is
    'Set when the guest edits their review; the public pages show "Edited".';
comment on column public.reviews.removed_at is
    'Set when an admin removes the review. The row is kept so the booking can''t be reviewed again.';

create index reviews_car_recent_idx
    on public.reviews (car_id, created_at desc)
    where removed_at is null;

create index reviews_user_idx on public.reviews (user_id);

alter table public.reviews enable row level security;

create policy "Visible reviews are readable by everyone"
    on public.reviews for select
    to anon, authenticated
    using (removed_at is null);

revoke all on public.reviews from anon, authenticated;
grant select (id, car_id, reviewer_name, rating, body, source, created_at, edited_at)
    on public.reviews to anon, authenticated;
grant all on public.reviews to service_role;

commit;