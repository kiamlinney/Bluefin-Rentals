-- Replaces the bookings admin policy's hardcoded email list with the same
-- public.is_admin() predicate every other table already uses.
--
-- The old policy read:
--
--   create policy "Admins have full access" on public.bookings
--     using ((auth.jwt() ->> 'email') = any (array['bluefinbiz@gmail.com','liamjkinney@gmail.com']));
--
-- Two problems with that. It grants access on the strength of an address rather
-- than the profiles.is_admin flag the rest of the app authorizes on, so the two
-- can disagree — and adding or removing an admin meant editing a policy instead
-- of a row. It also silently widened every query that leaned on RLS instead of
-- checking for itself, which is how an admin session could load another user's
-- booking through a page that had no authorization of its own.
--
-- BEFORE APPLYING, confirm both owner accounts carry the flag, or this locks
-- them out of every admin page:
--
--   select id, email, is_admin from public.profiles
--   where email in ('bluefinbiz@gmail.com', 'liamjkinney@gmail.com');
--
-- public.is_admin() (schema.sql) is STABLE SECURITY DEFINER with search_path
-- pinned, so it does not recurse through the profiles policies.

drop policy if exists "Admins have full access" on public.bookings;

-- No FOR clause, matching the policy it replaces: this covers select, insert,
-- update and delete. Narrowing it to SELECT would quietly revoke the admin's
-- ability to edit bookings.
create policy "bookings_admin_all" on public.bookings
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());