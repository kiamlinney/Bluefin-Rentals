-- Stores the price breakdown the guest actually agreed to.
--
-- calculateTripPrice() in src/lib/pricing.ts returns a complete TripQuote — the
-- per-day rows with their override flags, the subtotal, both discount tiers with
-- their labels and percentages, the surcharge, the refundable premium, the
-- delivery fee and the total. PriceBreakdown.tsx renders all of it, and then the
-- request ends and every number except the total is gone. `total_price` was the
-- only survivor.
--
-- That was survivable while a cancellation was all-or-nothing. It stops being
-- survivable the moment a partial refund has to retain "the average cost of one
-- day", because a single number cannot be divided back into days: the discount
-- tiers, the same-day surcharge and per-date overrides all mean total_price/days
-- is not what any particular day cost.
--
-- This column is an IMMUTABLE SNAPSHOT, not a cache. Never recompute it, never
-- backfill it, never migrate its shape in place. A refund and a receipt are
-- financial facts about what the guest was quoted; re-deriving them from today's
-- price list would silently change history the first time a base rate is edited
-- or an override is removed. The `version` field inside the document exists so a
-- future shape can be read alongside this one rather than replacing it.
--
-- jsonb rather than columns because `days` is variable-length — one row per
-- calendar day of the trip — so normalising means a child table, and every
-- future pricing line means another migration. The document is written once and
-- read whole; there is nothing to query into.
--
-- Nullable with no default and no backfill: bookings made before this migration
-- have no snapshot and never will. refundForCancellation() falls back to
-- total_price / billableDays for those and marks the outcome `estimated`.

alter table public.bookings
    add column if not exists price_quote jsonb;

comment on column public.bookings.price_quote is
    'Immutable snapshot of the TripQuote the guest was charged against (src/lib/pricing.ts). Never recompute or backfill — refunds and receipts are derived from it. Null for bookings predating the column.';