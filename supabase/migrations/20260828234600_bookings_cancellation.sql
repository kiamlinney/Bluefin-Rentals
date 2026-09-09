-- Makes a cancellation an auditable event rather than a status change.
--
-- Before this, cancelBooking() set status='canceled' (or deleted the row) and
-- that was the entire record. You could not answer: who cancelled it, when,
-- whether any money moved, how much, or why. For a `pending` row you could not
-- even establish that the booking had existed.
--
-- Now that the refund amount depends on the rate and the timing, "how much was
-- returned" stops being derivable from the booking at all — the same trip
-- cancelled an hour apart refunds different amounts. It has to be recorded at
-- the moment it is decided.
--
--   canceled_at         when the cancellation was claimed
--   canceled_by         'guest' or 'admin' — these follow different rules; an
--                       admin cancel always refunds in full, so the two are not
--                       reconstructable from the numbers afterwards
--   cancellation_reason free text the guest optionally supplies, shown in the
--                       host notification email
--   refund_id           the Stripe refund object, so a dispute can be traced
--   refunded_amount     what was actually returned; null means nothing was
--
-- cancel_notified_at is a CLAIM, not a log — the same contract as
-- admin_notified_at, and for the same reason: the sender takes it with a
-- conditional update, Postgres serializes concurrent writers so exactly one gets
-- a row back, and a failed send sets it back to null so a retry can happen.
-- Nullable with no default for that reason.
--
-- No backfill on any of these. Bookings cancelled before this migration keep a
-- bare status='canceled' and are not retroactively attributed; inventing a
-- canceled_at from updated_at would be a guess recorded as a fact.

alter table public.bookings
    add column if not exists canceled_at         timestamp with time zone,
    add column if not exists canceled_by         text,
    add column if not exists cancellation_reason text,
    add column if not exists refund_id           text,
    add column if not exists refunded_amount     numeric,
    add column if not exists cancel_notified_at  timestamp with time zone;

-- Guarded rather than an enum: two values that are unlikely to grow, and a
-- check constraint can be widened without the ALTER TYPE ceremony.
alter table public.bookings
    drop constraint if exists bookings_canceled_by_chk;
alter table public.bookings
    add constraint bookings_canceled_by_chk
    check (canceled_by is null or canceled_by in ('guest', 'admin'));

-- A refund that returns more than the trip cost is a bug, not a business case.
alter table public.bookings
    drop constraint if exists bookings_refunded_amount_chk;
alter table public.bookings
    add constraint bookings_refunded_amount_chk
    check (refunded_amount is null or (refunded_amount >= 0 and refunded_amount <= total_price));

comment on column public.bookings.canceled_by is
    'Who initiated the cancellation. Admin cancels always refund in full, so this is not reconstructable from refunded_amount.';
comment on column public.bookings.cancel_notified_at is
    'Claim held by whichever path is sending the cancellation emails. Null means unsent (or a send failed and released it).';
comment on column public.bookings.refunded_amount is
    'What was actually returned to the card. Null means no refund was issued — not that one failed.';