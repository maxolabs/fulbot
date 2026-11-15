-- 00036 — Production ticker: pg_cron + pg_net (OD-4, docs/deploy.md §4)
--
-- Every timed step of the app (scheduled_jobs, match reminders, recurring
-- lists, the WhatsApp and push outboxes) runs from POST /api/cron/tick, and
-- something has to call it every minute. In production that is the database
-- itself: pg_cron runs public.fulbot_cron_tick() every minute, which reads
-- the app URL and CRON_SECRET from Vault and queues the request with pg_net.
--
--   Vault secret         value
--   fulbot_app_url       the production NEXT_PUBLIC_APP_URL (https://…, the
--                        final URL: pg_net does not follow redirects)
--   fulbot_cron_secret   the Vercel CRON_SECRET, sent as
--                        `Authorization: Bearer …` (src/app/api/cron/tick)
--
-- Without both secrets (a local stack, a fresh project before setup) the job
-- still runs every minute and returns at once: one indexed lookup, no
-- request. Locally, scripts/ticker.ts (`npm run ticker`) drives the tick.
--
-- The route stamps scheduler_state.last_tick_at (claim_due_jobs), which is
-- what /api/health watches; public.get_ticker_status() adds the driver's
-- side (job, secrets present, last run, last HTTP response) for the
-- authorized health details.
--
-- Re-runnable: extensions IF NOT EXISTS, CREATE OR REPLACE, and
-- cron.schedule() upserts the job by name.

-- ============================================
-- 1. Extensions, where Supabase puts them
-- ============================================
-- pg_cron lives in pg_catalog (its objects in the cron schema), pg_net is
-- registered in extensions (its functions in the net schema). On Supabase
-- both are allow-listed for the postgres role, and the platform hooks grant
-- postgres the cron and net schemas when they are created.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ============================================
-- 2. The tick
-- ============================================
-- Returns the pg_net request id, or NULL when the secrets are not set.
-- pg_net sends the request after this transaction commits, from its own
-- background worker; the response lands in net._http_response (kept for
-- pg_net.ttl, 6 h by default). The route usually answers in well under a
-- second; 55 s matches scripts/ticker.ts and leaves room for a cold start.

CREATE OR REPLACE FUNCTION public.fulbot_cron_tick()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_url TEXT;
    v_secret TEXT;
    v_request_id BIGINT;
BEGIN
    SELECT max(s.decrypted_secret) FILTER (WHERE s.name = 'fulbot_app_url'),
           max(s.decrypted_secret) FILTER (WHERE s.name = 'fulbot_cron_secret')
    INTO v_url, v_secret
    FROM vault.decrypted_secrets s
    WHERE s.name IN ('fulbot_app_url', 'fulbot_cron_secret');

    v_url := NULLIF(rtrim(btrim(v_url), '/'), '');
    v_secret := NULLIF(btrim(v_secret), '');
    IF v_url IS NULL OR v_secret IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT net.http_post(
        url := v_url || '/api/cron/tick',
        body := '{}'::jsonb,
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_secret,
            'Content-Type', 'application/json',
            'User-Agent', 'fulbot-pg-cron'
        ),
        timeout_milliseconds := 55000
    ) INTO v_request_id;

    -- pg_cron logs one cron.job_run_details row per run (1440 a day) and never
    -- prunes them. Once an hour, drop this job's rows older than a week.
    IF extract(minute FROM now()) = 0 THEN
        BEGIN
            DELETE FROM cron.job_run_details d
            USING cron.job j
            WHERE j.jobname = 'fulbot-tick'
              AND d.jobid = j.jobid
              AND d.end_time < now() - interval '7 days';
        EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
            NULL;
        END;
    END IF;

    RETURN v_request_id;
END;
$$;

-- Only the owner (postgres, which also owns the cron job) runs it. Supabase's
-- default privileges grant EXECUTE on new public functions to anon,
-- authenticated and service_role; take all of them back.
REVOKE ALL ON FUNCTION public.fulbot_cron_tick() FROM PUBLIC, anon, authenticated, service_role;

-- ============================================
-- 3. Driver status for /api/health
-- ============================================
-- What the authorized /api/health details show about the driver. Never
-- returns secret values, only whether they are set. The last HTTP response
-- is the newest row in net._http_response: this tick is the app's only pg_net
-- caller.

CREATE OR REPLACE FUNCTION public.get_ticker_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job JSONB;
    v_run JSONB;
    v_response JSONB;
    v_secrets JSONB;
BEGIN
    SELECT jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'active', j.active, 'command', j.command)
    INTO v_job
    FROM cron.job j
    WHERE j.jobname = 'fulbot-tick'
    LIMIT 1;

    SELECT jsonb_build_object('status', d.status, 'start_time', d.start_time,
                              'end_time', d.end_time, 'message', left(d.return_message, 200))
    INTO v_run
    FROM cron.job_run_details d
    JOIN cron.job j ON j.jobid = d.jobid
    WHERE j.jobname = 'fulbot-tick'
    ORDER BY d.runid DESC
    LIMIT 1;

    SELECT jsonb_build_object('status_code', r.status_code, 'timed_out', r.timed_out,
                              'error', left(r.error_msg, 200), 'created', r.created)
    INTO v_response
    FROM net._http_response r
    ORDER BY r.id DESC
    LIMIT 1;

    SELECT jsonb_build_object(
        'app_url', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'fulbot_app_url'),
        'cron_secret', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'fulbot_cron_secret'))
    INTO v_secrets;

    RETURN jsonb_build_object('job', v_job, 'secrets', v_secrets,
                              'last_run', v_run, 'last_response', v_response);
END;
$$;

REVOKE ALL ON FUNCTION public.get_ticker_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ticker_status() TO service_role;

-- ============================================
-- 4. Schedule: every minute, under a fixed name
-- ============================================
-- cron.schedule(name, …) updates the job in place when the name exists, so
-- re-running this migration never adds a second job. The job runs as the
-- role that ran the migration (postgres).

SELECT cron.schedule('fulbot-tick', '* * * * *', 'SELECT public.fulbot_cron_tick()');
