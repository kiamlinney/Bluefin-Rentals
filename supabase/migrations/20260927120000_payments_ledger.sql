-- Saved cards, the charge ledger, deposits, trip extensions — plus two write
-- holes that had to close before any of it could be trusted.
--
-- Full design and every policy decision: ImportantFiles/*.md.
--
-- ── Before running this ─────────────────────────────────────────────────────
-- Nothing to prepare. It is one transaction: it all applies or none of it does.
-- Afterwards, regenerate the types (CLAUDE.md, "Types").

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Close the booking write hole
-- ═══════════════════════════════════════════════════════════════════════════
--
-- "Users can update their own bookings" let a signed-in guest PATCH any column
-- of their own row straight through PostgREST with the anon key. The status
-- trigger only guarded `status`, so a guest could flip booking_rate to
-- 'refundable' and cancel for a refund they never paid for, move end_time out a
-- week, or — once this migration adds it — set deposit_waived_at and unlock the
-- lockbox code. "Users can insert their own bookings" let them insert a pending
-- row with any created_at, which is a hold that never expires.
--
-- The only code that used either policy was createCheckoutSession, which now
-- writes through the service-role client after its own checks — the same
-- posture as every other booking write. Reads are unchanged.
drop policy if exists "Users can update their own bookings" on public.bookings;
drop policy if exists "Users can insert their own bookings" on public.bookings;

-- The status guard, restated in full so it no longer matters what the live
-- function currently says. schema.sql's copy predates `expired` and forbids
-- transitions the code performs every day.
--
-- Non-service callers still cannot change status at all. For the service role,
-- every transition the code performs is listed, and nothing else:
--   pending   -> confirmed   payment succeeded
--   pending   -> expired     abandoned checkout (cancelBooking; the sweep runs
--                            in replica mode and skips this trigger anyway)
--   pending   -> canceled    legacy payment_intent.canceled path
--   pending   -> failed      legacy; no longer written (see stripe-webhook.ts)
--   expired   -> confirmed   a late payment on an abandoned checkout (CLAUDE.md)
--   failed    -> confirmed   a retry that succeeded after a decline
--   confirmed -> canceled    cancellation
--   confirmed -> completed   trip over (auto_complete_bookings, replica mode)
--   canceled  -> confirmed   cancelBooking releasing its claim when Stripe fails
create or replace function public.bookings_guard_status() returns trigger
    language plpgsql security definer
    set search_path to 'public'
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claims', true)::json->>'role', '');
  is_service boolean := jwt_role = 'service_role';
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending'::booking_status and not is_service then
      raise exception 'New bookings must start as pending';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not is_service then
      raise exception 'status is server-managed and cannot be changed by this role';
    end if;

    if not (
      (old.status = 'pending'   and new.status in ('confirmed', 'expired', 'canceled', 'failed')) or
      (old.status = 'expired'   and new.status = 'confirmed') or
      (old.status = 'failed'    and new.status = 'confirmed') or
      (old.status = 'confirmed' and new.status in ('canceled', 'completed')) or
      (old.status = 'canceled'  and new.status = 'confirmed')
    ) then
      raise exception 'Illegal status transition: % -> %', old.status, new.status;
    end if;
  end if;

  return new;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Close the profile write hole
-- ═══════════════════════════════════════════════════════════════════════════
--
-- "profiles_update_own" only protects is_admin, so a guest could set their own
-- identity_verified = true with the anon key and skip Stripe Identity entirely.
-- The new stripe_customer_id would be open the same way, and pointing your
-- profile at someone else's Stripe customer is not something to allow.
--
-- A trigger rather than tighter policies, because the guest legitimately edits
-- the rest of the row (saveDriverInfo). Service role and admins pass.
alter table public.profiles
    add column if not exists stripe_customer_id text;

comment on column public.profiles.stripe_customer_id is
    'Stripe Customer the guest''s saved cards belong to. Server-managed. Mode-specific: a sandbox id is invalid under live keys, and getOrCreateCustomer replaces it.';

create or replace function public.profiles_guard_server_columns() returns trigger
    language plpgsql security definer
    set search_path to 'public'
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claims', true)::json->>'role', '');
begin
  if jwt_role = 'service_role' or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.identity_verified, false)
       or new.identity_verified_at is not null
       or new.stripe_identity_session_id is not null
       or new.stripe_customer_id is not null then
      raise exception 'identity and payment fields are server-managed';
    end if;
    return new;
  end if;

  if new.identity_verified          is distinct from old.identity_verified
     or new.identity_verified_at    is distinct from old.identity_verified_at
     or new.stripe_identity_session_id is distinct from old.stripe_identity_session_id
     or new.stripe_customer_id      is distinct from old.stripe_customer_id then
    raise exception 'identity and payment fields are server-managed';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_guard_server_columns on public.profiles;
create trigger trg_profiles_guard_server_columns
    before insert or update on public.profiles
    for each row execute function public.profiles_guard_server_columns();


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Bookings: the card on file and the deposit waiver
-- ═══════════════════════════════════════════════════════════════════════════
-- deposit_waived_by deliberately has NO foreign key to profiles. A second
-- bookings -> profiles relationship makes every PostgREST embed of
-- `profiles(...)` from bookings ambiguous (PGRST201), and that broke the trip,
-- reservation and trip-list pages in production the moment it was added. Keep
-- bookings.user_id the only path from bookings to profiles.
alter table public.bookings
    add column if not exists payment_method_id  text,
    add column if not exists deposit_waived_at  timestamp with time zone,
    add column if not exists deposit_waived_by  uuid;

comment on column public.bookings.payment_method_id is
    'Stripe PaymentMethod the guest saved at checkout (or later replaced) for this trip''s deposit and later charges.';
comment on column public.bookings.deposit_waived_at is
    'Set when an admin waives the deposit hold. Unlocks the lockbox code without a hold.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The charge ledger — one booking, many charges
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The checkout charge stays where it is: bookings.stripe_payment_intent_id and
-- the frozen bookings.price_quote. Every charge after it is one row here, with
-- its own PaymentIntent. Rows are appended and their state advances; nothing
-- here ever rewrites the checkout receipt.
--
-- A row is inserted BEFORE its PaymentIntent is created, and the intent carries
-- metadata.chargeId, so the webhook always finds its row — no race, no 500s.
create table if not exists public.booking_charges (
    id                        uuid primary key default gen_random_uuid(),
    booking_id                uuid not null references public.bookings(id) on delete restrict,

    -- 'extension'  — more time on the trip           (booking_extensions)
    -- 'extra'      — a post-booking extra             (booking_extras)
    -- 'deposit'    — the security hold                (manual capture)
    -- 'adjustment' — anything an owner bills: damage, mileage, fuel, tolls…
    kind                      text not null check (kind in ('extension', 'extra', 'deposit', 'adjustment')),
    -- For adjustments: a key from CHARGE_CATEGORIES in src/lib/charges.ts.
    -- Not checked here, so the list can change without a migration.
    category                  text,
    description               text not null check (char_length(btrim(description)) between 1 and 500),

    -- Pre-tax amount, and the tax on it (src/lib/tax.ts). amount + tax_amount
    -- is what the PaymentIntent is for.
    amount                    numeric(10,2) not null check (amount >= 0),
    tax_amount                numeric(10,2) not null default 0 check (tax_amount >= 0),
    tax_lines                 jsonb not null default '[]'::jsonb,
    -- Snapshot of what was bought (extension days, extra lines), like
    -- bookings.price_quote. Written once.
    line_items                jsonb not null default '[]'::jsonb,

    -- Money that actually moved, in dollars, reconciled from Stripe.
    amount_captured           numeric(10,2) not null default 0 check (amount_captured >= 0),
    amount_refunded           numeric(10,2) not null default 0 check (amount_refunded >= 0),

    -- requires_payment — created, or needs the guest (declined / authentication)
    -- processing       — Stripe is working on it
    -- authorized       — held, not captured (deposit, pending approval)
    -- succeeded        — captured
    -- failed           — gave up; a new attempt is a new row
    -- canceled         — hold released or charge abandoned; nothing taken
    status                    text not null default 'requires_payment'
                              check (status in ('requires_payment', 'processing', 'authorized', 'succeeded', 'failed', 'canceled')),

    stripe_payment_intent_id  text unique,
    payment_method_id         text,
    failure_message           text,

    -- Holds only. capture_before comes from the charge (Stripe's own deadline);
    -- keep_holding stops the automatic release; renews points at the hold this
    -- one replaced on a long trip.
    capture_before            timestamp with time zone,
    keep_holding              boolean not null default false,
    renews_charge_id          uuid references public.booking_charges(id) on delete set null,

    refund_id                 text,

    initiated_by              text not null check (initiated_by in ('guest', 'admin', 'system')),
    created_by                uuid references public.profiles(id) on delete set null,
    created_at                timestamp with time zone not null default now(),
    settled_at                timestamp with time zone,

    -- Email claims, same mechanism as bookings.admin_notified_at.
    receipt_sent_at           timestamp with time zone,
    action_email_sent_at      timestamp with time zone
);

create index if not exists booking_charges_booking_idx
    on public.booking_charges (booking_id, created_at);

-- At most one deposit attempt in flight per booking. The cron job and the trip
-- page can both try to place a hold; this is what stops them placing two.
-- 'authorized' is deliberately not in the list: renewing a long trip's hold
-- places the new one while the old one is still authorized.
create unique index if not exists booking_charges_one_deposit_in_flight
    on public.booking_charges (booking_id)
    where kind = 'deposit' and status in ('requires_payment', 'processing');

alter table public.booking_charges enable row level security;
revoke all on public.booking_charges from anon, authenticated;
grant all on public.booking_charges to service_role;

comment on table public.booking_charges is
    'Every charge after checkout, one row each. Service-role only; read through server functions that authorize the caller.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Trip extensions
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A live 'pending' extension (inside PENDING_HOLD_MS) and every 'requested'
-- one block [from_end_time, to_end_time) for other renters — the pending-hold
-- rule in CLAUDE.md, extended. bookings.end_time only moves once it's paid.
create table if not exists public.booking_extensions (
    id             uuid primary key default gen_random_uuid(),
    booking_id     uuid not null references public.bookings(id) on delete restrict,
    from_end_time  timestamp with time zone not null,
    to_end_time    timestamp with time zone not null,
    -- 'instant' — charged and applied on the spot
    -- 'request' — asked for inside the last hour; an owner approves it
    mode           text not null check (mode in ('instant', 'request')),
    -- pending   — awaiting payment (instant)
    -- requested — card held, awaiting an owner (request)
    -- confirmed — applied: bookings.end_time = to_end_time
    -- declined  — an owner said no; hold released
    -- expired   — payment never completed
    -- failed    — payment failed
    -- canceled  — the trip was cancelled first
    status         text not null default 'pending'
                   check (status in ('pending', 'requested', 'confirmed', 'declined', 'expired', 'failed', 'canceled')),
    quote          jsonb not null,
    amount         numeric(10,2) not null check (amount >= 0),
    charge_id      uuid references public.booking_charges(id) on delete set null,
    created_by     uuid references public.profiles(id) on delete set null,
    created_at     timestamp with time zone not null default now(),
    decided_at     timestamp with time zone,
    decided_by     uuid references public.profiles(id) on delete set null,
    constraint booking_extensions_order_chk check (to_end_time > from_end_time)
);

create index if not exists booking_extensions_booking_idx
    on public.booking_extensions (booking_id, created_at);

-- One open extension per trip at a time.
create unique index if not exists booking_extensions_one_open
    on public.booking_extensions (booking_id)
    where status in ('pending', 'requested');

alter table public.booking_extensions enable row level security;
revoke all on public.booking_extensions from anon, authenticated;
grant all on public.booking_extensions to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Post-booking extras are now paid for
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.booking_extras
    add column if not exists charge_id uuid references public.booking_charges(id) on delete set null;

comment on column public.booking_extras.charge_id is
    'The hold/charge for a post-booking extra. Held when requested, captured on approval, released on decline.';

commit;