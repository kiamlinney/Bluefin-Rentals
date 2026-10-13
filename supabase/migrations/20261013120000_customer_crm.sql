-- The customer CRM: the driver's licence snapshot, blocks, notes and tags.
--
-- 1. customer_identities
--
--    What Stripe Identity verified about a guest, copied when the verification
--    succeeds. Stripe hands the sensitive fields (licence number, date of birth,
--    expiry) and the photos only to a restricted key, and only for 48 hours
--    after verification. Past that it needs an IP-restricted key, and Railway
--    has fixed outgoing IPs only on Pro. So the webhook copies them here while
--    the window is open (src/lib/identity.server.ts#recordVerifiedIdentity). The
--    photos are never copied; they stay at Stripe.
--
--    license_number is normalized (upper case, letters and digits only) so it
--    can be compared with customer_blocks.license_number.
--
-- 2. customer_blocks
--
--    A block on an account (user_id), a driver's licence (license_number), or
--    both. Active while lifted_at is null. Lifting keeps the row, so the history
--    stays. One active block per account and per licence, enforced by the two
--    partial unique indexes: they are also what stops the webhook and
--    finalizeIdentitySession both inserting a licence-match block for the same
--    new account.
--
-- 3. customer_notes, customer_tags
--
--    The owners' private notes and tags on a customer.
--
-- None of this is on profiles, on purpose: a guest reads their own profile row
-- with select('*'), and must never see a "Caution" tag, a note, or that they
-- are blocked. Same posture as car_secrets: RLS on, no policies, granted to the
-- service role only. Every read and write goes through a server function that
-- checks the caller is an admin first.
--
-- No table here references bookings, so nothing can make a profiles(...) embed
-- from bookings ambiguous (PGRST201). Profile ids other than the subject's own
-- (blocked_by, author_id, ...) are plain uuids for the same reason.
--
-- Additive only: the deployed code ignores all four tables. Safe to run twice.
-- Run it in the SQL editor, then the check at the bottom, then regenerate the
-- types (CLAUDE.md, "Types").

begin;

create table if not exists public.customer_identities (
    user_id                 uuid primary key references public.profiles(id) on delete cascade,
    verification_session_id text not null,
    livemode                boolean not null default false,
    verified_at             timestamptz,
    first_name              text,
    last_name               text,
    dob                     date,
    license_number          text,
    document_type           text,
    issuing_country         text,
    issuing_state           text,
    issued_date             date,
    expiration_date         date,
    address                 jsonb,
    sensitive_captured      boolean not null default false,
    updated_at              timestamptz not null default now()
);

create index if not exists customer_identities_license_number_idx
    on public.customer_identities (license_number)
    where license_number is not null;

create table if not exists public.customer_blocks (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid,
    license_number   text,
    reason           text not null,
    source           text not null default 'manual',
    matched_block_id uuid references public.customer_blocks(id),
    blocked_by       uuid,
    created_at       timestamptz not null default now(),
    lifted_at        timestamptz,
    lifted_by        uuid,
    lift_reason      text,
    constraint customer_blocks_subject_chk check (user_id is not null or license_number is not null),
    constraint customer_blocks_source_chk check (source in ('manual', 'license_match'))
);

create unique index if not exists customer_blocks_one_active_per_user
    on public.customer_blocks (user_id)
    where lifted_at is null and user_id is not null;

create unique index if not exists customer_blocks_one_active_per_license
    on public.customer_blocks (license_number)
    where lifted_at is null and license_number is not null;

create table if not exists public.customer_notes (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references public.profiles(id) on delete cascade,
    body       text not null check (length(btrim(body)) between 1 and 4000),
    author_id  uuid,
    created_at timestamptz not null default now()
);

create index if not exists customer_notes_user_idx on public.customer_notes (user_id, created_at desc);

create table if not exists public.customer_tags (
    user_id    uuid not null references public.profiles(id) on delete cascade,
    tag        text not null check (length(btrim(tag)) between 1 and 40),
    created_at timestamptz not null default now(),
    primary key (user_id, tag)
);

alter table public.customer_identities enable row level security;
alter table public.customer_blocks     enable row level security;
alter table public.customer_notes      enable row level security;
alter table public.customer_tags       enable row level security;

revoke all on public.customer_identities from anon, authenticated;
revoke all on public.customer_blocks     from anon, authenticated;
revoke all on public.customer_notes      from anon, authenticated;
revoke all on public.customer_tags       from anon, authenticated;

grant all on public.customer_identities to service_role;
grant all on public.customer_blocks     to service_role;
grant all on public.customer_notes      to service_role;
grant all on public.customer_tags       to service_role;

commit;

-- ── Check (changes nothing) ─────────────────────────────────────────────────
-- Run this after the script above. Expect one row:
--   rls_on = 4, public_grants = 0, policies = 0, and
--   duplicate_licence_refused = true (the test row it tries is rolled back
--   either way, so nothing is left behind).
--
-- create temp table crm_check (refused boolean);
-- do $$
-- begin
--   begin
--     insert into public.customer_blocks (license_number, reason) values ('CHECK123', 'check');
--     raise exception 'undo';  -- only reached if the duplicate got in
--   exception
--     when unique_violation then insert into crm_check values (true);
--     when others then insert into crm_check values (false);
--   end;
-- end $$;
-- select
--   (select count(*) from pg_class where relnamespace = 'public'::regnamespace
--      and relname like 'customer\_%' and relkind = 'r' and relrowsecurity) as rls_on,
--   (select count(*) from information_schema.role_table_grants
--      where table_name like 'customer\_%' and grantee in ('anon', 'authenticated')) as public_grants,
--   (select count(*) from pg_policies where tablename like 'customer\_%') as policies,
--   (select bool_or(refused) from crm_check) as duplicate_licence_refused;
