-- Runs the Turo sync every 15 minutes.
--
-- Until now syncTuroBookings only ran from an admin button, and that button was
-- commented out — so nothing ran it, and a Turo trip booked after the last
-- manual run never blocked the site's calendar. Nothing warned about it.
--
-- pg_cron can't run the sync itself: it's app code, and needs Node to reach
-- Gmail. So the job uses pg_net to POST to the app's /api/cron/sync-turo
-- endpoint (src/routes/api/cron/sync-turo.ts), authenticated with CRON_SECRET.
-- That keeps every scheduled job in cron.job, alongside auto_complete_bookings
-- and expire_stale_pending_bookings.
--
-- ── Before running this ─────────────────────────────────────────────────────
--
-- 1. The site must be deployed at a public URL. Supabase's servers can't reach
--    a local dev server.
-- 2. CRON_SECRET must be set in the deployed app's environment.
-- 3. Store the endpoint URL and that same secret in Supabase Vault — run this
--    separately in the SQL editor, with the real values, and do NOT commit it:
--
--      select vault.create_secret('https://YOUR-DOMAIN/api/cron/sync-turo', 'turo_sync_url');
--      select vault.create_secret('THE-SAME-VALUE-AS-CRON_SECRET', 'turo_sync_cron_secret');
--
--    They live in Vault rather than in the job below because cron.job stores
--    each job's command as plain text.
--
-- ── Why 15 minutes, looking back 1 day ──────────────────────────────────────
--
-- Turo trips can be booked for the same day and the site's lead time is 3
-- hours, so a sync that lagged by hours could let the site sell a car Turo
-- already rented. Each run searches the last 1 day of email
-- (TURO_SYNC_SCHEDULED_LOOKBACK_DAYS in src/lib/turo-sync.server.ts), deliberately far longer
-- than the 15-minute gap: an email is only ever looked for while it's inside the
-- window, so the window has to outlast any stretch of failed runs — a deploy, an
-- outage — or that booking is missed for good. After an outage longer than a
-- day, run one catch-up by hand:
--
--      curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://YOUR-DOMAIN/api/cron/sync-turo?days=400"
--
-- ── Checking on it ──────────────────────────────────────────────────────────
--
--      select * from cron.job_run_details
--      where jobid = (select jobid from cron.job where jobname = 'sync-turo-bookings')
--      order by start_time desc limit 10;
--
--      -- pg_net records the HTTP response the app gave back:
--      select id, status_code, left(content, 200) as content, created
--      from net._http_response order by created desc limit 10;

create extension if not exists pg_net with schema extensions;

-- cron.schedule replaces any existing job of the same name, so this is safe to
-- re-run (e.g. to change the interval).
select cron.schedule(
    'sync-turo-bookings',
    '*/15 * * * *',
    $$
    select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'turo_sync_url'),
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'turo_sync_cron_secret')
        ),
        body := '{}'::jsonb,
        -- pg_net's default is 5 seconds; a run that has to fetch several emails
        -- can take longer, and the response is what records success.
        timeout_milliseconds := 60000
    );
    $$
);