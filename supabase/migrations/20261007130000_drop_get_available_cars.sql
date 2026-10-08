-- Run AFTER the 2026-10-07 code is deployed (the currently live /fleet still
-- calls this function until then).
--
-- get_available_cars ran under the visitor's RLS, which hides other guests'
-- bookings, admin blocks and Turo trips, so for every customer it excluded
-- nothing and /fleet's date search listed every car as free. The search now
-- uses the calendar's own rules (getAvailableCars → dateRangeIsBookable).
--
-- Afterwards regenerate the types: npm run gen:types

drop function if exists public.get_available_cars(timestamptz, timestamptz);
