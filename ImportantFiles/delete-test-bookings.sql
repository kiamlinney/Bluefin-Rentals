-- Deleting TEST bookings. Never run this once a real booking exists.
--
-- A booking row is the record of what a guest was charged and refunded (see
-- "Money is a legal record" in CLAUDE.md). Until launch, every booking is a
-- sandbox test and deleting them is fine; after launch, a booking that should
-- not be on the calendar is cancelled, never deleted.
--
-- Why a plain `delete from bookings` fails: seven tables point at bookings.
--   ON DELETE RESTRICT  reviews, booking_charges, booking_extensions,
--                       booking_vehicle_swaps
--   ON DELETE CASCADE   trip_media, booking_extras, booking_additional_drivers
-- booking_extras and booking_extensions also point at booking_charges, so they
-- go before the charges. booking_charges.renews_charge_id is ON DELETE SET NULL,
-- so charges can go in any order. No table has a delete trigger.
--
-- Not touched: uploaded trip photos stay in Storage (delete those folders in
-- the dashboard), and the Stripe sandbox keeps its PaymentIntents and Customers.
-- schedule_overlap_alerts rows for deleted trips are harmless and can stay.
--
-- HOW TO RUN: paste ONE section into the SQL editor and run it as a whole.
-- The editor runs each script on its own connection, so `commit;` has to be in
-- the same run: a transaction left open is rolled back when the run ends, and
-- a `commit;` run on its own afterwards commits nothing. (That is why the first
-- version of this file, which left the commit to a second run, deleted nothing.)
-- Everything between begin and commit happens together or not at all. To try a
-- section without keeping the result, change its `commit;` to `rollback;`.


-- ── A. The two test bookings overlapping Turo trips (2026-10-12) ─────────────
-- 7a6e4f3b… Ford Fusion, 9/30 to 10/30. e849d3a0… Toyota Corolla, 10/6 to 10/17.

begin;

delete from public.reviews                    where booking_id in ('7a6e4f3b-25a0-4411-961c-831ed8c24e77', 'e849d3a0-a208-45a3-96da-718375d64479');
delete from public.booking_vehicle_swaps      where booking_id in ('7a6e4f3b-25a0-4411-961c-831ed8c24e77', 'e849d3a0-a208-45a3-96da-718375d64479');
delete from public.booking_extras             where booking_id in ('7a6e4f3b-25a0-4411-961c-831ed8c24e77', 'e849d3a0-a208-45a3-96da-718375d64479');
delete from public.booking_extensions         where booking_id in ('7a6e4f3b-25a0-4411-961c-831ed8c24e77', 'e849d3a0-a208-45a3-96da-718375d64479');
delete from public.booking_additional_drivers where booking_id in ('7a6e4f3b-25a0-4411-961c-831ed8c24e77', 'e849d3a0-a208-45a3-96da-718375d64479');
delete from public.trip_media                 where booking_id in ('7a6e4f3b-25a0-4411-961c-831ed8c24e77', 'e849d3a0-a208-45a3-96da-718375d64479');
delete from public.booking_charges            where booking_id in ('7a6e4f3b-25a0-4411-961c-831ed8c24e77', 'e849d3a0-a208-45a3-96da-718375d64479');
delete from public.bookings                   where id         in ('7a6e4f3b-25a0-4411-961c-831ed8c24e77', 'e849d3a0-a208-45a3-96da-718375d64479');

commit;

-- The result the editor shows. Expect still_there = 0.
select count(*) as still_there from public.bookings
    where id in ('7a6e4f3b-25a0-4411-961c-831ed8c24e77', 'e849d3a0-a208-45a3-96da-718375d64479');


-- ── B. EVERY booking (clean slate before launch) ─────────────────────────────
-- Uncomment and run on its own. Reviews imported from Turo have no booking and
-- are kept (`booking_id is not null`).
--
-- begin;
--
-- delete from public.reviews                    where booking_id is not null;
-- delete from public.booking_vehicle_swaps;
-- delete from public.booking_extras;
-- delete from public.booking_extensions;
-- delete from public.booking_additional_drivers;
-- delete from public.trip_media;
-- delete from public.booking_charges;
-- delete from public.bookings;
--
-- commit;
--
-- select count(*) as bookings_left from public.bookings;  -- expect 0
