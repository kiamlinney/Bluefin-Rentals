-- Extras as rows on the booking, rather than only inside the price_quote blob.
--
-- ── Why both, and which answers what ─────────────────────────────────────────
--
-- bookings.price_quote keeps its own copy and remains the FROZEN PRICING RECORD:
-- what was quoted, agreed and charged at booking. refundForCancellation reads it,
-- and it is never rewritten once a trip is paid for. That is what makes a refund
-- describe the money Stripe actually took.
--
-- This table is the CURRENT STATE OF THE TRIP: what the guest actually has. It
-- is mutable, because extras can now be added after booking, and putting those
-- into price_quote would corrupt the snapshot the refund math depends on —
-- refunding money that was never charged.
--
-- Two records answering two different questions. Pages that ask "what does this
-- trip have?" read this table; anything computing a refund reads price_quote.

begin;

create table if not exists public.booking_extras (
    id          uuid primary key default gen_random_uuid(),
    booking_id  uuid not null references public.bookings(id) on delete cascade,

    -- Snapshotted from src/lib/extras.ts at the time it was added, like
    -- QuoteDay.price: a receipt reprinted after an extra is retired or repriced
    -- still shows what this guest actually got.
    extra_id    text not null,
    name        text not null,
    billing     text not null check (billing in ('per-trip', 'per-day')),
    unit_price  numeric(10,2) not null check (unit_price >= 0),
    quantity    integer not null check (quantity > 0),
    amount      numeric(10,2) not null check (amount >= 0),

    -- 'checkout'      — priced into the booking and paid for up front.
    -- 'post-booking'  — asked for later by the guest.
    source      text not null check (source in ('checkout', 'post-booking')),

    -- 'approved'   — on the trip. Checkout extras start here; the guest paid.
    -- 'requested'  — the guest asked, the owners haven't answered yet.
    -- 'declined'   — the owners said no. Kept rather than deleted so there is a
    --                record of the answer, and so the guest isn't silently
    --                offered it again a minute later.
    --
    -- The business cannot charge a card after checkout (no saved payment
    -- method — see CLAUDE.md), so a post-booking extra is approved by a person
    -- and settled in person. This column is what makes that a real state the
    -- admin page can act on, instead of a note in somebody's inbox.
    status      text not null default 'approved'
                check (status in ('approved', 'requested', 'declined')),

    -- Whether Stripe has this money. True for checkout extras, false for later
    -- additions until settled by hand. Kept explicit rather than inferred from
    -- `source` or `status`, so a later "charge the saved card" flow has
    -- somewhere to record that it worked.
    charged     boolean not null default false,

    created_at  timestamp with time zone not null default now(),
    -- When the owners answered. Null while still requested.
    decided_at  timestamp with time zone
);

-- One of each extra per trip, enforced by the database rather than only by the
-- UI. This is what actually stops a guest adding unlimited mileage twice — the
-- form hiding it and the server filtering it are both nice, but neither is a
-- guarantee under a retry or two tabs.
--
-- Partial, excluding declined rows: a decline is an answer to one request, not a
-- permanent ban. Without the `where`, declining a child seat in March would make
-- it impossible for that guest to ask again in April, and the failure would
-- surface as a constraint violation rather than anything explicable.
create unique index if not exists booking_extras_one_per_trip_idx
    on public.booking_extras (booking_id, extra_id)
    where status <> 'declined';

create index if not exists booking_extras_booking_idx
    on public.booking_extras (booking_id);

-- Same posture as public.reviews and booking_additional_drivers: no policies at
-- all, so RLS denies anon and authenticated outright. Every write goes through a
-- server function that has already authorized the caller.
alter table public.booking_extras enable row level security;
revoke all on public.booking_extras from anon, authenticated;
grant all on public.booking_extras to service_role;

comment on table public.booking_extras is
    'What extras a trip has, and what has been asked for. Mutable. bookings.price_quote keeps the frozen record of what was priced and charged at booking, which is what refunds are computed from.';

-- Requests waiting on an answer, which is what the admin reservation page acts
-- on. Partial so it stays small however many extras accumulate.
create index if not exists booking_extras_pending_idx
    on public.booking_extras (booking_id)
    where status = 'requested';

commit;
