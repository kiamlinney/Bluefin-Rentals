-- One turo_bookings row per Turo trip.
--
-- syncTuroBookings used to insert a row per Turo *email*, and Turo emails about
-- a trip more than once: ReservationBookedOwner when it's booked,
-- ReservationReminderLongTerm the day before it starts, and
-- AutoApprovedTripChangeHost when the renter changes it. The table was only
-- unique on gmail_message_id, so one trip became several rows. Same-dated copies
-- were merely redundant; the real harm was a changed trip, whose original row
-- kept blocking the car on the old dates beside the new row — so a renter who
-- shortened or moved a trip on Turo left the car wrongly unavailable on the site.
--
-- The sync now keys on turo_trip_id and lets the most recently sent email win,
-- which needs each row to remember when its email was sent: email_sent_at.
--
-- This migration:
--   1. adds email_sent_at,
--   2. backfills it for the 20 rows being kept, from each email's Gmail
--      internalDate (read once, read-only, while writing this),
--   3. deletes the 9 superseded rows — 7 reminders, plus the original booking
--      email of the 2 trips that were later changed,
--   4. makes turo_trip_id unique so a trip can never gain a second row again.
--
-- Steps 2 and 3 name rows by id: they were checked by hand against the data as it
-- stood on 2026-09-14. The delete asserts it removed exactly 9 rows, so if the
-- table has changed since, the whole transaction rolls back rather than half-apply.

begin;

alter table public.turo_bookings
    add column if not exists email_sent_at timestamp with time zone;

comment on column public.turo_bookings.email_sent_at is
    'When Turo sent the email this row was last written from (Gmail internalDate). The sync only overwrites a row with a strictly newer email, so a changed trip replaces its original dates.';

update public.turo_bookings as t
set email_sent_at = v.sent_at
from (values
        ('6bed3394-9209-429e-98c2-b305cde05755'::uuid, '2026-07-16T20:49:33.000Z'::timestamptz),
        ('bc7e6e90-e81a-479e-8aa4-094d9d69920d'::uuid, '2026-07-23T17:28:45.000Z'::timestamptz),
        ('cfb12ba8-c708-4ae4-9146-c73fbc02117a'::uuid, '2026-08-04T00:46:44.000Z'::timestamptz),
        ('256dfc42-081f-4dd0-a103-2432f90f41ed'::uuid, '2026-06-19T10:51:47.000Z'::timestamptz),
        ('430dca7c-1c81-4f24-b1ab-abef2c5541d2'::uuid, '2026-07-06T21:11:03.000Z'::timestamptz),
        ('4603c634-c91c-4f34-a8e4-52a5efed0bf5'::uuid, '2026-07-24T18:22:03.000Z'::timestamptz),
        ('d41e4687-3300-4122-be5a-a9b5e62004ec'::uuid, '2026-07-09T14:09:06.000Z'::timestamptz),
        ('313e09fa-1e16-445b-b94d-379585ef03c0'::uuid, '2026-07-22T00:34:46.000Z'::timestamptz),
        ('e70e4e5a-8718-4a22-a8b5-d9dbad90f020'::uuid, '2026-08-03T20:34:28.000Z'::timestamptz),
        ('ea7b0c03-8698-43c2-baf3-f66db0cfe05c'::uuid, '2026-05-24T22:38:36.000Z'::timestamptz),
        ('f4869261-4317-4f4e-ac6b-ff19c25b1a80'::uuid, '2026-07-30T21:04:03.000Z'::timestamptz),
        ('966eca7a-6a97-4cda-9331-ac21ddf9d4ea'::uuid, '2026-06-07T22:55:48.000Z'::timestamptz),
        ('79e209a6-a9e7-4a82-a94b-d005735bb95c'::uuid, '2026-07-28T12:19:23.000Z'::timestamptz),
        ('245040b8-d975-48f4-ae4f-db7e764f8b55'::uuid, '2026-07-27T00:05:25.000Z'::timestamptz),
        ('fa5cf88b-2a52-41c4-a370-00daab9a00bb'::uuid, '2026-06-06T22:49:23.000Z'::timestamptz),
        ('0db2a02c-6635-4e68-9c74-4f747ad71273'::uuid, '2026-08-05T21:17:40.000Z'::timestamptz),
        ('d33a9a07-e5ac-4054-9634-f5aa75dea503'::uuid, '2026-07-14T20:20:53.000Z'::timestamptz),
        ('c2314a8e-74af-4524-afbb-2656a523775d'::uuid, '2026-08-05T18:37:37.000Z'::timestamptz),
        ('ddd5dcfe-b155-4ef3-83c6-2455a18c4735'::uuid, '2026-07-08T01:27:17.000Z'::timestamptz),
        ('958ea847-5c90-497d-9274-bf3f9751d997'::uuid, '2026-08-03T23:38:01.000Z'::timestamptz)
    ) as v(id, sent_at)
where t.id = v.id;

do $$
declare
    removed integer;
begin
    delete from public.turo_bookings
    where id in (
        '2ab06752-ee9f-4f36-95c4-3492de189717',
        '01c27c7f-b1f9-4410-94cf-cf84ba74c1b7',
        '476a99b8-4d47-4129-aa78-53ef6abdf2fd',
        '48e80281-8e3c-4729-ac79-6bc85e6912ff',
        '8db22f3a-ae5a-4848-9c4d-4a146e0aa9ac',
        'd8ace106-4138-4ef6-96e6-e8bd30e7d33a',
        '437d4071-76fa-4bd3-a71b-69c13313e7fb',
        '4f7a99e1-7077-445e-9c50-197bb2f67ec9',
        'd34275c0-f4aa-4a80-ba9b-e00e91c805b1'
    );
    get diagnostics removed = row_count;
    if removed <> 9 then
        raise exception 'Expected to remove 9 duplicate Turo rows, removed %. turo_bookings changed since this migration was written; nothing applied.', removed;
    end if;
end $$;

-- Fails, and rolls everything above back, if any trip still has two rows.
-- NULLs stay allowed (Postgres unique treats them as distinct): a booking email
-- with no parseable reservation id is still stored rather than dropped.
alter table public.turo_bookings
    add constraint turo_bookings_turo_trip_id_key unique (turo_trip_id);

commit;