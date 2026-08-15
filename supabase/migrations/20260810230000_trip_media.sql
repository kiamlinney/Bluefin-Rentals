-- Trip photos & videos, one row per uploaded item, scoped to a booking.
-- Bytes live in the private `trip-media` storage bucket; this table holds the
-- paths plus the metadata the reservation UI renders (caption, uploader, size).
--
-- STATUS: the table, its policies, and the access helper were created by hand in
-- the Supabase dashboard and are already live on the linked project. Only the
-- storage.buckets row at the bottom was applied from here. This file is a record
-- of the shape the app expects, not part of a migration chain — there are no
-- other tracked migrations in this repo. Every statement is idempotent, so
-- re-running it is a no-op, but the policy and helper names below are what the
-- app was written against; if the dashboard versions differ, these are the ones
-- to reconcile toward.
--
-- Verified against the live project: column names and types match exactly, RLS
-- rejects anonymous reads and inserts, and the bookings->trip_media and
-- trip_media->profiles embeds both resolve.

create table if not exists public.trip_media (
    id               uuid primary key default gen_random_uuid(),
    booking_id       uuid not null references public.bookings(id) on delete cascade,
    kind             text not null check (kind in ('photo', 'video')),
    storage_path     text not null,
    thumb_path       text,
    caption          text,
    mime_type        text not null,
    size_bytes       bigint not null,
    width            integer,
    height           integer,
    duration_seconds numeric,
    uploaded_by      uuid references public.profiles(id),
    created_at       timestamptz not null default now()
);

create index if not exists trip_media_booking_id_created_at_idx
    on public.trip_media (booking_id, created_at desc);

alter table public.trip_media enable row level security;

-- Same predicate on every verb: platform admins, or the renter on the booking
-- the media belongs to. The renter half is unused by the admin UI today; it is
-- what lets the guest-facing view be added without touching policies.
create or replace function public.can_access_trip_media(target_booking_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select
        exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.is_admin
        )
        or exists (
            select 1 from public.bookings b
            where b.id = target_booking_id and b.user_id = auth.uid()
        );
$$;

drop policy if exists "trip_media_select" on public.trip_media;
create policy "trip_media_select" on public.trip_media
    for select using (public.can_access_trip_media(booking_id));

drop policy if exists "trip_media_insert" on public.trip_media;
create policy "trip_media_insert" on public.trip_media
    for insert with check (public.can_access_trip_media(booking_id));

drop policy if exists "trip_media_update" on public.trip_media;
create policy "trip_media_update" on public.trip_media
    for update using (public.can_access_trip_media(booking_id))
    with check (public.can_access_trip_media(booking_id));

drop policy if exists "trip_media_delete" on public.trip_media;
create policy "trip_media_delete" on public.trip_media
    for delete using (public.can_access_trip_media(booking_id));

-- Private bucket. No storage.objects policies: every read and write goes
-- through a signed URL minted server-side by the service-role client after an
-- explicit authorization check, the same way the Stripe webhook and
-- confirmBooking already use the service role.
--
-- 52428800 (50MB) is the project's Free-plan ceiling; a bucket cannot be set
-- above the project-wide limit. To reach the intended 200MB video cap, upgrade
-- to Pro, raise the project limit in Storage settings, then bump this value and
-- MAX_VIDEO_BYTES in src/lib/trip-media.ts together.
insert into storage.buckets (id, name, public, file_size_limit)
values ('trip-media', 'trip-media', false, 52428800)
on conflict (id) do update
    set public = false,
        file_size_limit = 52428800;