-- Owner usernames, so Jade, Nick and Liam can sign in by typing their name
-- instead of an email.
--
-- loginUser (src/lib/auth.ts) treats anything without an "@" as a username and
-- looks it up here (src/lib/login.server.ts#emailForLogin), then signs in with
-- that account's email as usual. Guests never get a username: the table has no
-- policies and no anon/authenticated grants, so only the service role reads or
-- writes it, and rows are added by hand below.
--
-- Its own table rather than a profiles column: a guest reads and updates their
-- own profile, so a column there would need profiles_guard_server_columns to
-- stop them claiming "jade". The FK is to auth.users, not profiles or bookings
-- (a second path to profiles from bookings is the PGRST201 trap).
--
-- Additive: the deployed code never reads it. Safe to run twice.

begin;

create table if not exists public.login_usernames (
    username   text primary key
        check (username = lower(username) and username !~ '@' and length(username) between 2 and 32),
    user_id    uuid not null unique references auth.users(id) on delete cascade,
    created_at timestamp with time zone not null default now()
);

alter table public.login_usernames enable row level security;
revoke all on public.login_usernames from anon, authenticated;
grant all on public.login_usernames to service_role;

commit;

-- ── Check (changes nothing) ─────────────────────────────────────────────────
-- Expect every row to end in "OK".
--
-- select 'table: ' || case when to_regclass('public.login_usernames') is not null then 'OK' else 'MISSING' end
-- union all
-- select 'rls on: ' || case when (select relrowsecurity from pg_class where oid = 'public.login_usernames'::regclass)
--        then 'OK' else 'OFF' end
-- union all
-- select 'no policies: ' || case when (select count(*) from pg_policies where tablename = 'login_usernames') = 0
--        then 'OK' else 'HAS POLICIES' end
-- union all
-- select 'no guest grants: ' || case when not exists (select 1 from information_schema.role_table_grants
--          where table_name = 'login_usernames' and grantee in ('anon', 'authenticated'))
--        then 'OK' else 'GRANTED' end;

-- ── Setting up the accounts ─────────────────────────────────────────────────
-- 1. Supabase dashboard → Authentication → Users → Add user → Create new user:
--      bluefinbiz+jade@gmail.com   (Jade's own password, "Auto Confirm User" ticked)
--      bluefinbiz+nick@gmail.com   (Nick's own password, "Auto Confirm User" ticked)
--    Gmail ignores everything from the "+" to the "@", so both deliver to the
--    bluefinbiz@gmail.com inbox. handle_new_user creates each profile.
--
-- 2. Then run this, all at once (the commit is at the end). The replica line is
--    needed because profiles_guard_server_columns refuses is_admin changes from
--    the SQL editor; it skips every trigger in this one transaction.
--
-- begin;
-- set local session_replication_role = 'replica';
-- update public.profiles set is_admin = true, full_name = 'Jade'
--     where id = (select id from auth.users where email = 'bluefinbiz+jade@gmail.com');
-- update public.profiles set is_admin = true, full_name = 'Nick'
--     where id = (select id from auth.users where email = 'bluefinbiz+nick@gmail.com');
-- insert into public.login_usernames (username, user_id) values
--     ('jade', (select id from auth.users where email = 'bluefinbiz+jade@gmail.com')),
--     ('nick', (select id from auth.users where email = 'bluefinbiz+nick@gmail.com')),
--     ('liam', (select id from auth.users where email = 'liamjkinney@gmail.com'))
-- on conflict (username) do nothing;
-- commit;
--
-- select u.username, a.email, p.full_name, p.is_admin
-- from public.login_usernames u
-- join auth.users a on a.id = u.user_id
-- join public.profiles p on p.id = u.user_id
-- order by u.username;
-- -- Expect three rows (jade, liam, nick), each is_admin = true.
--
-- 3. The old shared "Jade&Nick" account (bluefinbiz@gmail.com) was demoted,
--    then deleted from Authentication → Users on 2026-10-15. Nothing referenced
--    it (no bookings, media, notes, blocks or change-log rows).
