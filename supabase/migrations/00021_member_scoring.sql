-- Member scoring ("Compromiso"), docs/member-scoring.md §2, §3, §5, §10.1.
--
--   * member_events: the ledger. Every input (attendance, cancels, conduct flags,
--     participation, admin adjustments) is one row; the score is derived from it.
--   * group_memberships.member_score / member_breakdown / member_score_at /
--     signup_cooldown: the cached aggregate per (player, group) pair.
--   * matches.signup_opened_at (priority window anchor), match_signups.waitlist_reason
--     (full | priority_window | reserved | cooldown) so the UI can explain a waitlist.
--   * member_scoring_settings(): groups.settings->'member_scoring' merged over defaults.
--   * recompute_member_score(): five 0..1 ratios over the group's last N finished
--     matches (cancels also count on later, not-cancelled matches, so they bite at
--     once), weighted mean mapped to 1..5, admin adjustments as points/20 stars,
--     NULL ("Nuevo") below min_matches_for_score; threshold-crossing notifications.
--   * Emitters wired into the existing flows: finish (auto_finish_match,
--     admin_set_match_status, recompute_player_stats), cancel (cancel_my_signup,
--     admin_remove_signup), no-show marking (admin_set_signup_status), reports
--     (submit_match_report / delete_my_match_report), triggers on match_ratings,
--     match_mvp_votes and peer_ratings.
--   * Policies: priority signup (window / reserved / waitlist modes) in
--     signup_for_match and promote_from_waitlist, the priority_window_close job,
--     no-show cooldown, the 'ejemplar' badge.
--   * player_profiles.reliability_score and update_player_reliability are dropped:
--     the member score replaces them (same move 00018 made for overall_rating).
--   * Backfill from match_signups, match_reports, match_ratings, match_mvp_votes and
--     peer_ratings, then a recompute of every group.

-- ============================================
-- 1. TYPES AND TABLES
-- ============================================

DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_event_type') THEN
CREATE TYPE member_event_type AS ENUM (
    -- attendance (system)
    'attended',            -- confirmed when the match finished
    'no_show',             -- admin marked did_not_show
    'late_cancel',         -- cancelled inside the notice window
    'early_cancel',        -- cancelled with notice; neutral, logged for the breakdown
    -- conduct (admin / captain checklist)
    'arrived_late',
    'wrong_jersey',
    'unpaid',              -- reversed by 'paid'
    'paid',
    -- participation (system, from peer ratings and match reports)
    'reported_result',     -- submit_match_report, not after lock
    'rated_teammates',     -- at least one match_ratings row for the match
    'voted_mvp',           -- match_mvp_votes row for the match
    'rated_new_member',    -- peer_ratings row (rated or skipped) for a newcomer
    -- social / manual
    'peer_kudos',          -- structured positive tag from a teammate (v3, unused for now)
    'admin_adjustment'     -- manual +/- with mandatory note
);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_event_source') THEN
CREATE TYPE member_event_source AS ENUM ('system', 'admin', 'peer');
    END IF;
END $do$;

CREATE TABLE IF NOT EXISTS public.member_events (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id      UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    player_id     UUID NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
    match_id      UUID REFERENCES public.matches(id) ON DELETE CASCADE,          -- NULL for admin_adjustment / rated_new_member
    subject_id    UUID REFERENCES public.player_profiles(id) ON DELETE CASCADE,  -- rated_new_member: who was rated
    type          member_event_type NOT NULL,
    points        SMALLINT NOT NULL,           -- weight snapshot at insert time
    source        member_event_source NOT NULL,
    reported_by   UUID REFERENCES public.player_profiles(id) ON DELETE SET NULL,
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT member_events_match_required CHECK (
        type IN ('admin_adjustment', 'rated_new_member') OR match_id IS NOT NULL
    ),
    CONSTRAINT member_events_subject_only_for_newcomers CHECK (
        (type = 'rated_new_member') = (subject_id IS NOT NULL)
    )
);

-- One row per (group, player, match, subject, type, reporter). NULLS NOT DISTINCT so
-- the match-less / subject-less types dedupe too. admin_adjustment is excluded: an
-- admin must be able to adjust the same member more than once (each adjustment is
-- its own ledger entry with its own note), which the plain constraint of §2 forbids.
CREATE UNIQUE INDEX IF NOT EXISTS member_events_uniq
    ON public.member_events (group_id, player_id, match_id, subject_id, type, reported_by)
    NULLS NOT DISTINCT
    WHERE type <> 'admin_adjustment';

CREATE INDEX IF NOT EXISTS idx_member_events_group_player ON public.member_events(group_id, player_id);
CREATE INDEX IF NOT EXISTS idx_member_events_match ON public.member_events(match_id);

ALTER TABLE public.group_memberships
    ADD COLUMN IF NOT EXISTS member_score     DECIMAL(3,2) CHECK (member_score BETWEEN 1 AND 5),  -- NULL = not enough history
    ADD COLUMN IF NOT EXISTS member_breakdown JSONB,
    ADD COLUMN IF NOT EXISTS member_score_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS signup_cooldown  BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.matches
    ADD COLUMN IF NOT EXISTS signup_opened_at TIMESTAMPTZ;

ALTER TABLE public.match_signups
    ADD COLUMN IF NOT EXISTS waitlist_reason TEXT;
ALTER TABLE public.match_signups DROP CONSTRAINT IF EXISTS match_signups_waitlist_reason_check;
ALTER TABLE public.match_signups ADD CONSTRAINT match_signups_waitlist_reason_check
    CHECK (waitlist_reason IS NULL OR waitlist_reason IN ('full', 'priority_window', 'reserved', 'cooldown'));

ALTER TABLE public.scheduled_jobs DROP CONSTRAINT IF EXISTS scheduled_jobs_job_type_check;
ALTER TABLE public.scheduled_jobs ADD CONSTRAINT scheduled_jobs_job_type_check
    CHECK (job_type IN ('auto_finish', 'results_request', 'results_reminder', 'results_window_close', 'priority_window_close'));

-- ============================================
-- 2. RLS
-- ============================================
-- Members read their own rows; admins and captains read the whole group. No client
-- writes: every row is inserted by a SECURITY DEFINER function or trigger.

ALTER TABLE public.member_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "member_events_select" ON public.member_events;
CREATE POLICY "member_events_select" ON public.member_events
    FOR SELECT USING (
        player_id = get_current_player_id()
        OR is_group_admin_or_captain(group_id)
    );

-- ============================================
-- 3. SETTINGS READER
-- ============================================
-- groups.settings->'member_scoring' merged over the §2 defaults, one level deep for
-- the weights / dimensions / priority objects, so every consumer reads one shape.

CREATE OR REPLACE FUNCTION member_scoring_settings(p_group_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_defaults JSONB := jsonb_build_object(
        'enabled', false,
        'window_matches', 10,
        'late_cancel_hours', 6,
        'min_matches_for_score', 3,
        'weights', jsonb_build_object(
            'attended', 2, 'no_show', -15, 'late_cancel', -6, 'arrived_late', -3,
            'wrong_jersey', -2, 'unpaid', -5,
            'reported_result', 1, 'rated_teammates', 1, 'voted_mvp', 1, 'rated_new_member', 1,
            'peer_kudos', 1
        ),
        'dimensions', jsonb_build_object(
            'asistencia', 0.40, 'aviso', 0.20, 'puntualidad', 0.15, 'reglas', 0.10, 'participacion', 0.15
        ),
        'visibility', 'self',
        'priority', jsonb_build_object(
            'mode', 'off', 'threshold', 3.0, 'window_hours', 24, 'reserved_spots', 4
        ),
        'no_show_cooldown', false,
        'captains_can_report', true
    );
    v_custom JSONB;
    v_result JSONB;
BEGIN
    SELECT g.settings->'member_scoring' INTO v_custom FROM public.groups g WHERE g.id = p_group_id;
    IF v_custom IS NULL OR jsonb_typeof(v_custom) <> 'object' THEN
        RETURN v_defaults;
    END IF;

    v_result := v_defaults || v_custom;
    IF jsonb_typeof(v_custom->'weights') = 'object' THEN
        v_result := jsonb_set(v_result, '{weights}', (v_defaults->'weights') || (v_custom->'weights'));
    ELSE
        v_result := jsonb_set(v_result, '{weights}', v_defaults->'weights');
    END IF;
    IF jsonb_typeof(v_custom->'dimensions') = 'object' THEN
        v_result := jsonb_set(v_result, '{dimensions}', (v_defaults->'dimensions') || (v_custom->'dimensions'));
    ELSE
        v_result := jsonb_set(v_result, '{dimensions}', v_defaults->'dimensions');
    END IF;
    IF jsonb_typeof(v_custom->'priority') = 'object' THEN
        v_result := jsonb_set(v_result, '{priority}', (v_defaults->'priority') || (v_custom->'priority'));
    ELSE
        v_result := jsonb_set(v_result, '{priority}', v_defaults->'priority');
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================
-- 4. LEDGER WRITER
-- ============================================
-- Internal. Inserts one event with the group's current weight snapshotted into
-- points (p_points overrides, used by admin_adjustment). Idempotent through the
-- unique index; returns TRUE only when a row was actually inserted. A new no_show
-- arms the member's signup cooldown when scoring is enabled and the group turned
-- no_show_cooldown on (§5.2). Callers are responsible for recompute_member_score.

CREATE OR REPLACE FUNCTION insert_member_event(
    p_group_id UUID,
    p_player_id UUID,
    p_match_id UUID,
    p_subject_id UUID,
    p_type member_event_type,
    p_source member_event_source,
    p_reported_by UUID DEFAULT NULL,
    p_note TEXT DEFAULT NULL,
    p_points SMALLINT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_settings JSONB;
    v_points SMALLINT;
    v_id UUID;
BEGIN
    IF p_group_id IS NULL OR p_player_id IS NULL THEN
        RETURN FALSE;
    END IF;
    v_settings := member_scoring_settings(p_group_id);
    v_points := COALESCE(p_points, NULLIF(v_settings->'weights'->>p_type::text, '')::smallint, 0);

    INSERT INTO public.member_events (group_id, player_id, match_id, subject_id, type, points, source, reported_by, note)
    VALUES (p_group_id, p_player_id, p_match_id, p_subject_id, p_type, v_points, p_source, p_reported_by, p_note)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF p_type = 'no_show'
       AND COALESCE((v_settings->>'enabled')::boolean, false)
       AND COALESCE((v_settings->>'no_show_cooldown')::boolean, false) THEN
        UPDATE public.group_memberships
        SET signup_cooldown = TRUE
        WHERE group_id = p_group_id AND player_id = p_player_id;
    END IF;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. RECOMPUTE
-- ============================================
-- Window = the group's last window_matches finished matches by date_time. Ratios:
--   asistencia    played / (played + no_shows)
--   aviso         (played + early) / (played + early + late), 1.0 without history.
--                 Cancels count as soon as they happen: early_cancel / late_cancel
--                 rows are read from the window's matches AND from every later
--                 non-cancelled match (any non-cancelled match while the group has
--                 no finished match), so a late cancel on an upcoming match lowers
--                 the score at once and an admin-cancelled match neutralizes it.
--                 Attendance, conduct and participation stay finished-only.
--   puntualidad   (played - late arrivals) / played
--   reglas        (played - matches with wrong_jersey or unreversed unpaid) / played
--   participacion (participated matches + newcomers rated) /
--                 (eligible matches + newcomer opportunities), where a played match
--                 is eligible once its results window closed or the member already
--                 participated (§3.1), and a newcomer opportunity is a
--                 rate_new_member notification of the group inside the window span.
-- overall = 1 + 4 * Σ(dimension_weight * ratio), plus admin adjustments as
-- points / 20 stars, clamped to [1, 5]. Adjustments count while they are newer than
-- the oldest window match (all of them while the group has no finished matches),
-- so they roll off like everything else. Fewer than min_matches_for_score played
-- matches -> member_score NULL, is_new true. Crossing priority.threshold in either
-- direction writes an in-app member_score_dropped / member_score_recovered
-- notification (direct INSERT: never the WhatsApp outbox) when scoring is enabled.

CREATE OR REPLACE FUNCTION recompute_member_score(p_group_id UUID, p_player_id UUID)
RETURNS void AS $$
DECLARE
    v_settings JSONB;
    v_membership public.group_memberships;
    v_group_name TEXT;
    v_window INTEGER;
    v_min INTEGER;
    v_enabled BOOLEAN;
    v_threshold NUMERIC;
    v_match_ids UUID[];
    v_cancel_ids UUID[];
    v_oldest TIMESTAMPTZ;
    v_window_days INTEGER;
    v_played INTEGER;
    v_no_shows INTEGER;
    v_early INTEGER;
    v_late INTEGER;
    v_late_arrivals INTEGER;
    v_wrong_jersey INTEGER;
    v_unpaid INTEGER;
    v_flagged INTEGER;
    v_eligible INTEGER;
    v_participated INTEGER;
    v_reported INTEGER;
    v_rated INTEGER;
    v_voted INTEGER;
    v_newcomers_eligible INTEGER;
    v_newcomers_rated INTEGER;
    v_adj_points INTEGER;
    v_raw_points INTEGER;
    v_r_asistencia NUMERIC;
    v_r_aviso NUMERIC;
    v_r_puntualidad NUMERIC;
    v_r_reglas NUMERIC;
    v_r_participacion NUMERIC;
    v_overall NUMERIC;
    v_score DECIMAL(3,2);
    v_is_new BOOLEAN;
    v_breakdown JSONB;
    v_prev NUMERIC;
    v_next NUMERIC;
BEGIN
    SELECT * INTO v_membership
    FROM public.group_memberships
    WHERE group_id = p_group_id AND player_id = p_player_id
    FOR UPDATE;
    IF v_membership IS NULL THEN
        RETURN;
    END IF;

    v_settings := member_scoring_settings(p_group_id);
    v_window := GREATEST(1, COALESCE((v_settings->>'window_matches')::integer, 10));
    v_min := GREATEST(0, COALESCE((v_settings->>'min_matches_for_score')::integer, 3));
    v_enabled := COALESCE((v_settings->>'enabled')::boolean, false);
    v_threshold := COALESCE((v_settings->'priority'->>'threshold')::numeric, 3.0);

    SELECT COALESCE(ns.results_window_days, 7) INTO v_window_days
    FROM public.notification_settings ns WHERE ns.group_id = p_group_id;
    v_window_days := COALESCE(v_window_days, 7);

    SELECT array_agg(w.id), MIN(w.date_time)
    INTO v_match_ids, v_oldest
    FROM (
        SELECT m.id, m.date_time
        FROM public.matches m
        WHERE m.group_id = p_group_id AND m.status = 'finished'
        ORDER BY m.date_time DESC
        LIMIT v_window
    ) w;
    v_match_ids := COALESCE(v_match_ids, ARRAY[]::UUID[]);

    -- Cancels also count on every later, not-cancelled match (upcoming ones included).
    SELECT COALESCE(array_agg(m.id), ARRAY[]::UUID[]) INTO v_cancel_ids
    FROM public.matches m
    WHERE m.group_id = p_group_id AND m.status <> 'cancelled'
    AND (v_oldest IS NULL OR m.date_time > v_oldest);

    -- Attendance, cancels, conduct.
    SELECT
        COUNT(DISTINCT e.match_id) FILTER (WHERE e.type = 'attended'),
        COUNT(DISTINCT e.match_id) FILTER (WHERE e.type = 'no_show'),
        COUNT(DISTINCT e.match_id) FILTER (WHERE e.type = 'early_cancel'),
        COUNT(DISTINCT e.match_id) FILTER (WHERE e.type = 'late_cancel'),
        COUNT(DISTINCT e.match_id) FILTER (WHERE e.type = 'arrived_late'),
        COUNT(DISTINCT e.match_id) FILTER (WHERE e.type = 'wrong_jersey'),
        COUNT(DISTINCT e.match_id) FILTER (WHERE e.type = 'unpaid' AND NOT EXISTS (
            SELECT 1 FROM public.member_events p
            WHERE p.group_id = e.group_id AND p.player_id = e.player_id
            AND p.match_id = e.match_id AND p.type = 'paid'
        )),
        COUNT(DISTINCT e.match_id) FILTER (WHERE e.type = 'wrong_jersey' OR (e.type = 'unpaid' AND NOT EXISTS (
            SELECT 1 FROM public.member_events p
            WHERE p.group_id = e.group_id AND p.player_id = e.player_id
            AND p.match_id = e.match_id AND p.type = 'paid'
        ))),
        COUNT(DISTINCT e.match_id) FILTER (WHERE e.type = 'reported_result'),
        COUNT(DISTINCT e.match_id) FILTER (WHERE e.type = 'rated_teammates'),
        COUNT(DISTINCT e.match_id) FILTER (WHERE e.type = 'voted_mvp'),
        COALESCE(SUM(e.points), 0)
    INTO v_played, v_no_shows, v_early, v_late, v_late_arrivals, v_wrong_jersey, v_unpaid, v_flagged,
         v_reported, v_rated, v_voted, v_raw_points
    FROM public.member_events e
    WHERE e.group_id = p_group_id AND e.player_id = p_player_id
    AND (e.match_id = ANY(v_match_ids)
         OR (e.type IN ('early_cancel', 'late_cancel') AND e.match_id = ANY(v_cancel_ids)));

    -- Participación over played matches (§3.1).
    SELECT
        COUNT(*) FILTER (WHERE x.closed OR x.participated),
        COUNT(*) FILTER (WHERE x.participated)
    INTO v_eligible, v_participated
    FROM (
        SELECT m.id,
               (m.date_time + (v_window_days || ' days')::interval) < now() AS closed,
               EXISTS (
                   SELECT 1 FROM public.member_events p
                   WHERE p.group_id = p_group_id AND p.player_id = p_player_id AND p.match_id = m.id
                   AND p.type IN ('reported_result', 'rated_teammates', 'voted_mvp')
               ) AS participated
        FROM public.matches m
        WHERE m.id = ANY(v_match_ids)
        AND EXISTS (
            SELECT 1 FROM public.member_events a
            WHERE a.group_id = p_group_id AND a.player_id = p_player_id AND a.match_id = m.id
            AND a.type = 'attended'
        )
    ) x;

    -- Newcomer opportunities inside the window span. Same rule as matches (§3.1,
    -- §7): an opportunity enters the denominator once the member rated/skipped the
    -- newcomer or once the 14-day deadline passed, never before.
    IF v_oldest IS NOT NULL THEN
        SELECT
            COUNT(*) FILTER (WHERE x.rated OR x.expired),
            COUNT(*) FILTER (WHERE x.rated)
        INTO v_newcomers_eligible, v_newcomers_rated
        FROM (
            SELECT
                EXISTS (
                    SELECT 1 FROM public.peer_ratings pr
                    WHERE pr.group_id = p_group_id
                    AND pr.voter_player_id = p_player_id
                    AND pr.rated_player_id::text = n.payload->>'player_id'
                    AND pr.created_at >= n.created_at
                    AND pr.created_at <= n.created_at + interval '14 days'
                ) AS rated,
                (n.created_at + interval '14 days' < now()) AS expired
            FROM public.notifications n
            WHERE n.group_id = p_group_id
            AND n.type = 'rate_new_member'
            AND n.created_at >= v_oldest AND n.created_at <= now()
            AND n.payload->>'player_id' IS DISTINCT FROM p_player_id::text
        ) x;
    ELSE
        v_newcomers_eligible := 0;
        v_newcomers_rated := 0;
    END IF;

    -- Admin adjustments newer than the window's oldest match.
    SELECT COALESCE(SUM(e.points), 0) INTO v_adj_points
    FROM public.member_events e
    WHERE e.group_id = p_group_id AND e.player_id = p_player_id
    AND e.type = 'admin_adjustment'
    AND (v_oldest IS NULL OR e.created_at >= v_oldest);
    v_raw_points := v_raw_points + v_adj_points;

    v_r_asistencia := CASE WHEN v_played + v_no_shows > 0 THEN v_played::numeric / (v_played + v_no_shows) ELSE 1 END;
    v_r_aviso := CASE WHEN v_played + v_early + v_late > 0
        THEN (v_played + v_early)::numeric / (v_played + v_early + v_late) ELSE 1 END;
    v_r_puntualidad := CASE WHEN v_played > 0 THEN GREATEST(0, v_played - v_late_arrivals)::numeric / v_played ELSE 1 END;
    v_r_reglas := CASE WHEN v_played > 0 THEN GREATEST(0, v_played - v_flagged)::numeric / v_played ELSE 1 END;
    v_r_participacion := CASE WHEN v_eligible + v_newcomers_eligible > 0
        THEN (v_participated + v_newcomers_rated)::numeric / (v_eligible + v_newcomers_eligible) ELSE 1 END;

    v_overall := 1 + 4 * (
        COALESCE((v_settings->'dimensions'->>'asistencia')::numeric, 0.40) * v_r_asistencia
        + COALESCE((v_settings->'dimensions'->>'aviso')::numeric, 0.20) * v_r_aviso
        + COALESCE((v_settings->'dimensions'->>'puntualidad')::numeric, 0.15) * v_r_puntualidad
        + COALESCE((v_settings->'dimensions'->>'reglas')::numeric, 0.10) * v_r_reglas
        + COALESCE((v_settings->'dimensions'->>'participacion')::numeric, 0.15) * v_r_participacion
    );
    v_overall := v_overall + v_adj_points::numeric / 20;
    v_overall := GREATEST(1, LEAST(5, v_overall));

    v_is_new := v_played < v_min;
    v_score := CASE WHEN v_is_new THEN NULL ELSE ROUND(v_overall, 2)::DECIMAL(3,2) END;

    v_breakdown := jsonb_build_object(
        'window_matches', v_window,
        'played', v_played,
        'is_new', v_is_new,
        'asistencia', jsonb_build_object('ratio', ROUND(v_r_asistencia, 4), 'played', v_played, 'no_shows', v_no_shows),
        'aviso', jsonb_build_object('ratio', ROUND(v_r_aviso, 4), 'played', v_played, 'early', v_early, 'late', v_late),
        'puntualidad', jsonb_build_object('ratio', ROUND(v_r_puntualidad, 4), 'late_arrivals', v_late_arrivals),
        'reglas', jsonb_build_object('ratio', ROUND(v_r_reglas, 4), 'wrong_jersey', v_wrong_jersey, 'unpaid', v_unpaid),
        'participacion', jsonb_build_object(
            'ratio', ROUND(v_r_participacion, 4), 'eligible', v_eligible, 'participated', v_participated,
            'reported', v_reported, 'rated', v_rated, 'voted_mvp', v_voted,
            'newcomers_eligible', v_newcomers_eligible, 'newcomers_rated', v_newcomers_rated
        ),
        'adjustments', ROUND(v_adj_points::numeric / 20, 2),
        'adjustment_points', v_adj_points,
        'raw_points', v_raw_points
    );

    -- Threshold crossing (NULL counts as the threshold on both sides, §3 newcomers).
    IF v_enabled THEN
        v_prev := COALESCE(v_membership.member_score, v_threshold);
        v_next := COALESCE(v_score, v_threshold);
        IF v_prev >= v_threshold AND v_next < v_threshold THEN
            SELECT name INTO v_group_name FROM public.groups WHERE id = p_group_id;
            INSERT INTO public.notifications (group_id, match_id, recipient_player_id, type, payload)
            VALUES (p_group_id, NULL, p_player_id, 'member_score_dropped', jsonb_build_object(
                'group_id', p_group_id, 'group_name', v_group_name,
                'score', v_score, 'previous_score', v_membership.member_score,
                'threshold', v_threshold, 'breakdown', v_breakdown
            ));
        ELSIF v_prev < v_threshold AND v_next >= v_threshold THEN
            SELECT name INTO v_group_name FROM public.groups WHERE id = p_group_id;
            INSERT INTO public.notifications (group_id, match_id, recipient_player_id, type, payload)
            VALUES (p_group_id, NULL, p_player_id, 'member_score_recovered', jsonb_build_object(
                'group_id', p_group_id, 'group_name', v_group_name,
                'score', v_score, 'previous_score', v_membership.member_score,
                'threshold', v_threshold, 'breakdown', v_breakdown
            ));
        END IF;
    END IF;

    UPDATE public.group_memberships
    SET member_score = v_score,
        member_breakdown = v_breakdown,
        member_score_at = now()
    WHERE id = v_membership.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION recompute_group_member_scores(p_group_id UUID)
RETURNS void AS $$
BEGIN
    PERFORM recompute_member_score(gm.group_id, gm.player_id)
    FROM public.group_memberships gm
    WHERE gm.group_id = p_group_id AND gm.is_active = TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. EMITTERS
-- ============================================

-- Attendance for a finished match: attended for every confirmed registered signup,
-- no_show for did_not_show; attendance rows that no longer match the signup's
-- status (a no-show reverted, a signup cancelled after the fact) are deleted, so
-- admin_set_signup_status can swap attended <-> no_show by calling this. A reverted
-- no_show also disarms the member's signup cooldown (§5.2). Recomputes every
-- registered player who has a signup on the match. No-op unless finished.
CREATE OR REPLACE FUNCTION emit_attendance_events(p_match_id UUID)
RETURNS void AS $$
DECLARE
    v_match public.matches;
    r RECORD;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL OR v_match.status <> 'finished' THEN
        RETURN;
    END IF;

    WITH deleted AS (
        DELETE FROM public.member_events e
        WHERE e.match_id = p_match_id
        AND e.type IN ('attended', 'no_show')
        AND NOT EXISTS (
            SELECT 1 FROM public.match_signups ms
            WHERE ms.match_id = p_match_id AND ms.player_id = e.player_id
            AND ((ms.status = 'confirmed' AND e.type = 'attended')
              OR (ms.status = 'did_not_show' AND e.type = 'no_show'))
        )
        RETURNING e.group_id, e.player_id, e.type
    )
    UPDATE public.group_memberships gm
    SET signup_cooldown = FALSE
    FROM deleted d
    WHERE d.type = 'no_show' AND gm.group_id = d.group_id AND gm.player_id = d.player_id
    AND gm.signup_cooldown;

    FOR r IN
        SELECT ms.player_id, ms.status
        FROM public.match_signups ms
        WHERE ms.match_id = p_match_id AND ms.player_id IS NOT NULL
        AND ms.status IN ('confirmed', 'did_not_show')
    LOOP
        PERFORM insert_member_event(
            v_match.group_id, r.player_id, p_match_id, NULL,
            CASE WHEN r.status = 'confirmed' THEN 'attended' ELSE 'no_show' END::member_event_type,
            'system'
        );
    END LOOP;

    PERFORM recompute_member_score(v_match.group_id, ms.player_id)
    FROM (
        SELECT DISTINCT s.player_id FROM public.match_signups s
        WHERE s.match_id = p_match_id AND s.player_id IS NOT NULL
    ) ms;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Same reconciliation for one player across every finished match they signed up
-- for. Used by recompute_player_stats (which is per player, not per match) in place
-- of the old update_player_reliability call.
CREATE OR REPLACE FUNCTION emit_player_attendance_events(p_player_id UUID)
RETURNS void AS $$
DECLARE
    r RECORD;
BEGIN
    WITH deleted AS (
        DELETE FROM public.member_events e
        WHERE e.player_id = p_player_id
        AND e.type IN ('attended', 'no_show')
        AND NOT EXISTS (
            SELECT 1 FROM public.match_signups ms
            JOIN public.matches m ON m.id = ms.match_id
            WHERE ms.match_id = e.match_id AND ms.player_id = e.player_id AND m.status = 'finished'
            AND ((ms.status = 'confirmed' AND e.type = 'attended')
              OR (ms.status = 'did_not_show' AND e.type = 'no_show'))
        )
        RETURNING e.group_id, e.type
    )
    UPDATE public.group_memberships gm
    SET signup_cooldown = FALSE
    FROM deleted d
    WHERE d.type = 'no_show' AND gm.group_id = d.group_id AND gm.player_id = p_player_id
    AND gm.signup_cooldown;

    FOR r IN
        SELECT m.group_id, ms.match_id, ms.status
        FROM public.match_signups ms
        JOIN public.matches m ON m.id = ms.match_id
        WHERE ms.player_id = p_player_id AND m.status = 'finished'
        AND ms.status IN ('confirmed', 'did_not_show')
    LOOP
        PERFORM insert_member_event(
            r.group_id, p_player_id, r.match_id, NULL,
            CASE WHEN r.status = 'confirmed' THEN 'attended' ELSE 'no_show' END::member_event_type,
            'system'
        );
    END LOOP;

    PERFORM recompute_member_score(gm.group_id, p_player_id)
    FROM public.group_memberships gm
    WHERE gm.player_id = p_player_id AND gm.is_active = TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Cancel by a registered player while the match is still ahead: late_cancel inside
-- the group's late_cancel_hours, early_cancel otherwise. Guests emit nothing.
CREATE OR REPLACE FUNCTION emit_cancel_event(p_match_id UUID, p_player_id UUID)
RETURNS void AS $$
DECLARE
    v_match public.matches;
    v_hours NUMERIC;
    v_type member_event_type;
BEGIN
    IF p_player_id IS NULL THEN
        RETURN;
    END IF;
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL OR v_match.status IN ('finished', 'cancelled') THEN
        RETURN;
    END IF;
    v_hours := COALESCE((member_scoring_settings(v_match.group_id)->>'late_cancel_hours')::numeric, 6);
    v_type := CASE WHEN now() > v_match.date_time - (v_hours || ' hours')::interval
                   THEN 'late_cancel' ELSE 'early_cancel' END;
    -- A re-signup followed by another cancel replaces the previous verdict.
    DELETE FROM public.member_events
    WHERE group_id = v_match.group_id AND player_id = p_player_id AND match_id = p_match_id
    AND type IN ('late_cancel', 'early_cancel') AND type <> v_type;
    PERFORM insert_member_event(v_match.group_id, p_player_id, p_match_id, NULL, v_type, 'system');
    PERFORM recompute_member_score(v_match.group_id, p_player_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- rated_teammates exists iff the voter has at least one match_ratings row for the match.
CREATE OR REPLACE FUNCTION trg_member_events_from_match_ratings()
RETURNS TRIGGER AS $$
DECLARE
    v_match_id UUID;
    v_voter UUID;
    v_group_id UUID;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_match_id := NEW.match_id; v_voter := NEW.voter_player_id;
    ELSE
        v_match_id := OLD.match_id; v_voter := OLD.voter_player_id;
    END IF;
    SELECT group_id INTO v_group_id FROM public.matches WHERE id = v_match_id;
    IF v_group_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM public.match_ratings WHERE match_id = v_match_id AND voter_player_id = v_voter) THEN
        PERFORM insert_member_event(v_group_id, v_voter, v_match_id, NULL, 'rated_teammates', 'system');
    ELSE
        DELETE FROM public.member_events
        WHERE group_id = v_group_id AND player_id = v_voter AND match_id = v_match_id AND type = 'rated_teammates';
    END IF;
    PERFORM recompute_member_score(v_group_id, v_voter);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS member_events_from_match_ratings ON public.match_ratings;
CREATE TRIGGER member_events_from_match_ratings
    AFTER INSERT OR DELETE ON public.match_ratings
    FOR EACH ROW EXECUTE FUNCTION trg_member_events_from_match_ratings();

-- voted_mvp exists iff the voter has a match_mvp_votes row for the match.
CREATE OR REPLACE FUNCTION trg_member_events_from_mvp_votes()
RETURNS TRIGGER AS $$
DECLARE
    v_match_id UUID;
    v_voter UUID;
    v_group_id UUID;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_match_id := NEW.match_id; v_voter := NEW.voter_player_id;
    ELSE
        v_match_id := OLD.match_id; v_voter := OLD.voter_player_id;
    END IF;
    SELECT group_id INTO v_group_id FROM public.matches WHERE id = v_match_id;
    IF v_group_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM public.match_mvp_votes WHERE match_id = v_match_id AND voter_player_id = v_voter) THEN
        PERFORM insert_member_event(v_group_id, v_voter, v_match_id, NULL, 'voted_mvp', 'system');
    ELSE
        DELETE FROM public.member_events
        WHERE group_id = v_group_id AND player_id = v_voter AND match_id = v_match_id AND type = 'voted_mvp';
    END IF;
    PERFORM recompute_member_score(v_group_id, v_voter);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS member_events_from_mvp_votes ON public.match_mvp_votes;
CREATE TRIGGER member_events_from_mvp_votes
    AFTER INSERT OR DELETE ON public.match_mvp_votes
    FOR EACH ROW EXECUTE FUNCTION trg_member_events_from_mvp_votes();

-- rated_new_member (rated or skipped) when a rate_new_member notification for the
-- rated player exists in the group within the last 14 days.
CREATE OR REPLACE FUNCTION trg_member_events_from_peer_ratings()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.group_id = NEW.group_id
        AND n.type = 'rate_new_member'
        AND n.payload->>'player_id' = NEW.rated_player_id::text
        AND n.created_at >= now() - interval '14 days'
    ) THEN
        PERFORM insert_member_event(NEW.group_id, NEW.voter_player_id, NULL, NEW.rated_player_id, 'rated_new_member', 'system');
        PERFORM recompute_member_score(NEW.group_id, NEW.voter_player_id);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS member_events_from_peer_ratings ON public.peer_ratings;
CREATE TRIGGER member_events_from_peer_ratings
    AFTER INSERT ON public.peer_ratings
    FOR EACH ROW EXECUTE FUNCTION trg_member_events_from_peer_ratings();

-- signup_opened_at: stamped the first time a match reaches signup_open (same
-- pattern as matches_set_finished_at).
CREATE OR REPLACE FUNCTION trg_matches_set_signup_opened_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'signup_open' AND NEW.signup_opened_at IS NULL THEN
        NEW.signup_opened_at := now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS matches_set_signup_opened_at ON public.matches;
CREATE TRIGGER matches_set_signup_opened_at
    BEFORE INSERT OR UPDATE OF status ON public.matches
    FOR EACH ROW EXECUTE FUNCTION trg_matches_set_signup_opened_at();

-- ============================================
-- 7. ADMIN / CAPTAIN RPCs
-- ============================================

-- Admins always; captains when captains_can_report (default true).
CREATE OR REPLACE FUNCTION can_report_member_conduct(p_group_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    IF is_group_admin(p_group_id) THEN
        RETURN TRUE;
    END IF;
    RETURN is_group_admin_or_captain(p_group_id)
        AND COALESCE((member_scoring_settings(p_group_id)->>'captains_can_report')::boolean, true);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Conduct check (§4.2): one toggle per (match, player, flag). p_on = false deletes
-- every row of that type for the pair regardless of who reported it, so anyone with
-- the role can correct a flag; unpaid off also clears any 'paid' ledger row.
CREATE OR REPLACE FUNCTION set_conduct_flag(
    p_match_id UUID,
    p_player_id UUID,
    p_type member_event_type,
    p_on BOOLEAN
)
RETURNS void AS $$
DECLARE
    v_match public.matches;
    v_reporter UUID;
BEGIN
    IF p_type NOT IN ('arrived_late', 'wrong_jersey', 'unpaid') THEN
        RAISE EXCEPTION 'Tipo de marca inválido';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;
    IF NOT can_report_member_conduct(v_match.group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para esta acción';
    END IF;
    IF v_match.status <> 'finished' THEN
        RAISE EXCEPTION 'El partido todavía no terminó';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.match_signups ms
        WHERE ms.match_id = p_match_id AND ms.player_id = p_player_id AND ms.status = 'confirmed'
    ) THEN
        RAISE EXCEPTION 'El jugador no jugó este partido';
    END IF;

    v_reporter := get_current_player_id();

    IF COALESCE(p_on, false) THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.member_events
            WHERE group_id = v_match.group_id AND player_id = p_player_id
            AND match_id = p_match_id AND type = p_type
        ) THEN
            PERFORM insert_member_event(v_match.group_id, p_player_id, p_match_id, NULL, p_type, 'admin', v_reporter);
        END IF;
        IF p_type = 'unpaid' THEN
            DELETE FROM public.member_events
            WHERE group_id = v_match.group_id AND player_id = p_player_id
            AND match_id = p_match_id AND type = 'paid';
        END IF;
    ELSE
        DELETE FROM public.member_events
        WHERE group_id = v_match.group_id AND player_id = p_player_id
        AND match_id = p_match_id
        AND (type = p_type OR (p_type = 'unpaid' AND type = 'paid'));
    END IF;

    PERFORM recompute_member_score(v_match.group_id, p_player_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Escape hatch and dispute path (§4.4): admin only, note required, ±20 points
-- (= ±1 star) per adjustment.
CREATE OR REPLACE FUNCTION admin_adjust_member_score(
    p_group_id UUID,
    p_player_id UUID,
    p_points SMALLINT,
    p_note TEXT
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    IF NOT is_group_admin(p_group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para esta acción';
    END IF;
    IF p_note IS NULL OR btrim(p_note) = '' THEN
        RAISE EXCEPTION 'El ajuste necesita una nota';
    END IF;
    IF p_points IS NULL OR p_points = 0 OR p_points NOT BETWEEN -20 AND 20 THEN
        RAISE EXCEPTION 'Los puntos deben estar entre -20 y 20';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.group_memberships
        WHERE group_id = p_group_id AND player_id = p_player_id
    ) THEN
        RAISE EXCEPTION 'El jugador no es miembro de este grupo';
    END IF;

    INSERT INTO public.member_events (group_id, player_id, match_id, subject_id, type, points, source, reported_by, note)
    VALUES (p_group_id, p_player_id, NULL, NULL, 'admin_adjustment', p_points, 'admin', get_current_player_id(), btrim(p_note))
    RETURNING id INTO v_id;

    PERFORM recompute_member_score(p_group_id, p_player_id);
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_delete_member_event(p_event_id UUID)
RETURNS void AS $$
DECLARE
    v_event public.member_events;
BEGIN
    SELECT * INTO v_event FROM public.member_events WHERE id = p_event_id;
    IF v_event IS NULL THEN
        RAISE EXCEPTION 'Evento no encontrado';
    END IF;
    IF NOT is_group_admin(v_event.group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para esta acción';
    END IF;

    DELETE FROM public.member_events WHERE id = p_event_id;
    PERFORM recompute_member_score(v_event.group_id, v_event.player_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also the hook the settings page calls after saving: the priority_window_close
-- jobs of the group's open matches are re-dated for the new mode / window_hours
-- (created when scoring was just enabled, cancelled when it was turned off), and
-- when the window is already over (no future job to schedule) the waitlist is
-- reconciled right away through the policy-aware promote_from_waitlist.
CREATE OR REPLACE FUNCTION admin_recompute_member_scores(p_group_id UUID)
RETURNS void AS $$
DECLARE
    r RECORD;
BEGIN
    IF NOT is_group_admin(p_group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para esta acción';
    END IF;
    PERFORM recompute_group_member_scores(p_group_id);

    FOR r IN
        SELECT id FROM public.matches
        WHERE group_id = p_group_id AND status IN ('signup_open', 'full')
        ORDER BY date_time
    LOOP
        PERFORM schedule_match_jobs(r.id);
        IF NOT EXISTS (
            SELECT 1 FROM public.scheduled_jobs
            WHERE match_id = r.id AND job_type = 'priority_window_close' AND status = 'pending'
        ) THEN
            PERFORM run_priority_window_close_job(r.id);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 8. SIGNUP FLOW (00007 / 00012 / 00014 bodies plus the §5 policies)
-- ============================================

-- signup_for_match: same signature and return type as 00007. New: waitlist_reason,
-- the no-show cooldown (§5.2), and the window / reserved priority modes (§5.1).
-- Newcomers (member_score NULL) always qualify for priority.
CREATE OR REPLACE FUNCTION signup_for_match(
    p_match_id UUID,
    p_notes TEXT DEFAULT NULL,
    p_position_preference TEXT DEFAULT NULL
)
RETURNS public.match_signups AS $$
DECLARE
    v_match public.matches;
    v_player_id UUID;
    v_confirmed_count INTEGER;
    v_status signup_status;
    v_waitlist_position SMALLINT;
    v_signup public.match_signups;
    v_reason TEXT;
    v_settings JSONB;
    v_enabled BOOLEAN;
    v_mode TEXT;
    v_threshold NUMERIC;
    v_window_hours NUMERIC;
    v_reserved INTEGER;
    v_score NUMERIC;
    v_cooldown BOOLEAN;
BEGIN
    v_player_id := get_current_player_id();
    IF v_player_id IS NULL THEN
        RAISE EXCEPTION 'Perfil de jugador no encontrado';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    IF NOT is_group_member(v_match.group_id) THEN
        RAISE EXCEPTION 'No sos miembro de este grupo';
    END IF;

    IF v_match.status NOT IN ('signup_open', 'full') THEN
        RAISE EXCEPTION 'El partido no está aceptando inscripciones';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.match_signups
        WHERE match_id = p_match_id AND player_id = v_player_id
        AND status IN ('confirmed', 'waitlist')
    ) THEN
        RAISE EXCEPTION 'Ya estás inscripto en este partido';
    END IF;

    SELECT COUNT(*) INTO v_confirmed_count
    FROM public.match_signups
    WHERE match_id = p_match_id AND status = 'confirmed';

    IF v_confirmed_count < v_match.max_players THEN
        v_status := 'confirmed';
        v_reason := NULL;
    ELSE
        v_status := 'waitlist';
        v_reason := 'full';
    END IF;

    -- Member scoring policies (§5.1, §5.2).
    v_settings := member_scoring_settings(v_match.group_id);
    v_enabled := COALESCE((v_settings->>'enabled')::boolean, false);
    v_mode := COALESCE(v_settings->'priority'->>'mode', 'off');
    v_threshold := COALESCE((v_settings->'priority'->>'threshold')::numeric, 3.0);
    v_window_hours := COALESCE((v_settings->'priority'->>'window_hours')::numeric, 24);
    v_reserved := COALESCE((v_settings->'priority'->>'reserved_spots')::integer, 4);

    SELECT gm.member_score, gm.signup_cooldown INTO v_score, v_cooldown
    FROM public.group_memberships gm
    WHERE gm.group_id = v_match.group_id AND gm.player_id = v_player_id
    FOR UPDATE;

    IF COALESCE(v_cooldown, false) THEN
        -- Consumed once, whether or not the policy is still on.
        UPDATE public.group_memberships SET signup_cooldown = FALSE
        WHERE group_id = v_match.group_id AND player_id = v_player_id;
        IF v_enabled AND COALESCE((v_settings->>'no_show_cooldown')::boolean, false) AND v_status = 'confirmed' THEN
            v_status := 'waitlist';
            v_reason := 'cooldown';
        END IF;
    END IF;

    IF v_enabled AND v_status = 'confirmed' AND v_score IS NOT NULL AND v_score < v_threshold THEN
        IF v_mode = 'window' AND v_match.signup_opened_at IS NOT NULL
           AND now() < v_match.signup_opened_at + (v_window_hours || ' hours')::interval THEN
            v_status := 'waitlist';
            v_reason := 'priority_window';
        ELSIF v_mode = 'reserved'
           AND now() < v_match.date_time - (v_window_hours || ' hours')::interval
           AND v_confirmed_count >= v_match.max_players - v_reserved THEN
            v_status := 'waitlist';
            v_reason := 'reserved';
        END IF;
    END IF;

    IF v_status = 'waitlist' THEN
        SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_waitlist_position
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'waitlist';
    ELSE
        v_waitlist_position := NULL;
    END IF;

    -- Upsert: a player may have a prior 'cancelled' row for this match, which
    -- the (match_id, player_id) unique constraint would otherwise conflict on.
    INSERT INTO public.match_signups (
        match_id, player_id, status, notes, position_preference, waitlist_position, waitlist_reason, signup_time, cancel_time
    )
    VALUES (
        p_match_id, v_player_id, v_status, p_notes, p_position_preference, v_waitlist_position, v_reason, NOW(), NULL
    )
    ON CONFLICT ON CONSTRAINT unique_player_signup
    DO UPDATE SET
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        position_preference = EXCLUDED.position_preference,
        waitlist_position = EXCLUDED.waitlist_position,
        waitlist_reason = EXCLUDED.waitlist_reason,
        signup_time = NOW(),
        cancel_time = NULL
    RETURNING * INTO v_signup;

    IF v_status = 'confirmed' AND v_confirmed_count + 1 >= v_match.max_players THEN
        UPDATE public.matches SET status = 'full' WHERE id = p_match_id;
    END IF;

    RETURN v_signup;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- promote_from_waitlist: 00012 body (emits waitlist_promoted). New: clears
-- waitlist_reason on promotion, in 'waitlist' priority mode picks the
-- highest-scored waitlisted member first (newcomers and guests at the threshold),
-- and honors the same §5.1 decisions signup_for_match makes: rows waitlisted for
-- 'priority_window' are skipped while the window is still open, rows waitlisted
-- for 'reserved' are skipped while the reserved period is active and only the
-- reserved spots are left; 'full' and 'cooldown' rows are always promotable. The
-- first eligible row in (waitlist_position, signup_time) order wins. The match
-- status is only written when it actually changes, so the matches_schedule_jobs
-- trigger does not re-create the window job on every call.
CREATE OR REPLACE FUNCTION promote_from_waitlist(p_match_id UUID)
RETURNS UUID AS $$
DECLARE
    v_match public.matches;
    v_confirmed_count INTEGER;
    v_promoted_id UUID;
    v_promoted_player_id UUID;
    v_promoted_guest_id UUID;
    v_promoted_name TEXT;
    v_settings JSONB;
    v_enabled BOOLEAN;
    v_mode TEXT;
    v_by_score BOOLEAN;
    v_threshold NUMERIC;
    v_window_hours NUMERIC;
    v_reserved INTEGER;
    v_window_open BOOLEAN;
    v_reserved_active BOOLEAN;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*) INTO v_confirmed_count
    FROM public.match_signups
    WHERE match_id = p_match_id AND status = 'confirmed';

    v_promoted_id := NULL;

    IF v_confirmed_count < v_match.max_players THEN
        v_settings := member_scoring_settings(v_match.group_id);
        v_enabled := COALESCE((v_settings->>'enabled')::boolean, false);
        v_mode := COALESCE(v_settings->'priority'->>'mode', 'off');
        v_by_score := v_enabled AND v_mode = 'waitlist';
        v_threshold := COALESCE((v_settings->'priority'->>'threshold')::numeric, 3.0);
        v_window_hours := COALESCE((v_settings->'priority'->>'window_hours')::numeric, 24);
        v_reserved := COALESCE((v_settings->'priority'->>'reserved_spots')::integer, 4);

        -- Same decisions as signup_for_match (§5.1).
        v_window_open := v_enabled AND v_mode = 'window'
            AND v_match.signup_opened_at IS NOT NULL
            AND now() < v_match.signup_opened_at + (v_window_hours || ' hours')::interval;
        v_reserved_active := v_enabled AND v_mode = 'reserved'
            AND now() < v_match.date_time - (v_window_hours || ' hours')::interval
            AND v_confirmed_count >= v_match.max_players - v_reserved;

        IF v_by_score THEN
            SELECT ms.id, ms.player_id, ms.guest_player_id
            INTO v_promoted_id, v_promoted_player_id, v_promoted_guest_id
            FROM public.match_signups ms
            LEFT JOIN public.group_memberships gm
                ON gm.group_id = v_match.group_id AND gm.player_id = ms.player_id
            WHERE ms.match_id = p_match_id AND ms.status = 'waitlist'
            ORDER BY COALESCE(gm.member_score, v_threshold) DESC,
                     ms.waitlist_position ASC NULLS LAST, ms.signup_time ASC
            LIMIT 1;
        ELSE
            SELECT id, player_id, guest_player_id
            INTO v_promoted_id, v_promoted_player_id, v_promoted_guest_id
            FROM public.match_signups
            WHERE match_id = p_match_id AND status = 'waitlist'
            AND NOT (v_window_open AND waitlist_reason = 'priority_window')
            AND NOT (v_reserved_active AND waitlist_reason = 'reserved')
            ORDER BY waitlist_position ASC NULLS LAST, signup_time ASC
            LIMIT 1;
        END IF;

        IF v_promoted_id IS NOT NULL THEN
            UPDATE public.match_signups
            SET status = 'confirmed', waitlist_position = NULL, waitlist_reason = NULL
            WHERE id = v_promoted_id;

            v_confirmed_count := v_confirmed_count + 1;

            -- Reorder remaining waitlist
            WITH numbered AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY waitlist_position ASC NULLS LAST, signup_time ASC) AS new_pos
                FROM public.match_signups
                WHERE match_id = p_match_id AND status = 'waitlist'
            )
            UPDATE public.match_signups ms
            SET waitlist_position = numbered.new_pos
            FROM numbered
            WHERE ms.id = numbered.id;

            IF v_promoted_player_id IS NOT NULL THEN
                SELECT display_name INTO v_promoted_name
                FROM public.player_profiles WHERE id = v_promoted_player_id;
            ELSE
                SELECT display_name INTO v_promoted_name
                FROM public.guest_players WHERE id = v_promoted_guest_id;
            END IF;

            PERFORM emit_notification(
                v_match.group_id,
                p_match_id,
                'waitlist_promoted',
                jsonb_build_object(
                    'signup_id', v_promoted_id,
                    'player_name', v_promoted_name,
                    'recipient_player_id', v_promoted_player_id
                )
            );
        END IF;
    END IF;

    -- Only reconcile status while the match is actively tracking signups, and only
    -- when it actually changes (the UPDATE OF status trigger reschedules jobs).
    IF v_match.status IN ('signup_open', 'full') THEN
        IF v_confirmed_count >= v_match.max_players THEN
            UPDATE public.matches SET status = 'full'
            WHERE id = p_match_id AND status IS DISTINCT FROM 'full';
        ELSE
            UPDATE public.matches SET status = 'signup_open'
            WHERE id = p_match_id AND status IS DISTINCT FROM 'signup_open';
        END IF;
    END IF;

    RETURN v_promoted_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- cancel_my_signup: 00007 body plus the late/early cancel event.
CREATE OR REPLACE FUNCTION cancel_my_signup(p_match_id UUID)
RETURNS void AS $$
DECLARE
    v_player_id UUID;
    v_signup public.match_signups;
BEGIN
    v_player_id := get_current_player_id();
    IF v_player_id IS NULL THEN
        RAISE EXCEPTION 'Perfil de jugador no encontrado';
    END IF;

    SELECT * INTO v_signup
    FROM public.match_signups
    WHERE match_id = p_match_id AND player_id = v_player_id
    AND status IN ('confirmed', 'waitlist')
    FOR UPDATE;

    IF v_signup IS NULL THEN
        RAISE EXCEPTION 'No estás inscripto en este partido';
    END IF;

    UPDATE public.match_signups
    SET status = 'cancelled', cancel_time = NOW()
    WHERE id = v_signup.id;

    PERFORM emit_cancel_event(p_match_id, v_player_id);

    PERFORM promote_from_waitlist(p_match_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- admin_remove_signup: 00007 body plus the cancel event (registered players only).
CREATE OR REPLACE FUNCTION admin_remove_signup(p_signup_id UUID)
RETURNS void AS $$
DECLARE
    v_signup public.match_signups;
    v_match public.matches;
    v_was_confirmed BOOLEAN;
    v_was_waitlist BOOLEAN;
BEGIN
    SELECT * INTO v_signup FROM public.match_signups WHERE id = p_signup_id FOR UPDATE;
    IF v_signup IS NULL THEN
        RAISE EXCEPTION 'Inscripción no encontrada';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = v_signup.match_id;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    IF NOT is_group_admin_or_captain(v_match.group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para esta acción';
    END IF;

    v_was_confirmed := v_signup.status = 'confirmed';
    v_was_waitlist := v_signup.status = 'waitlist';

    UPDATE public.match_signups
    SET status = 'cancelled', cancel_time = NOW()
    WHERE id = p_signup_id;

    IF (v_was_confirmed OR v_was_waitlist) AND v_signup.player_id IS NOT NULL THEN
        PERFORM emit_cancel_event(v_match.id, v_signup.player_id);
    END IF;

    IF v_was_confirmed THEN
        PERFORM promote_from_waitlist(v_match.id);
    ELSIF v_was_waitlist THEN
        -- No one is promoted, but remaining waitlist positions must be reordered
        WITH numbered AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY waitlist_position ASC NULLS LAST, signup_time ASC) AS new_pos
            FROM public.match_signups
            WHERE match_id = v_match.id AND status = 'waitlist'
        )
        UPDATE public.match_signups ms
        SET waitlist_position = numbered.new_pos
        FROM numbered
        WHERE ms.id = numbered.id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- admin_set_signup_status: 00014 body; the reliability recompute becomes
-- emit_attendance_events on finished matches (attended <-> no_show swap).
CREATE OR REPLACE FUNCTION admin_set_signup_status(
    p_signup_id UUID,
    p_status signup_status
)
RETURNS void AS $$
DECLARE
    v_signup public.match_signups;
    v_match public.matches;
    v_was_confirmed BOOLEAN;
BEGIN
    SELECT * INTO v_signup FROM public.match_signups WHERE id = p_signup_id FOR UPDATE;
    IF v_signup IS NULL THEN
        RAISE EXCEPTION 'Inscripción no encontrada';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = v_signup.match_id;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    IF NOT is_group_admin_or_captain(v_match.group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para esta acción';
    END IF;

    v_was_confirmed := v_signup.status = 'confirmed';

    UPDATE public.match_signups
    SET status = p_status,
        cancel_time = CASE WHEN p_status = 'cancelled' THEN NOW() ELSE cancel_time END,
        waitlist_position = CASE WHEN p_status = 'waitlist' THEN waitlist_position ELSE NULL END,
        waitlist_reason = CASE WHEN p_status = 'waitlist' THEN waitlist_reason ELSE NULL END
    WHERE id = p_signup_id;

    -- Only promote while the match is still tracking signups; a no-show on a finished
    -- match must not pull someone off the waitlist.
    IF v_was_confirmed AND p_status != 'confirmed'
       AND v_match.status IN ('signup_open', 'full', 'signup_closed') THEN
        PERFORM promote_from_waitlist(v_match.id);
    END IF;

    IF v_match.status = 'finished' THEN
        PERFORM emit_attendance_events(v_match.id);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- admin_set_match_status: 00007 body plus attendance events when the new status
-- is finished (the score does not wait for results consensus), and a recompute of
-- the members with cancel events when the match is cancelled (those events stop
-- counting, see recompute_member_score).
CREATE OR REPLACE FUNCTION admin_set_match_status(
    p_match_id UUID,
    p_status match_status
)
RETURNS public.matches AS $$
DECLARE
    v_match public.matches;
    v_valid BOOLEAN := FALSE;
    v_final_status match_status;
    v_confirmed_count INTEGER;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    IF NOT is_group_admin_or_captain(v_match.group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para esta acción';
    END IF;

    IF p_status = v_match.status THEN
        RETURN v_match;
    END IF;

    -- Validate transitions per docs/rework-plan.md §1:
    -- draft -> signup_open <-> signup_closed; signup_open <-> full (automatic
    -- on count); any of signup_open/full/signup_closed -> teams_created;
    -- teams_created -> finished; any non-finished -> cancelled.
    CASE v_match.status
        WHEN 'draft' THEN
            v_valid := p_status IN ('signup_open', 'cancelled');
        WHEN 'signup_open' THEN
            v_valid := p_status IN ('signup_closed', 'full', 'teams_created', 'cancelled');
        WHEN 'full' THEN
            v_valid := p_status IN ('signup_closed', 'signup_open', 'teams_created', 'cancelled');
        WHEN 'signup_closed' THEN
            v_valid := p_status IN ('signup_open', 'teams_created', 'cancelled');
        WHEN 'teams_created' THEN
            v_valid := p_status IN ('finished', 'cancelled');
        ELSE
            v_valid := FALSE;
    END CASE;

    IF NOT v_valid THEN
        RAISE EXCEPTION 'Transición de estado inválida: % -> %', v_match.status, p_status;
    END IF;

    v_final_status := p_status;

    -- Reopening always targets signup_open in the UI, but if the match is
    -- already at capacity the real status is 'full'.
    IF p_status = 'signup_open' THEN
        SELECT COUNT(*) INTO v_confirmed_count
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'confirmed';

        IF v_confirmed_count >= v_match.max_players THEN
            v_final_status := 'full';
        END IF;
    END IF;

    UPDATE public.matches SET status = v_final_status WHERE id = p_match_id
    RETURNING * INTO v_match;

    IF v_final_status = 'finished' THEN
        PERFORM emit_attendance_events(p_match_id);
    ELSIF v_final_status = 'cancelled' THEN
        PERFORM recompute_member_score(v_match.group_id, x.player_id)
        FROM (
            SELECT DISTINCT e.player_id FROM public.member_events e
            WHERE e.match_id = p_match_id AND e.type IN ('early_cancel', 'late_cancel')
        ) x;
    END IF;

    RETURN v_match;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 9. REPORTS (00020 bodies plus the reported_result event)
-- ============================================

CREATE OR REPLACE FUNCTION submit_match_report(
    p_match_id UUID,
    p_dark_score INTEGER,
    p_light_score INTEGER,
    p_dark_goals_complete BOOLEAN,
    p_light_goals_complete BOOLEAN,
    p_mvp_candidate_id UUID,
    p_stats JSONB
)
RETURNS UUID AS $$
DECLARE
    v_match public.matches;
    v_player_id UUID;
    v_report_id UUID;
    v_stat JSONB;
    v_team_id UUID;
    v_pid UUID;
    v_gid UUID;
    v_goals INTEGER;
    v_assists INTEGER;
    v_stat_rows INTEGER := 0;
    v_after_lock BOOLEAN;
BEGIN
    v_player_id := get_current_player_id();
    IF v_player_id IS NULL THEN
        RAISE EXCEPTION 'No tenés perfil de jugador';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;
    IF v_match.status <> 'finished' THEN
        RAISE EXCEPTION 'El partido todavía no terminó';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.match_signups ms
        WHERE ms.match_id = p_match_id AND ms.player_id = v_player_id AND ms.status = 'confirmed'
    ) THEN
        RAISE EXCEPTION 'No jugaste este partido';
    END IF;
    IF NOT match_report_window_open(p_match_id) THEN
        RAISE EXCEPTION 'La ventana para reportar cerró';
    END IF;
    IF p_mvp_candidate_id IS NOT NULL THEN
        IF p_mvp_candidate_id = v_player_id THEN
            RAISE EXCEPTION 'No podés votarte a vos mismo';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.match_signups ms
            WHERE ms.match_id = p_match_id AND ms.player_id = p_mvp_candidate_id AND ms.status = 'confirmed'
        ) THEN
            RAISE EXCEPTION 'El MVP tiene que haber jugado este partido';
        END IF;
    END IF;
    IF (p_dark_score IS NOT NULL AND p_dark_score NOT BETWEEN 0 AND 99)
       OR (p_light_score IS NOT NULL AND p_light_score NOT BETWEEN 0 AND 99) THEN
        RAISE EXCEPTION 'Resultado inválido';
    END IF;

    v_after_lock := (v_match.result_status = 'locked');

    INSERT INTO public.match_reports (
        match_id, reporter_player_id, dark_score, light_score,
        dark_goals_complete, light_goals_complete, mvp_candidate_id, submitted_after_lock
    )
    VALUES (
        p_match_id, v_player_id, p_dark_score, p_light_score,
        COALESCE(p_dark_goals_complete, FALSE), COALESCE(p_light_goals_complete, FALSE),
        p_mvp_candidate_id, v_after_lock
    )
    ON CONFLICT (match_id, reporter_player_id) DO UPDATE SET
        dark_score = EXCLUDED.dark_score,
        light_score = EXCLUDED.light_score,
        dark_goals_complete = EXCLUDED.dark_goals_complete,
        light_goals_complete = EXCLUDED.light_goals_complete,
        mvp_candidate_id = EXCLUDED.mvp_candidate_id,
        submitted_after_lock = EXCLUDED.submitted_after_lock
    RETURNING id INTO v_report_id;

    DELETE FROM public.match_report_stats WHERE report_id = v_report_id;

    IF p_stats IS NOT NULL AND jsonb_typeof(p_stats) = 'array' THEN
        FOR v_stat IN SELECT * FROM jsonb_array_elements(p_stats) LOOP
            v_team_id := NULLIF(v_stat->>'team_id', '')::UUID;
            v_pid := NULLIF(v_stat->>'player_id', '')::UUID;
            v_gid := NULLIF(v_stat->>'guest_player_id', '')::UUID;
            v_goals := GREATEST(0, COALESCE((v_stat->>'goals')::INTEGER, 0));
            v_assists := GREATEST(0, COALESCE((v_stat->>'assists')::INTEGER, 0));

            IF v_goals = 0 AND v_assists = 0 THEN
                CONTINUE;
            END IF;
            IF v_team_id IS NULL OR NOT EXISTS (
                SELECT 1 FROM public.teams t WHERE t.id = v_team_id AND t.match_id = p_match_id
            ) THEN
                RAISE EXCEPTION 'Equipo inválido en el reporte';
            END IF;
            IF (v_pid IS NULL) = (v_gid IS NULL) THEN
                RAISE EXCEPTION 'Jugador inválido en el reporte';
            END IF;

            INSERT INTO public.match_report_stats (report_id, team_id, player_id, guest_player_id, goals, assists)
            VALUES (v_report_id, v_team_id, v_pid, v_gid, LEAST(v_goals, 99), LEAST(v_assists, 99))
            ON CONFLICT (report_id, team_id, COALESCE(player_id, guest_player_id)) DO UPDATE SET
                goals = LEAST(99, match_report_stats.goals + EXCLUDED.goals),
                assists = LEAST(99, match_report_stats.assists + EXCLUDED.assists);
            v_stat_rows := v_stat_rows + 1;
        END LOOP;
    END IF;

    IF p_dark_score IS NULL AND p_light_score IS NULL AND p_mvp_candidate_id IS NULL AND v_stat_rows = 0 THEN
        DELETE FROM public.match_reports WHERE id = v_report_id;
        RAISE EXCEPTION 'El reporte está vacío';
    END IF;

    -- MVP vote sync (the votes trigger recomputes the MVP, inert while locked).
    DELETE FROM public.match_mvp_votes WHERE match_id = p_match_id AND voter_player_id = v_player_id;
    IF p_mvp_candidate_id IS NOT NULL THEN
        INSERT INTO public.match_mvp_votes (match_id, voter_player_id, candidate_player_id)
        VALUES (p_match_id, v_player_id, p_mvp_candidate_id);
    END IF;

    -- Member score: a usable report counts as participation (§3.1).
    IF NOT v_after_lock THEN
        PERFORM insert_member_event(v_match.group_id, v_player_id, p_match_id, NULL, 'reported_result', 'system');
    ELSE
        DELETE FROM public.member_events
        WHERE group_id = v_match.group_id AND player_id = v_player_id
        AND match_id = p_match_id AND type = 'reported_result';
    END IF;
    PERFORM recompute_member_score(v_match.group_id, v_player_id);

    IF NOT v_after_lock THEN
        PERFORM recompute_match_consensus(p_match_id);
    END IF;

    RETURN v_report_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION delete_my_match_report(p_match_id UUID)
RETURNS void AS $$
DECLARE
    v_match public.matches;
    v_player_id UUID;
BEGIN
    v_player_id := get_current_player_id();
    IF v_player_id IS NULL THEN
        RAISE EXCEPTION 'No tenés perfil de jugador';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;
    IF NOT match_report_window_open(p_match_id) THEN
        RAISE EXCEPTION 'La ventana para reportar cerró';
    END IF;

    DELETE FROM public.match_reports WHERE match_id = p_match_id AND reporter_player_id = v_player_id;
    DELETE FROM public.match_mvp_votes WHERE match_id = p_match_id AND voter_player_id = v_player_id;

    DELETE FROM public.member_events
    WHERE group_id = v_match.group_id AND player_id = v_player_id
    AND match_id = p_match_id AND type = 'reported_result';
    PERFORM recompute_member_score(v_match.group_id, v_player_id);

    IF v_match.result_status <> 'locked' THEN
        PERFORM recompute_match_consensus(p_match_id);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 10. SCHEDULER (00019 bodies plus priority_window_close)
-- ============================================

-- auto_finish_match: 00019 body plus attendance events.
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
    PERFORM emit_attendance_events(p_match_id);
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- schedule_match_jobs: 00019 body plus priority_window_close for open matches of
-- groups with scoring enabled and priority.mode window (signup_opened_at +
-- window_hours) or reserved (date_time - window_hours). Scheduled for 'full' too:
-- the status flips back to signup_open on a cancel and the trigger only fires on
-- change, so a window job must already exist; the handler is a no-op while full.
-- A window that already closed schedules nothing: promote_from_waitlist applies
-- the policy itself, so re-running a past close job would only churn the queue.
CREATE OR REPLACE FUNCTION schedule_match_jobs(p_match_id UUID)
RETURNS void AS $$
DECLARE
    v_match public.matches;
    v_settings public.notification_settings;
    v_request_at TIMESTAMPTZ;
    v_window_days INTEGER;
    v_reminder_hours INTEGER;
    v_scoring JSONB;
    v_mode TEXT;
    v_window_hours NUMERIC;
    v_window_at TIMESTAMPTZ;
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

        IF v_match.status IN ('signup_open', 'full') THEN
            v_scoring := member_scoring_settings(v_match.group_id);
            v_mode := COALESCE(v_scoring->'priority'->>'mode', 'off');
            v_window_hours := COALESCE((v_scoring->'priority'->>'window_hours')::numeric, 24);
            IF COALESCE((v_scoring->>'enabled')::boolean, false) AND v_mode IN ('window', 'reserved') THEN
                v_window_at := CASE v_mode
                    WHEN 'window' THEN v_match.signup_opened_at + (v_window_hours || ' hours')::interval
                    ELSE v_match.date_time - (v_window_hours || ' hours')::interval
                END;
                IF v_window_at IS NOT NULL AND v_window_at > now() THEN
                    INSERT INTO public.scheduled_jobs (group_id, match_id, job_type, run_at)
                    VALUES (v_match.group_id, p_match_id, 'priority_window_close', v_window_at);
                END IF;
            END IF;
        END IF;
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

-- Window over: promote in (waitlist_position, signup_time) order until full,
-- reusing promote_from_waitlist so the existing waitlist_promoted notifications
-- fire. Returns TRUE when at least one signup was promoted.
CREATE OR REPLACE FUNCTION run_priority_window_close_job(p_match_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_match public.matches;
    v_promoted UUID;
    v_any BOOLEAN := FALSE;
    v_guard INTEGER := 0;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL OR v_match.status NOT IN ('signup_open', 'full') THEN
        RETURN FALSE;
    END IF;

    LOOP
        v_promoted := promote_from_waitlist(p_match_id);
        EXIT WHEN v_promoted IS NULL;
        v_any := TRUE;
        v_guard := v_guard + 1;
        EXIT WHEN v_guard > 500;
    END LOOP;
    RETURN v_any;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- run_scheduled_job: 00019 body plus the priority_window_close branch.
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
            WHEN 'priority_window_close' THEN
                v_ok := run_priority_window_close_job(v_job.match_id);
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
-- 11. STATS AND BADGES (00019 bodies)
-- ============================================

-- recompute_player_stats: update_player_reliability is gone; the attendance ledger
-- and the member score of every group the player belongs to are reconciled instead.
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

    PERFORM emit_player_attendance_events(p_player_id);
    PERFORM update_player_rating(p_player_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- award_badges_for_match: 00019 body plus 'ejemplar' (member_score >= 4.5 with
-- >= 10 played matches in the current breakdown), revoked for this match when the
-- condition no longer holds, same pattern as hat_trick.
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

    -- mvp: only for the current holder, only once the result counts.
    DELETE FROM public.player_badges pb
    WHERE pb.match_id = p_match_id AND pb.badge_type = 'mvp'
    AND (v_match.status <> 'finished'
         OR v_match.result_status NOT IN ('consensus', 'locked')
         OR pb.player_id IS DISTINCT FROM v_match.mvp_player_id);

    IF v_match.status = 'finished' AND v_match.result_status IN ('consensus', 'locked')
       AND v_match.mvp_player_id IS NOT NULL THEN
        INSERT INTO public.player_badges (player_id, badge_type, match_id)
        VALUES (v_match.mvp_player_id, 'mvp', p_match_id)
        ON CONFLICT (player_id, badge_type, match_id) DO NOTHING;
    END IF;

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

    -- ejemplar: members of the group who played this match with a member score of
    -- at least 4.5 over at least 10 played matches.
    DELETE FROM public.player_badges pb
    WHERE pb.match_id = p_match_id AND pb.badge_type = 'ejemplar'
    AND NOT EXISTS (
        SELECT 1 FROM public.group_memberships gm
        WHERE gm.group_id = v_match.group_id AND gm.player_id = pb.player_id
        AND gm.member_score >= 4.5
        AND COALESCE((gm.member_breakdown->>'played')::integer, 0) >= 10
    );

    IF v_match.status = 'finished' THEN
        INSERT INTO public.player_badges (player_id, badge_type, match_id)
        SELECT gm.player_id, 'ejemplar', p_match_id
        FROM public.group_memberships gm
        JOIN public.match_signups ms ON ms.match_id = p_match_id AND ms.player_id = gm.player_id AND ms.status = 'confirmed'
        WHERE gm.group_id = v_match.group_id
        AND gm.member_score >= 4.5
        AND COALESCE((gm.member_breakdown->>'played')::integer, 0) >= 10
        ON CONFLICT (player_id, badge_type, match_id) DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 12. DROP THE OLD RELIABILITY SCORE
-- ============================================

DROP FUNCTION IF EXISTS update_player_reliability(UUID);
ALTER TABLE public.player_profiles DROP COLUMN IF EXISTS reliability_score;

-- ============================================
-- 13. PRIVILEGES (same shape as 00013 / 00019)
-- ============================================

REVOKE ALL ON FUNCTION member_scoring_settings(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION member_scoring_settings(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION can_report_member_conduct(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_report_member_conduct(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION set_conduct_flag(UUID, UUID, member_event_type, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_conduct_flag(UUID, UUID, member_event_type, BOOLEAN) TO authenticated, service_role;
REVOKE ALL ON FUNCTION admin_adjust_member_score(UUID, UUID, SMALLINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_adjust_member_score(UUID, UUID, SMALLINT, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION admin_delete_member_event(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_delete_member_event(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION admin_recompute_member_scores(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_recompute_member_scores(UUID) TO authenticated, service_role;

-- Internal helpers, emitters and job handlers: owner / service_role only.
REVOKE ALL ON FUNCTION insert_member_event(UUID, UUID, UUID, UUID, member_event_type, member_event_source, UUID, TEXT, SMALLINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION insert_member_event(UUID, UUID, UUID, UUID, member_event_type, member_event_source, UUID, TEXT, SMALLINT) TO service_role;
REVOKE ALL ON FUNCTION recompute_member_score(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION recompute_member_score(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION recompute_group_member_scores(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION recompute_group_member_scores(UUID) TO service_role;
REVOKE ALL ON FUNCTION emit_attendance_events(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION emit_attendance_events(UUID) TO service_role;
REVOKE ALL ON FUNCTION emit_player_attendance_events(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION emit_player_attendance_events(UUID) TO service_role;
REVOKE ALL ON FUNCTION emit_cancel_event(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION emit_cancel_event(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION run_priority_window_close_job(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION run_priority_window_close_job(UUID) TO service_role;
REVOKE ALL ON FUNCTION trg_member_events_from_match_ratings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION trg_member_events_from_mvp_votes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION trg_member_events_from_peer_ratings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION trg_matches_set_signup_opened_at() FROM PUBLIC, anon, authenticated;

-- Redefined functions keep the ACL they had; restated for the record.
REVOKE ALL ON FUNCTION signup_for_match(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION signup_for_match(UUID, TEXT, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION cancel_my_signup(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cancel_my_signup(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION admin_remove_signup(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_remove_signup(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION admin_set_signup_status(UUID, signup_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_set_signup_status(UUID, signup_status) TO authenticated, service_role;
REVOKE ALL ON FUNCTION admin_set_match_status(UUID, match_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_set_match_status(UUID, match_status) TO authenticated, service_role;
REVOKE ALL ON FUNCTION promote_from_waitlist(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION promote_from_waitlist(UUID) TO service_role;
REVOKE ALL ON FUNCTION submit_match_report(UUID, INTEGER, INTEGER, BOOLEAN, BOOLEAN, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION submit_match_report(UUID, INTEGER, INTEGER, BOOLEAN, BOOLEAN, UUID, JSONB) TO authenticated, service_role;
REVOKE ALL ON FUNCTION delete_my_match_report(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION delete_my_match_report(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION auto_finish_match(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auto_finish_match(UUID) TO service_role;
REVOKE ALL ON FUNCTION schedule_match_jobs(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION schedule_match_jobs(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION run_scheduled_job(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION run_scheduled_job(UUID) TO service_role;
REVOKE ALL ON FUNCTION recompute_player_stats(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION recompute_player_stats(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION award_badges_for_match(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION award_badges_for_match(UUID) TO service_role;

-- ============================================
-- 14. BACKFILL
-- ============================================
-- Derive the ledger from existing data so groups do not start from zero. All rows
-- use source = 'system'; points are the group's current weights.

-- signup_opened_at for matches already open before this migration.
UPDATE public.matches
SET signup_opened_at = COALESCE(created_at, now())
WHERE status IN ('signup_open', 'full') AND signup_opened_at IS NULL;

-- Attendance from finished matches.
INSERT INTO public.member_events (group_id, player_id, match_id, type, points, source)
SELECT m.group_id, ms.player_id, m.id,
       CASE WHEN ms.status = 'confirmed' THEN 'attended' ELSE 'no_show' END::member_event_type,
       COALESCE(NULLIF(member_scoring_settings(m.group_id)->'weights'->>(CASE WHEN ms.status = 'confirmed' THEN 'attended' ELSE 'no_show' END), '')::smallint, 0),
       'system'::member_event_source
FROM public.match_signups ms
JOIN public.matches m ON m.id = ms.match_id
WHERE m.status = 'finished' AND ms.player_id IS NOT NULL
AND ms.status IN ('confirmed', 'did_not_show')
ON CONFLICT DO NOTHING;

-- Cancels (late/early from cancel_time and the group's late_cancel_hours).
INSERT INTO public.member_events (group_id, player_id, match_id, type, points, source)
SELECT x.group_id, x.player_id, x.match_id, x.type,
       COALESCE(NULLIF(member_scoring_settings(x.group_id)->'weights'->>x.type::text, '')::smallint, 0),
       'system'::member_event_source
FROM (
    SELECT m.group_id, ms.player_id, m.id AS match_id,
           CASE WHEN ms.cancel_time > m.date_time - (COALESCE((member_scoring_settings(m.group_id)->>'late_cancel_hours')::numeric, 6) || ' hours')::interval
                THEN 'late_cancel' ELSE 'early_cancel' END::member_event_type AS type
    FROM public.match_signups ms
    JOIN public.matches m ON m.id = ms.match_id
    WHERE m.status = 'finished' AND ms.player_id IS NOT NULL
    AND ms.status = 'cancelled' AND ms.cancel_time IS NOT NULL
) x
ON CONFLICT DO NOTHING;

-- Participation: usable reports, teammate ratings, MVP votes.
INSERT INTO public.member_events (group_id, player_id, match_id, type, points, source)
SELECT m.group_id, r.reporter_player_id, m.id, 'reported_result'::member_event_type,
       COALESCE(NULLIF(member_scoring_settings(m.group_id)->'weights'->>'reported_result', '')::smallint, 0), 'system'::member_event_source
FROM public.match_reports r
JOIN public.matches m ON m.id = r.match_id
WHERE m.status = 'finished' AND r.submitted_after_lock = FALSE
ON CONFLICT DO NOTHING;

INSERT INTO public.member_events (group_id, player_id, match_id, type, points, source)
SELECT DISTINCT m.group_id, mr.voter_player_id, m.id, 'rated_teammates'::member_event_type,
       COALESCE(NULLIF(member_scoring_settings(m.group_id)->'weights'->>'rated_teammates', '')::smallint, 0), 'system'::member_event_source
FROM public.match_ratings mr
JOIN public.matches m ON m.id = mr.match_id
WHERE m.status = 'finished'
ON CONFLICT DO NOTHING;

INSERT INTO public.member_events (group_id, player_id, match_id, type, points, source)
SELECT m.group_id, v.voter_player_id, m.id, 'voted_mvp'::member_event_type,
       COALESCE(NULLIF(member_scoring_settings(m.group_id)->'weights'->>'voted_mvp', '')::smallint, 0), 'system'::member_event_source
FROM public.match_mvp_votes v
JOIN public.matches m ON m.id = v.match_id
WHERE m.status = 'finished'
ON CONFLICT DO NOTHING;

-- Newcomer ratings: peer_ratings x rate_new_member notifications (within 14 days).
INSERT INTO public.member_events (group_id, player_id, match_id, subject_id, type, points, source)
SELECT DISTINCT pr.group_id, pr.voter_player_id, NULL::uuid, pr.rated_player_id, 'rated_new_member'::member_event_type,
       COALESCE(NULLIF(member_scoring_settings(pr.group_id)->'weights'->>'rated_new_member', '')::smallint, 0), 'system'::member_event_source
FROM public.peer_ratings pr
JOIN public.notifications n
  ON n.group_id = pr.group_id AND n.type = 'rate_new_member'
 AND n.payload->>'player_id' = pr.rated_player_id::text
 AND pr.created_at >= n.created_at AND pr.created_at <= n.created_at + interval '14 days'
ON CONFLICT DO NOTHING;

-- Scores for every group, then the window jobs for open matches.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id FROM public.groups LOOP
        PERFORM recompute_group_member_scores(r.id);
    END LOOP;
    FOR r IN SELECT id FROM public.matches WHERE status IN ('signup_open', 'full') LOOP
        PERFORM schedule_match_jobs(r.id);
    END LOOP;
END $$;
