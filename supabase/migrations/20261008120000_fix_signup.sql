-- Sign-ups have failed with "Database error saving new user" since 2026-09-27.
--
-- Cause: profiles_guard_server_columns refuses a new profile whose
-- stripe_identity_session_id is not null. That column defaults to '' (empty
-- text), so the profile handle_new_user creates for every new account tripped
-- it, and the whole sign-up was rolled back. No account was created between
-- 2026-09-23 and 2026-10-08. An empty string now counts as "not set".
--
-- Also: 20261007120000 revoked EXECUTE on the auth trigger functions from
-- PUBLIC, which took it from supabase_auth_admin too (the role Supabase Auth
-- creates accounts as). Granted back to that role only; it isn't reachable
-- through the public API.
--
-- Run in the SQL editor. Safe to run twice. Then run the check at the bottom.

begin;

create or replace function public.profiles_guard_server_columns()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claims', true)::json->>'role', '');
begin
  if jwt_role = 'service_role' or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- nullif: these columns default to '' rather than null, and a new
    -- profile carrying the default is not setting anything.
    if coalesce(new.is_admin, false)
       or coalesce(new.identity_verified, false)
       or new.identity_verified_at is not null
       or nullif(new.stripe_identity_session_id, '') is not null
       or nullif(new.stripe_customer_id, '') is not null then
      raise exception 'admin, identity and payment fields are server-managed';
    end if;
    return new;
  end if;

  if new.is_admin                   is distinct from old.is_admin
     or new.identity_verified       is distinct from old.identity_verified
     or new.identity_verified_at    is distinct from old.identity_verified_at
     or new.stripe_identity_session_id is distinct from old.stripe_identity_session_id
     or new.stripe_customer_id      is distinct from old.stripe_customer_id then
    raise exception 'admin, identity and payment fields are server-managed';
  end if;

  return new;
end;
$function$;

grant execute on function public.handle_new_user()     to supabase_auth_admin;
grant execute on function public.handle_user_updated() to supabase_auth_admin;

commit;

-- ── Check (run separately, after the above) ────────────────────────────────
-- Creates a throwaway account inside a transaction and rolls it back, so
-- nothing is kept. It should return one profile row. Before this fix it
-- failed with "admin, identity and payment fields are server-managed".
--
-- begin;
-- insert into auth.users (id, instance_id, aud, role, email)
-- values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'signup-check@example.com');
-- select id, email, is_admin from public.profiles where email = 'signup-check@example.com';
-- rollback;
