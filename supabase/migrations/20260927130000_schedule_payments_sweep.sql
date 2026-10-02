-- Runs the payments sweep every 15 minutes: places deposit holds ahead of
-- pickup, retries declined ones, renews holds on long trips before Stripe's
-- deadline, releases holds after the inspection window, and lets go of
-- extension payments nobody finished. See src/routes/api/cron/payments.ts and
-- ImportantFiles/deposit.md.
--
-- Same mechanism as sync-turo-bookings (20260915130000_schedule_turo_sync.sql):
-- pg_net POSTs to the app, authenticated with CRON_SECRET, because the work
-- needs the Stripe API and pg_cron can't reach it.
--
-- ── Before running this ─────────────────────────────────────────────────────
--
-- 1. The deployed site must include src/routes/api/cron/payments.ts.
-- 2. Store the endpoint URL in Vault — run this separately in the SQL editor
--    with the real domain, and do NOT commit it:
--
--      select vault.create_secret('https://rentbluefin.com/api/cron/payments', 'payments_sweep_url');
--
--    The secret itself is shared with the Turo job (turo_sync_cron_secret):
--    both routes check the same CRON_SECRET.
--
-- ── Checking on it ──────────────────────────────────────────────────────────
--
--      select * from cron.job_run_details
--      where jobid = (select jobid from cron.job where jobname = 'payments-sweep')
--      order by start_time desc limit 10;
--
--      select id, status_code, left(content, 300) as content, created
--      from net._http_response order by created desc limit 10;

create extension if not exists pg_net with schema extensions;

select cron.schedule(
    'payments-sweep',
    '*/15 * * * *',
    $$
    select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'payments_sweep_url'),
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'turo_sync_cron_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
    );
    $$
);