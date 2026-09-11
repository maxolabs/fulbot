-- Crowd-sourced match results, part 1: scheduler and idempotent stats
-- (docs/match-results-consensus.md §5, §11.1).
--
--   * matches: duration, per-match results-request delay, finished_at, result
--     status/lock fields, last posted result key.
--   * notification_settings: group defaults for the above plus reminder/window.
--   * scheduled_jobs: the in-repo job queue. Rows are (re)created by a trigger on
--     matches whenever status/date/duration/delay change; claim_due_jobs /
--     run_scheduled_job are called by POST /api/cron/tick (service role).
--   * finalize_match_results becomes an idempotent recompute (recompute_player_stats
--     rebuilds every counter from scratch) so a consensus that changes over time
--     never double-counts; award_badges_for_match now also revokes.

-- ============================================
-- 1. COLUMNS
-- ============================================

ALTER TABLE public.matches
    ADD COLUMN IF NOT EXISTS duration_minutes SMALLINT NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS results_request_delay_minutes SMALLINT NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS result_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS result_locked_by UUID REFERENCES public.player_profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS result_locked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS result_posted_key TEXT;

ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_result_status_check;
ALTER TABLE public.matches ADD CONSTRAINT matches_result_status_check
    CHECK (result_status IN ('pending', 'provisional', 'consensus', 'locked'));
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_duration_minutes_check;
ALTER TABLE public.matches ADD CONSTRAINT matches_duration_minutes_check
    CHECK (duration_minutes BETWEEN 10 AND 600);
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_results_request_delay_check;
ALTER TABLE public.matches ADD CONSTRAINT matches_results_request_delay_check
    CHECK (results_request_delay_minutes BETWEEN 0 AND 10080);

CREATE INDEX IF NOT EXISTS idx_matches_result_status ON public.matches(result_status);

ALTER TABLE public.notification_settings
    ADD COLUMN IF NOT EXISTS default_duration_minutes INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS default_results_request_delay_minutes INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS results_reminder_hours INTEGER NOT NULL DEFAULT 24,
    ADD COLUMN IF NOT EXISTS results_window_days INTEGER NOT NULL DEFAULT 7;

ALTER TABLE public.notification_settings DROP CONSTRAINT IF EXISTS notification_settings_results_check;
ALTER TABLE public.notification_settings ADD CONSTRAINT notification_settings_results_check
    CHECK (default_duration_minutes BETWEEN 10 AND 600
       AND default_results_request_delay_minutes BETWEEN 0 AND 10080
       AND results_reminder_hours BETWEEN 0 AND 168
       AND results_window_days BETWEEN 1 AND 60);

-- ============================================
-- 2. JOB QUEUE
-- ============================================

CREATE TABLE IF NOT EXISTS public.scheduled_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    match_id UUID REFERENCES public.matches(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL CHECK (job_type IN
        ('auto_finish', 'results_request', 'results_reminder', 'results_window_close')),
    run_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    locked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_jobs_pending_uniq
    ON public.scheduled_jobs(match_id, job_type) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS scheduled_jobs_due
    ON public.scheduled_jobs(run_at) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS scheduled_jobs_match ON public.scheduled_jobs(match_id);

-- RLS on, no client policies: only SECURITY DEFINER functions and the service
-- role touch this table.
ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_scheduled_jobs_updated_at ON public.scheduled_jobs;
CREATE TRIGGER update_scheduled_jobs_updated_at BEFORE UPDATE ON public.scheduled_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 3. HELPERS
-- ============================================

CREATE OR REPLACE FUNCTION is_service_role()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role';
END;
$$ LANGUAGE plpgsql STABLE;

-- Relative report URL; the app prefixes NEXT_PUBLIC_APP_URL at render time when
-- app.settings.app_url is not configured in the database.
CREATE OR REPLACE FUNCTION match_report_url(p_match_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_slug TEXT;
BEGIN
    SELECT g.slug INTO v_slug
    FROM public.matches m JOIN public.groups g ON g.id = m.group_id
    WHERE m.id = p_match_id;
    RETURN COALESCE(current_setting('app.settings.app_url', true), '')
        || '/groups/' || COALESCE(v_slug, '') || '/matches/' || p_match_id::text || '#reportar';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================
-- 4. SCHEDULING
-- ============================================

CREATE OR REPLACE FUNCTION schedule_match_jobs(p_match_id UUID)
RETURNS void AS $$
DECLARE
    v_match public.matches;
    v_settings public.notification_settings;
    v_request_at TIMESTAMPTZ;
    v_window_days INTEGER;
    v_reminder_hours INTEGER;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL THEN
        RETURN;
    END IF;

    UPDATE public.scheduled_jobs
    SET status = 'cancelled'
    WHERE match_id = p_match_id AND status = 'pending';

    SELECT * INTO v_settings FROM public.notification_settings WHERE group_id = v_match.group_id;
    v_window_days := COALESCE(v_settings.results_window_days, 7);
    v_reminder_hours := COALESCE(v_settings.results_reminder_hours, 24);

    IF v_match.status IN ('signup_open', 'signup_closed', 'full', 'teams_created') THEN
        INSERT INTO public.scheduled_jobs (group_id, match_id, job_type, run_at)
        VALUES (v_match.group_id, p_match_id, 'auto_finish',
                v_match.date_time + (v_match.duration_minutes || ' minutes')::interval);
        RETURN;
    END IF;

    IF v_match.status = 'finished' AND v_match.result_status <> 'locked' THEN
        v_request_at := COALESCE(v_match.finished_at, now())
            + (v_match.results_request_delay_minutes || ' minutes')::interval;

        INSERT INTO public.scheduled_jobs (group_id, match_id, job_type, run_at, payload)
        VALUES (v_match.group_id, p_match_id, 'results_request', v_request_at,
                jsonb_build_object('app_url', COALESCE(current_setting('app.settings.app_url', true), '')));

        IF v_reminder_hours > 0 THEN
            INSERT INTO public.scheduled_jobs (group_id, match_id, job_type, run_at, payload)
            VALUES (v_match.group_id, p_match_id, 'results_reminder',
                    v_request_at + (v_reminder_hours || ' hours')::interval,
                    jsonb_build_object('app_url', COALESCE(current_setting('app.settings.app_url', true), '')));
        END IF;

        INSERT INTO public.scheduled_jobs (group_id, match_id, job_type, run_at)
        VALUES (v_match.group_id, p_match_id, 'results_window_close',
                v_match.date_time + (v_window_days || ' days')::interval);
    END IF;
    -- cancelled / draft / locked: nothing to schedule.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION trg_matches_set_finished_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'finished' AND NEW.finished_at IS NULL THEN
        NEW.finished_at := now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_matches_schedule_jobs()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM schedule_match_jobs(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS matches_set_finished_at ON public.matches;
CREATE TRIGGER matches_set_finished_at
    BEFORE INSERT OR UPDATE OF status ON public.matches
    FOR EACH ROW EXECUTE FUNCTION trg_matches_set_finished_at();

DROP TRIGGER IF EXISTS matches_schedule_jobs ON public.matches;
CREATE TRIGGER matches_schedule_jobs
    AFTER INSERT OR UPDATE OF status, date_time, duration_minutes, results_request_delay_minutes
    ON public.matches
    FOR EACH ROW EXECUTE FUNCTION trg_matches_schedule_jobs();

-- ============================================
-- 5. CLAIM / RUN
-- ============================================

CREATE OR REPLACE FUNCTION claim_due_jobs(p_limit INTEGER DEFAULT 20)
RETURNS SETOF public.scheduled_jobs AS $$
BEGIN
    IF NOT is_service_role() THEN
        RAISE EXCEPTION 'Esta operación requiere el rol de servicio';
    END IF;

    RETURN QUERY
    UPDATE public.scheduled_jobs j
    SET status = 'running', locked_at = now(), attempts = attempts + 1
    WHERE j.id IN (
        SELECT id FROM public.scheduled_jobs
        WHERE (status = 'pending' AND run_at <= now())
           OR (status = 'running' AND locked_at < now() - interval '10 minutes')
        ORDER BY run_at
        FOR UPDATE SKIP LOCKED
        LIMIT GREATEST(1, COALESCE(p_limit, 20))
    )
    RETURNING j.*;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auto_finish_match(p_match_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_match public.matches;
BEGIN
    IF NOT is_service_role() THEN
        RAISE EXCEPTION 'Esta operación requiere el rol de servicio';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL OR v_match.status <> 'teams_created' THEN
        RETURN FALSE;
    END IF;
    IF now() < v_match.date_time + (v_match.duration_minutes || ' minutes')::interval THEN
        RETURN FALSE;
    END IF;

    UPDATE public.matches SET status = 'finished' WHERE id = p_match_id;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Handlers ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION run_results_request_job(p_match_id UUID, p_payload JSONB)
RETURNS BOOLEAN AS $$
DECLARE
    v_match public.matches;
    v_group public.groups;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL OR v_match.status <> 'finished' OR v_match.result_status = 'locked' THEN
        RETURN FALSE;
    END IF;
    SELECT * INTO v_group FROM public.groups WHERE id = v_match.group_id;

    PERFORM emit_notification(v_match.group_id, p_match_id, 'results_request', jsonb_build_object(
        'match_id', p_match_id,
        'group_name', v_group.name,
        'date_time', v_match.date_time,
        'report_url', COALESCE(p_payload->>'app_url', '') || '/groups/' || v_group.slug || '/matches/' || p_match_id::text || '#reportar'
    ));
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION run_results_reminder_job(p_match_id UUID, p_payload JSONB)
RETURNS BOOLEAN AS $$
DECLARE
    v_match public.matches;
    v_group public.groups;
    v_ids UUID[];
    v_names TEXT[];
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL OR v_match.status <> 'finished'
       OR v_match.result_status NOT IN ('pending', 'provisional') THEN
        RETURN FALSE;
    END IF;
    SELECT * INTO v_group FROM public.groups WHERE id = v_match.group_id;

    SELECT array_agg(pp.id ORDER BY pp.display_name), array_agg(pp.display_name ORDER BY pp.display_name)
    INTO v_ids, v_names
    FROM public.match_signups ms
    JOIN public.player_profiles pp ON pp.id = ms.player_id
    WHERE ms.match_id = p_match_id
    AND ms.status = 'confirmed'
    AND NOT EXISTS (
        SELECT 1 FROM public.match_reports r
        WHERE r.match_id = p_match_id AND r.reporter_player_id = pp.id
    );

    IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
        RETURN FALSE;
    END IF;

    PERFORM emit_notification(v_match.group_id, p_match_id, 'results_reminder', jsonb_build_object(
        'match_id', p_match_id,
        'group_name', v_group.name,
        'date_time', v_match.date_time,
        'report_url', COALESCE(p_payload->>'app_url', '') || '/groups/' || v_group.slug || '/matches/' || p_match_id::text || '#reportar',
        'pending_player_ids', to_jsonb(v_ids),
        'pending_player_names', to_jsonb(v_names)
    ));
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION run_results_window_close_job(p_match_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_match public.matches;
    v_group public.groups;
    v_reports INTEGER;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL OR v_match.status <> 'finished' THEN
        RETURN FALSE;
    END IF;

    SELECT COUNT(*) INTO v_reports
    FROM public.match_reports r
    WHERE r.match_id = p_match_id AND r.submitted_after_lock = FALSE;

    IF v_match.result_status = 'provisional' AND v_reports > 0 THEN
        -- Best effort: whatever the reports say becomes the result.
        UPDATE public.matches SET result_status = 'consensus' WHERE id = p_match_id;
        PERFORM finalize_match_results(p_match_id);
        PERFORM post_match_result_if_changed(p_match_id);
        RETURN TRUE;
    END IF;

    IF v_match.result_status = 'pending' THEN
        SELECT * INTO v_group FROM public.groups WHERE id = v_match.group_id;
        -- In-app only, one row per admin: no outbox, no emit_notification.
        INSERT INTO public.notifications (group_id, match_id, recipient_player_id, type, payload)
        SELECT v_match.group_id, p_match_id, gm.player_id, 'results_needs_review',
               jsonb_build_object(
                   'match_id', p_match_id,
                   'group_name', v_group.name,
                   'date_time', v_match.date_time,
                   'reports_count', v_reports
               )
        FROM public.group_memberships gm
        WHERE gm.group_id = v_match.group_id AND gm.role = 'admin' AND gm.is_active = TRUE;
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION run_scheduled_job(p_job_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_job public.scheduled_jobs;
    v_ok BOOLEAN := FALSE;
    v_error TEXT;
BEGIN
    IF NOT is_service_role() THEN
        RAISE EXCEPTION 'Esta operación requiere el rol de servicio';
    END IF;

    SELECT * INTO v_job FROM public.scheduled_jobs WHERE id = p_job_id FOR UPDATE;
    IF v_job IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'job not found');
    END IF;
    IF v_job.status IN ('done', 'cancelled') THEN
        RETURN jsonb_build_object('job_type', v_job.job_type, 'match_id', v_job.match_id,
                                  'ok', true, 'skipped', v_job.status);
    END IF;

    BEGIN
        CASE v_job.job_type
            WHEN 'auto_finish' THEN
                v_ok := auto_finish_match(v_job.match_id);
            WHEN 'results_request' THEN
                v_ok := run_results_request_job(v_job.match_id, v_job.payload);
            WHEN 'results_reminder' THEN
                v_ok := run_results_reminder_job(v_job.match_id, v_job.payload);
            WHEN 'results_window_close' THEN
                v_ok := run_results_window_close_job(v_job.match_id);
            ELSE
                RAISE EXCEPTION 'Tipo de job desconocido: %', v_job.job_type;
        END CASE;

        UPDATE public.scheduled_jobs
        SET status = 'done', last_error = NULL, locked_at = NULL
        WHERE id = p_job_id;

        RETURN jsonb_build_object('job_type', v_job.job_type, 'match_id', v_job.match_id,
                                  'ok', true, 'acted', v_ok);
    EXCEPTION WHEN OTHERS THEN
        v_error := SQLERRM;
    END;

    -- The handler's work was rolled back with the exception block; record it.
    IF v_job.attempts >= 5 THEN
        UPDATE public.scheduled_jobs
        SET status = 'failed', last_error = v_error, locked_at = NULL
        WHERE id = p_job_id;
    ELSE
        UPDATE public.scheduled_jobs
        SET status = 'pending', last_error = v_error, locked_at = NULL,
            run_at = now() + (GREATEST(v_job.attempts, 1) * 2 || ' minutes')::interval
        WHERE id = p_job_id;
    END IF;

    RETURN jsonb_build_object('job_type', v_job.job_type, 'match_id', v_job.match_id,
                              'ok', false, 'error', v_error);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. STATS: idempotent recompute
-- ============================================

CREATE OR REPLACE FUNCTION recompute_player_stats(p_player_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE public.player_profiles pp
    SET matches_played = (
            SELECT COUNT(*) FROM public.match_signups ms
            JOIN public.matches m ON m.id = ms.match_id
            WHERE ms.player_id = p_player_id AND ms.status = 'confirmed' AND m.status = 'finished'
        ),
        goals = (
            SELECT COUNT(*) FROM public.match_events me
            JOIN public.matches m ON m.id = me.match_id
            WHERE me.player_id = p_player_id AND me.event_type = 'goal'
            AND m.status = 'finished' AND m.result_status IN ('consensus', 'locked')
        ),
        assists = (
            SELECT COUNT(*) FROM public.match_events me
            JOIN public.matches m ON m.id = me.match_id
            WHERE me.player_id = p_player_id AND me.event_type = 'assist'
            AND m.status = 'finished' AND m.result_status IN ('consensus', 'locked')
        ),
        clean_sheets = (
            SELECT COUNT(*) FROM public.team_assignments ta
            JOIN public.teams t ON t.id = ta.team_id
            JOIN public.matches m ON m.id = t.match_id
            WHERE ta.player_id = p_player_id AND ta.position = 'GK'
            AND m.status = 'finished' AND m.result_status IN ('consensus', 'locked')
            AND NOT EXISTS (
                SELECT 1 FROM public.teams other_team
                WHERE other_team.match_id = m.id AND other_team.id <> t.id AND other_team.score > 0
            )
        ),
        mvp_count = (
            SELECT COUNT(*) FROM public.matches m
            WHERE m.mvp_player_id = p_player_id
            AND m.status = 'finished' AND m.result_status IN ('consensus', 'locked')
        )
    WHERE pp.id = p_player_id;

    PERFORM update_player_reliability(p_player_id);
    PERFORM update_player_rating(p_player_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- award_badges_for_match: same conditions as 00011, but only for matches whose
-- result is consensus/locked, and revoking hat_trick/playmaker/safe_hands rows
-- whose condition no longer holds (ironman and mvp are left alone).
CREATE OR REPLACE FUNCTION match_badge_eligibility(p_match_id UUID)
RETURNS TABLE(player_id UUID, badge_type TEXT) AS $$
    SELECT me.player_id, 'hat_trick'::text
    FROM public.match_events me
    JOIN public.matches m ON m.id = me.match_id
    WHERE me.match_id = p_match_id AND me.event_type = 'goal' AND me.player_id IS NOT NULL
    AND m.status = 'finished' AND m.result_status IN ('consensus', 'locked')
    GROUP BY me.player_id HAVING COUNT(*) >= 3
    UNION ALL
    SELECT me.player_id, 'playmaker'::text
    FROM public.match_events me
    JOIN public.matches m ON m.id = me.match_id
    WHERE me.match_id = p_match_id AND me.event_type = 'assist' AND me.player_id IS NOT NULL
    AND m.status = 'finished' AND m.result_status IN ('consensus', 'locked')
    GROUP BY me.player_id HAVING COUNT(*) >= 2
    UNION ALL
    SELECT ta.player_id, 'safe_hands'::text
    FROM public.team_assignments ta
    JOIN public.teams t ON t.id = ta.team_id
    JOIN public.matches m ON m.id = t.match_id
    WHERE t.match_id = p_match_id AND ta.position = 'GK' AND ta.player_id IS NOT NULL
    AND m.status = 'finished' AND m.result_status IN ('consensus', 'locked')
    AND NOT EXISTS (
        SELECT 1 FROM public.teams other_team
        WHERE other_team.match_id = p_match_id AND other_team.id <> t.id AND other_team.score > 0
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION award_badges_for_match(p_match_id UUID)
RETURNS void AS $$
DECLARE
    v_match public.matches;
    v_recent_count INTEGER;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL THEN
        RETURN;
    END IF;

    DELETE FROM public.player_badges pb
    WHERE pb.match_id = p_match_id
    AND pb.badge_type IN ('hat_trick', 'playmaker', 'safe_hands')
    AND NOT EXISTS (
        SELECT 1 FROM match_badge_eligibility(p_match_id) e
        WHERE e.player_id = pb.player_id AND e.badge_type = pb.badge_type
    );

    INSERT INTO public.player_badges (player_id, badge_type, match_id)
    SELECT e.player_id, e.badge_type, p_match_id FROM match_badge_eligibility(p_match_id) e
    ON CONFLICT (player_id, badge_type, match_id) DO NOTHING;

    -- ironman: unchanged from 00011.
    IF v_match.status = 'finished' THEN
        SELECT COUNT(*) INTO v_recent_count
        FROM public.matches
        WHERE group_id = v_match.group_id AND status = 'finished';

        IF v_recent_count >= 10 THEN
            INSERT INTO public.player_badges (player_id, badge_type, match_id)
            SELECT eligible.player_id, 'ironman', p_match_id
            FROM (
                SELECT ms.player_id
                FROM public.match_signups ms
                WHERE ms.match_id IN (
                    SELECT id FROM public.matches
                    WHERE group_id = v_match.group_id AND status = 'finished'
                    ORDER BY date_time DESC
                    LIMIT 10
                )
                AND ms.status = 'confirmed'
                AND ms.player_id IS NOT NULL
                GROUP BY ms.player_id
                HAVING COUNT(DISTINCT ms.match_id) = 10
            ) eligible
            ON CONFLICT (player_id, badge_type, match_id) DO NOTHING;
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- finalize_match_results: idempotent. Does not touch teams.score (owned by the
-- consensus / admin result functions in 00019). Rebuilds the counters of every
-- player involved in the match and re-derives badges.
CREATE OR REPLACE FUNCTION finalize_match_results(p_match_id UUID)
RETURNS void AS $$
DECLARE
    v_match public.matches;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Match not found';
    END IF;
    IF v_match.status <> 'finished' THEN
        RAISE EXCEPTION 'Match must be finished to finalize results';
    END IF;

    PERFORM recompute_player_stats(pid)
    FROM (
        SELECT ms.player_id AS pid FROM public.match_signups ms
        WHERE ms.match_id = p_match_id AND ms.player_id IS NOT NULL
        AND ms.status IN ('confirmed', 'did_not_show')
        UNION
        SELECT me.player_id FROM public.match_events me
        WHERE me.match_id = p_match_id AND me.player_id IS NOT NULL
        UNION
        SELECT m.mvp_player_id FROM public.matches m
        WHERE m.id = p_match_id AND m.mvp_player_id IS NOT NULL
        UNION
        SELECT pb.player_id FROM public.player_badges pb
        WHERE pb.match_id = p_match_id
    ) involved
    WHERE pid IS NOT NULL;

    UPDATE public.matches SET results_finalized = TRUE WHERE id = p_match_id;

    PERFORM award_badges_for_match(p_match_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 7. RECURRING MATCHES COPY THE GROUP DEFAULTS
-- ============================================
-- Same body as 00010, plus duration_minutes / results_request_delay_minutes
-- copied from the group's notification_settings.

CREATE OR REPLACE FUNCTION generate_recurring_matches(p_group_id UUID DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
    pattern RECORD;
    v_created_count INTEGER := 0;
    v_local_now TIMESTAMP;
    v_today_dow INTEGER;
    v_days_diff INTEGER;
    v_candidate_local_date DATE;
    v_candidate_local TIMESTAMP;
    v_candidate_instant TIMESTAMPTZ;
    v_match_dow INTEGER;
    v_week_start_date DATE;
    v_signup_local_date DATE;
    v_signup_local TIMESTAMP;
    v_signup_instant TIMESTAMPTZ;
    v_match_id UUID;
    v_duration INTEGER;
    v_delay INTEGER;
BEGIN
    IF p_group_id IS NOT NULL THEN
        IF NOT is_group_member(p_group_id) THEN
            RAISE EXCEPTION 'No sos miembro de este grupo';
        END IF;
    ELSE
        IF COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role', '') != 'service_role' THEN
            RAISE EXCEPTION 'Esta operación requiere el rol de servicio';
        END IF;
    END IF;

    FOR pattern IN
        SELECT * FROM public.recurring_patterns
        WHERE is_active = TRUE
        AND (p_group_id IS NULL OR group_id = p_group_id)
    LOOP
        v_local_now := now() AT TIME ZONE pattern.timezone;
        v_today_dow := EXTRACT(DOW FROM v_local_now)::INTEGER;
        v_days_diff := ((pattern.weekday - v_today_dow) + 7) % 7;
        v_candidate_local_date := (v_local_now::DATE) + v_days_diff;
        v_candidate_local := v_candidate_local_date + pattern.match_time;
        v_candidate_instant := v_candidate_local AT TIME ZONE pattern.timezone;

        IF v_candidate_instant <= (now() - INTERVAL '2 hours') THEN
            v_candidate_local_date := v_candidate_local_date + 7;
            v_candidate_local := v_candidate_local_date + pattern.match_time;
            v_candidate_instant := v_candidate_local AT TIME ZONE pattern.timezone;
        END IF;

        v_match_dow := EXTRACT(DOW FROM v_candidate_local_date)::INTEGER;
        v_week_start_date := v_candidate_local_date - v_match_dow;
        v_signup_local_date := v_week_start_date + pattern.signup_opens_weekday::INTEGER;
        v_signup_local := v_signup_local_date + pattern.signup_opens_time;
        v_signup_instant := v_signup_local AT TIME ZONE pattern.timezone;

        IF v_signup_instant > v_candidate_instant THEN
            v_signup_local_date := v_signup_local_date - 7;
            v_signup_local := v_signup_local_date + pattern.signup_opens_time;
            v_signup_instant := v_signup_local AT TIME ZONE pattern.timezone;
        END IF;

        IF v_signup_instant <= now() AND NOT EXISTS (
            SELECT 1 FROM public.matches
            WHERE recurring_pattern_id = pattern.id AND date_time = v_candidate_instant
        ) THEN
            SELECT COALESCE(ns.default_duration_minutes, 60), COALESCE(ns.default_results_request_delay_minutes, 60)
            INTO v_duration, v_delay
            FROM public.notification_settings ns WHERE ns.group_id = pattern.group_id;
            v_duration := COALESCE(v_duration, 60);
            v_delay := COALESCE(v_delay, 60);

            BEGIN
                INSERT INTO public.matches (
                    group_id, date_time, location, status, max_players, recurring_pattern_id,
                    duration_minutes, results_request_delay_minutes
                )
                VALUES (
                    pattern.group_id, v_candidate_instant, pattern.location, 'signup_open',
                    pattern.max_players, pattern.id, v_duration, v_delay
                )
                RETURNING id INTO v_match_id;

                v_created_count := v_created_count + 1;
            EXCEPTION WHEN unique_violation THEN
                NULL;
            END;
        END IF;
    END LOOP;

    RETURN v_created_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 8. PRIVILEGES
-- ============================================

REVOKE ALL ON FUNCTION is_service_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_service_role() TO authenticated, service_role;
REVOKE ALL ON FUNCTION match_report_url(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION match_report_url(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION schedule_match_jobs(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION schedule_match_jobs(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION trg_matches_set_finished_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION trg_matches_schedule_jobs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_due_jobs(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_due_jobs(INTEGER) TO service_role;
REVOKE ALL ON FUNCTION run_scheduled_job(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION run_scheduled_job(UUID) TO service_role;
REVOKE ALL ON FUNCTION auto_finish_match(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auto_finish_match(UUID) TO service_role;
REVOKE ALL ON FUNCTION run_results_request_job(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION run_results_request_job(UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION run_results_reminder_job(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION run_results_reminder_job(UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION run_results_window_close_job(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION run_results_window_close_job(UUID) TO service_role;
REVOKE ALL ON FUNCTION recompute_player_stats(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION recompute_player_stats(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION match_badge_eligibility(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION match_badge_eligibility(UUID) TO service_role;
REVOKE ALL ON FUNCTION award_badges_for_match(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION award_badges_for_match(UUID) TO service_role;
REVOKE ALL ON FUNCTION finalize_match_results(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finalize_match_results(UUID) TO service_role;
REVOKE ALL ON FUNCTION generate_recurring_matches(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION generate_recurring_matches(UUID) TO authenticated, service_role;

-- ============================================
-- 9. BACKFILL
-- ============================================

UPDATE public.matches
SET finished_at = date_time + (duration_minutes || ' minutes')::interval
WHERE status = 'finished' AND finished_at IS NULL;

-- Results entered through the old admin editor are authoritative.
UPDATE public.matches
SET result_status = 'locked', result_locked_at = COALESCE(result_locked_at, now())
WHERE results_finalized = TRUE AND result_status <> 'locked';

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id FROM public.matches WHERE status <> 'cancelled' LOOP
        PERFORM schedule_match_jobs(r.id);
    END LOOP;
END $$;
