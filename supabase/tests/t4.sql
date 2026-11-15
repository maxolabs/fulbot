-- T4 scenarios: the pg_cron ticker (00036). No BEGIN/COMMIT of its own; run
-- after the migration inside a transaction that is always rolled back
-- (docs/review/wrapup-2026-11-15.md):
--
--   DB=postgresql://postgres:postgres@127.0.0.1:56622/postgres
--   { echo "BEGIN; SET LOCAL lock_timeout = '30s';"; \
--     cat supabase/migrations/00036_pg_cron_ticker.sql supabase/migrations/00036_pg_cron_ticker.sql \
--         supabase/tests/t4.sql; echo "ROLLBACK;"; } | psql "$DB" -v ON_ERROR_STOP=1 -q
--
-- (The migration twice proves it is re-runnable.) Requests queued here are
-- rolled back with the transaction, so pg_net never sends them. If the shared
-- DB has real fulbot_* Vault secrets, the scenarios set their own values and
-- the rollback restores the originals.

-- 1. Extensions and the job ------------------------------------------------
DO $$
DECLARE
    v_count INT;
    v_job RECORD;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron' AND extnamespace = 'pg_catalog'::regnamespace) THEN
        RAISE EXCEPTION 'pg_cron is not installed in pg_catalog';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net' AND extnamespace = 'extensions'::regnamespace) THEN
        RAISE EXCEPTION 'pg_net is not installed in extensions';
    END IF;

    SELECT count(*) INTO v_count FROM cron.job WHERE jobname = 'fulbot-tick';
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'expected exactly one fulbot-tick job, found %', v_count;
    END IF;
    SELECT * INTO v_job FROM cron.job WHERE jobname = 'fulbot-tick';
    IF v_job.schedule <> '* * * * *' OR v_job.command <> 'SELECT public.fulbot_cron_tick()' OR NOT v_job.active THEN
        RAISE EXCEPTION 'fulbot-tick job is wrong: % / % / active=%', v_job.schedule, v_job.command, v_job.active;
    END IF;
    IF v_job.username <> current_user THEN
        RAISE EXCEPTION 'fulbot-tick runs as %, expected %', v_job.username, current_user;
    END IF;
    RAISE NOTICE 'ok 1: extensions in place, one active fulbot-tick job every minute';
END $$;

-- 2. Privileges -------------------------------------------------------------
DO $$
DECLARE
    v_role TEXT;
BEGIN
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fulbot_cron_tick()'::regprocedure) THEN
        RAISE EXCEPTION 'fulbot_cron_tick must be SECURITY DEFINER';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fulbot_cron_tick()'::regprocedure
                   AND proconfig @> ARRAY['search_path=""']) THEN
        RAISE EXCEPTION 'fulbot_cron_tick must pin an empty search_path';
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'public'] LOOP
        IF v_role = 'public' THEN
            IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE p.oid = 'public.fulbot_cron_tick()'::regprocedure AND a.grantee = 0) THEN
                RAISE EXCEPTION 'PUBLIC can execute fulbot_cron_tick';
            END IF;
        ELSIF has_function_privilege(v_role, 'public.fulbot_cron_tick()', 'EXECUTE') THEN
            RAISE EXCEPTION '% can execute fulbot_cron_tick', v_role;
        END IF;
    END LOOP;
    IF has_function_privilege('anon', 'public.get_ticker_status()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.get_ticker_status()', 'EXECUTE') THEN
        RAISE EXCEPTION 'get_ticker_status must be service_role only';
    END IF;
    IF NOT has_function_privilege('service_role', 'public.get_ticker_status()', 'EXECUTE') THEN
        RAISE EXCEPTION 'service_role must be able to read get_ticker_status';
    END IF;
    RAISE NOTICE 'ok 2: fulbot_cron_tick is owner-only, get_ticker_status is service_role-only';
END $$;

-- 2b. Calls from the API roles are refused.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    BEGIN
        PERFORM public.fulbot_cron_tick();
        RAISE EXCEPTION 'authenticated could run fulbot_cron_tick';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM public.get_ticker_status();
        RAISE EXCEPTION 'authenticated could read get_ticker_status';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
RESET role;
SET LOCAL role anon;
DO $$
BEGIN
    PERFORM public.fulbot_cron_tick();
    RAISE EXCEPTION 'anon could run fulbot_cron_tick';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET role;
SET LOCAL role service_role;
DO $$
BEGIN
    BEGIN
        PERFORM public.fulbot_cron_tick();
        RAISE EXCEPTION 'service_role could run fulbot_cron_tick';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    IF public.get_ticker_status() ->> 'job' IS NULL THEN
        RAISE EXCEPTION 'service_role sees no job in get_ticker_status';
    END IF;
    RAISE NOTICE 'ok 2b: anon/authenticated/service_role cannot tick; service_role reads the status';
END $$;
RESET role;

-- 3. No secrets: a no-op ----------------------------------------------------
DELETE FROM vault.secrets WHERE name IN ('fulbot_app_url', 'fulbot_cron_secret');
DO $$
DECLARE
    v_before BIGINT;
    v_status JSONB;
BEGIN
    SELECT count(*) INTO v_before FROM net.http_request_queue;
    IF public.fulbot_cron_tick() IS NOT NULL THEN
        RAISE EXCEPTION 'tick without secrets must return NULL';
    END IF;
    IF (SELECT count(*) FROM net.http_request_queue) <> v_before THEN
        RAISE EXCEPTION 'tick without secrets queued a request';
    END IF;
    v_status := public.get_ticker_status();
    IF (v_status #>> '{secrets,app_url}')::boolean OR (v_status #>> '{secrets,cron_secret}')::boolean THEN
        RAISE EXCEPTION 'status reports secrets that do not exist: %', v_status;
    END IF;
    RAISE NOTICE 'ok 3: without Vault secrets the tick returns NULL and queues nothing';
END $$;

-- 3b. Only one of the two secrets: still a no-op.
SELECT vault.create_secret('https://fulbot.example.com', 'fulbot_app_url');
DO $$
BEGIN
    IF public.fulbot_cron_tick() IS NOT NULL THEN
        RAISE EXCEPTION 'tick with only the app URL must return NULL';
    END IF;
    RAISE NOTICE 'ok 3b: one secret alone is not enough';
END $$;

-- 4. Both secrets: one POST to /api/cron/tick with the bearer ----------------
-- A trailing slash and spaces in the stored URL are tolerated.
SELECT vault.update_secret(id, ' https://fulbot.example.com/ ') FROM vault.secrets WHERE name = 'fulbot_app_url';
SELECT vault.create_secret('t4-test-secret', 'fulbot_cron_secret');
DO $$
DECLARE
    v_id BIGINT;
    v_req RECORD;
    v_status JSONB;
BEGIN
    v_id := public.fulbot_cron_tick();
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'tick with both secrets returned NULL';
    END IF;
    SELECT * INTO v_req FROM net.http_request_queue WHERE id = v_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'request % is not in net.http_request_queue', v_id;
    END IF;
    IF v_req.method <> 'POST' OR v_req.url <> 'https://fulbot.example.com/api/cron/tick' THEN
        RAISE EXCEPTION 'wrong request: % %', v_req.method, v_req.url;
    END IF;
    IF v_req.headers ->> 'Authorization' <> 'Bearer t4-test-secret' THEN
        RAISE EXCEPTION 'wrong Authorization header: %', v_req.headers;
    END IF;
    IF v_req.timeout_milliseconds <> 55000 THEN
        RAISE EXCEPTION 'wrong timeout: %', v_req.timeout_milliseconds;
    END IF;

    v_status := public.get_ticker_status();
    IF NOT (v_status #>> '{secrets,app_url}')::boolean OR NOT (v_status #>> '{secrets,cron_secret}')::boolean THEN
        RAISE EXCEPTION 'status does not see the secrets: %', v_status;
    END IF;
    IF v_status::text LIKE '%t4-test-secret%' OR v_status::text LIKE '%fulbot.example.com%' THEN
        RAISE EXCEPTION 'status leaks a secret value: %', v_status;
    END IF;
    RAISE NOTICE 'ok 4: with both secrets the tick queues POST https://fulbot.example.com/api/cron/tick with the bearer';
END $$;

-- 5. The job's command works as the job's role ------------------------------
DO $$
DECLARE
    v_command TEXT;
    v_before BIGINT;
BEGIN
    SELECT command INTO v_command FROM cron.job WHERE jobname = 'fulbot-tick';
    SELECT count(*) INTO v_before FROM net.http_request_queue;
    EXECUTE v_command;
    IF (SELECT count(*) FROM net.http_request_queue) <> v_before + 1 THEN
        RAISE EXCEPTION 'running the job command did not queue exactly one request';
    END IF;
    RAISE NOTICE 'ok 5: the scheduled command queues one request';
END $$;
