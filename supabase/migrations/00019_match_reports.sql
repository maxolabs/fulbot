-- Crowd-sourced match results, part 2: player reports and consensus
-- (docs/match-results-consensus.md §3, §4, §11.1).
--
--   * match_reports / match_report_stats: one partial report per player per match.
--   * result_weight: admin 1.5 / captain 1.25 / member 1.0 (groups.settings.result_weights).
--   * recompute_match_consensus: weighted plurality for the score pair, complementary
--     per-player goal/assist attribution reconciled against the score, weighted MVP,
--     result_status, results_posted once per distinct result.
--   * submit_match_report / delete_my_match_report: the only write paths for reports.
--   * admin_set_match_result / admin_unlock_match_result: atomic admin override + lock.
--   * recompute_match_mvp: weighted, no longer touches mvp_count, inert while locked.
--   * RLS: reports readable by members; votes/ratings editable inside the window.

-- ============================================
-- 1. SCHEMA
-- ============================================

ALTER TABLE public.match_events
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE public.match_events DROP CONSTRAINT IF EXISTS match_events_source_check;
ALTER TABLE public.match_events ADD CONSTRAINT match_events_source_check
    CHECK (source IN ('admin', 'consensus'));

CREATE TABLE IF NOT EXISTS public.match_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    reporter_player_id UUID NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
    dark_score SMALLINT CHECK (dark_score BETWEEN 0 AND 99),
    light_score SMALLINT CHECK (light_score BETWEEN 0 AND 99),
    dark_goals_complete BOOLEAN NOT NULL DEFAULT FALSE,
    light_goals_complete BOOLEAN NOT NULL DEFAULT FALSE,
    mvp_candidate_id UUID REFERENCES public.player_profiles(id) ON DELETE SET NULL,
    submitted_after_lock BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (match_id, reporter_player_id)
);

CREATE INDEX IF NOT EXISTS idx_match_reports_match ON public.match_reports(match_id);

CREATE TABLE IF NOT EXISTS public.match_report_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES public.match_reports(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    player_id UUID REFERENCES public.player_profiles(id) ON DELETE CASCADE,
    guest_player_id UUID REFERENCES public.guest_players(id) ON DELETE CASCADE,
    goals SMALLINT NOT NULL DEFAULT 0 CHECK (goals BETWEEN 0 AND 99),
    assists SMALLINT NOT NULL DEFAULT 0 CHECK (assists BETWEEN 0 AND 99),
    CHECK (goals > 0 OR assists > 0),
    CHECK ((player_id IS NULL) <> (guest_player_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS match_report_stats_uniq
    ON public.match_report_stats(report_id, team_id, COALESCE(player_id, guest_player_id));
CREATE INDEX IF NOT EXISTS idx_match_report_stats_report ON public.match_report_stats(report_id);

DROP TRIGGER IF EXISTS update_match_reports_updated_at ON public.match_reports;
CREATE TRIGGER update_match_reports_updated_at BEFORE UPDATE ON public.match_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 2. RLS
-- ============================================

ALTER TABLE public.match_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_report_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "match_reports_select" ON public.match_reports;
CREATE POLICY "match_reports_select" ON public.match_reports
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_reports.match_id AND is_group_member(m.group_id)
        )
    );

DROP POLICY IF EXISTS "match_report_stats_select" ON public.match_report_stats;
CREATE POLICY "match_report_stats_select" ON public.match_report_stats
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.match_reports r
            JOIN public.matches m ON m.id = r.match_id
            WHERE r.id = match_report_stats.report_id AND is_group_member(m.group_id)
        )
    );

-- Reporting window: finished and within the group's results_window_days.
CREATE OR REPLACE FUNCTION match_report_window_open(p_match_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_match public.matches;
    v_days INTEGER;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL OR v_match.status <> 'finished' THEN
        RETURN FALSE;
    END IF;
    SELECT COALESCE(ns.results_window_days, 7) INTO v_days
    FROM public.notification_settings ns WHERE ns.group_id = v_match.group_id;
    RETURN v_match.date_time > now() - (COALESCE(v_days, 7) || ' days')::interval;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

DROP POLICY IF EXISTS "Players can vote MVP" ON public.match_mvp_votes;
CREATE POLICY "Players can vote MVP"
    ON public.match_mvp_votes FOR INSERT
    WITH CHECK (
        voter_player_id = get_current_player_id() AND
        candidate_player_id <> get_current_player_id() AND
        match_report_window_open(match_mvp_votes.match_id) AND
        EXISTS (
            SELECT 1 FROM public.match_signups ms
            WHERE ms.match_id = match_mvp_votes.match_id
            AND ms.player_id = get_current_player_id()
            AND ms.status = 'confirmed'
        )
    );

DROP POLICY IF EXISTS "Players can delete their MVP vote" ON public.match_mvp_votes;
CREATE POLICY "Players can delete their MVP vote"
    ON public.match_mvp_votes FOR DELETE
    USING (
        voter_player_id = get_current_player_id() AND
        match_report_window_open(match_mvp_votes.match_id)
    );

DROP POLICY IF EXISTS "Players can create ratings for matches they played" ON public.match_ratings;
CREATE POLICY "Players can create ratings for matches they played"
    ON public.match_ratings FOR INSERT
    WITH CHECK (
        voter_player_id = get_current_player_id() AND
        match_report_window_open(match_ratings.match_id) AND
        EXISTS (
            SELECT 1 FROM public.match_signups ms
            WHERE ms.match_id = match_ratings.match_id
            AND ms.player_id = get_current_player_id()
            AND ms.status = 'confirmed'
        )
    );

DROP POLICY IF EXISTS "Players can update their ratings" ON public.match_ratings;
CREATE POLICY "Players can update their ratings"
    ON public.match_ratings FOR UPDATE
    USING (voter_player_id = get_current_player_id() AND match_report_window_open(match_ratings.match_id))
    WITH CHECK (voter_player_id = get_current_player_id());

DROP POLICY IF EXISTS "Players can delete their ratings" ON public.match_ratings;
CREATE POLICY "Players can delete their ratings"
    ON public.match_ratings FOR DELETE
    USING (voter_player_id = get_current_player_id() AND match_report_window_open(match_ratings.match_id));

-- ============================================
-- 3. WEIGHTS AND USABLE REPORTS
-- ============================================

CREATE OR REPLACE FUNCTION result_weight(p_group_id UUID, p_player_id UUID)
RETURNS NUMERIC AS $$
DECLARE
    v_role TEXT;
    v_weights JSONB;
    v_default NUMERIC;
    v_value NUMERIC;
BEGIN
    SELECT gm.role::text INTO v_role
    FROM public.group_memberships gm
    WHERE gm.group_id = p_group_id AND gm.player_id = p_player_id AND gm.is_active = TRUE
    LIMIT 1;
    v_role := COALESCE(v_role, 'member');

    v_default := CASE v_role WHEN 'admin' THEN 1.5 WHEN 'captain' THEN 1.25 ELSE 1.0 END;

    SELECT g.settings->'result_weights' INTO v_weights FROM public.groups g WHERE g.id = p_group_id;
    BEGIN
        v_value := (v_weights->>v_role)::numeric;
    EXCEPTION WHEN OTHERS THEN
        v_value := NULL;
    END;

    IF v_value IS NULL OR v_value <= 0 THEN
        RETURN v_default;
    END IF;
    RETURN v_value;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Reports that count: not submitted after a lock, reporter still confirmed.
CREATE OR REPLACE FUNCTION usable_match_reports(p_match_id UUID)
RETURNS TABLE(
    report_id UUID,
    reporter_player_id UUID,
    weight NUMERIC,
    dark_score SMALLINT,
    light_score SMALLINT,
    dark_goals_complete BOOLEAN,
    light_goals_complete BOOLEAN,
    created_at TIMESTAMPTZ
) AS $$
    SELECT r.id, r.reporter_player_id, result_weight(m.group_id, r.reporter_player_id),
           r.dark_score, r.light_score, r.dark_goals_complete, r.light_goals_complete, r.created_at
    FROM public.match_reports r
    JOIN public.matches m ON m.id = r.match_id
    WHERE r.match_id = p_match_id
    AND r.submitted_after_lock = FALSE
    AND EXISTS (
        SELECT 1 FROM public.match_signups ms
        WHERE ms.match_id = r.match_id AND ms.player_id = r.reporter_player_id AND ms.status = 'confirmed'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================
-- 4. MVP (weighted, inert while locked)
-- ============================================

-- Sets matches.mvp_player_id and keeps the 'mvp' badge in sync. mvp_count is
-- owned by recompute_player_stats (00018).
CREATE OR REPLACE FUNCTION set_match_mvp(p_match_id UUID, p_new_mvp UUID)
RETURNS void AS $$
DECLARE
    v_old_mvp UUID;
BEGIN
    SELECT mvp_player_id INTO v_old_mvp FROM public.matches WHERE id = p_match_id FOR UPDATE;

    IF p_new_mvp IS NOT DISTINCT FROM v_old_mvp THEN
        RETURN;
    END IF;

    -- The 'mvp' badge is maintained by award_badges_for_match (00018), which
    -- runs from finalize_match_results once the result is consensus/locked.
    UPDATE public.matches SET mvp_player_id = p_new_mvp WHERE id = p_match_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION recompute_match_mvp(p_match_id UUID)
RETURNS void AS $$
DECLARE
    v_match public.matches;
    v_new_mvp UUID;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL OR v_match.result_status = 'locked' THEN
        RETURN;
    END IF;

    SELECT v.candidate_player_id INTO v_new_mvp
    FROM public.match_mvp_votes v
    WHERE v.match_id = p_match_id
    GROUP BY v.candidate_player_id
    ORDER BY SUM(result_weight(v_match.group_id, v.voter_player_id)) DESC,
             COUNT(*) DESC,
             MIN(v.created_at) ASC
    LIMIT 1;

    PERFORM set_match_mvp(p_match_id, v_new_mvp);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. RESULTS POSTED
-- ============================================

CREATE OR REPLACE FUNCTION build_results_posted_payload(p_match_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_match public.matches;
    v_dark INTEGER;
    v_light INTEGER;
    v_scorers JSONB;
    v_assisters JSONB;
    v_unattributed_dark INTEGER;
    v_unattributed_light INTEGER;
    v_mvp_name TEXT;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;

    SELECT MAX(CASE WHEN name = 'dark' THEN score END), MAX(CASE WHEN name = 'light' THEN score END)
    INTO v_dark, v_light
    FROM public.teams WHERE match_id = p_match_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', x.name, 'team', x.team, 'goals', x.n)
                              ORDER BY x.team, x.n DESC, x.name), '[]'::jsonb)
    INTO v_scorers
    FROM (
        SELECT COALESCE(pp.display_name, gp.display_name) AS name, t.name::text AS team, COUNT(*) AS n
        FROM public.match_events me
        JOIN public.teams t ON t.id = me.team_id
        LEFT JOIN public.player_profiles pp ON pp.id = me.player_id
        LEFT JOIN public.guest_players gp ON gp.id = me.guest_player_id
        WHERE me.match_id = p_match_id AND me.event_type = 'goal'
        AND (me.player_id IS NOT NULL OR me.guest_player_id IS NOT NULL)
        GROUP BY 1, 2
    ) x;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', x.name, 'team', x.team, 'assists', x.n)
                              ORDER BY x.team, x.n DESC, x.name), '[]'::jsonb)
    INTO v_assisters
    FROM (
        SELECT COALESCE(pp.display_name, gp.display_name) AS name, t.name::text AS team, COUNT(*) AS n
        FROM public.match_events me
        JOIN public.teams t ON t.id = me.team_id
        LEFT JOIN public.player_profiles pp ON pp.id = me.player_id
        LEFT JOIN public.guest_players gp ON gp.id = me.guest_player_id
        WHERE me.match_id = p_match_id AND me.event_type = 'assist'
        AND (me.player_id IS NOT NULL OR me.guest_player_id IS NOT NULL)
        GROUP BY 1, 2
    ) x;

    SELECT COUNT(*) FILTER (WHERE t.name = 'dark'), COUNT(*) FILTER (WHERE t.name = 'light')
    INTO v_unattributed_dark, v_unattributed_light
    FROM public.match_events me
    JOIN public.teams t ON t.id = me.team_id
    WHERE me.match_id = p_match_id AND me.event_type = 'goal'
    AND me.player_id IS NULL AND me.guest_player_id IS NULL;

    SELECT display_name INTO v_mvp_name FROM public.player_profiles WHERE id = v_match.mvp_player_id;

    RETURN jsonb_build_object(
        'match_id', p_match_id,
        'dark_score', COALESCE(v_dark, 0),
        'light_score', COALESCE(v_light, 0),
        'scorers', v_scorers,
        'assisters', v_assisters,
        'unattributed', jsonb_build_object('dark', v_unattributed_dark, 'light', v_unattributed_light),
        'mvp_name', v_mvp_name,
        'mvp_player_id', v_match.mvp_player_id,
        'status', v_match.result_status
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Posting policy (docs §5.4, §7, audit #4). The "dark-light|mvp" key of the
-- current result is compared with result_posted_key (what the group / the
-- admins last saw):
--   * key unchanged                      -> nothing.
--   * never posted (key NULL)            -> results_posted to the group.
--   * p_group_post (admin lock)          -> results_posted to the group.
--   * otherwise (consensus drifted after
--     it was posted, unlock recompute)   -> in-app 'results_changed' to each
--     group admin, no outbox, deduped on the latest notice's `current`.
-- The key is updated whenever a post or a change notice is issued.
DROP FUNCTION IF EXISTS post_match_result_if_changed(UUID);
CREATE OR REPLACE FUNCTION post_match_result_if_changed(p_match_id UUID, p_group_post BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN AS $$
DECLARE
    v_match public.matches;
    v_group public.groups;
    v_key TEXT;
    v_score TEXT;
    v_previous TEXT;
    v_last_current TEXT;
    v_mvp_name TEXT;
    v_dark INTEGER;
    v_light INTEGER;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL OR v_match.result_status NOT IN ('consensus', 'locked') THEN
        RETURN FALSE;
    END IF;

    SELECT MAX(CASE WHEN name = 'dark' THEN score END), MAX(CASE WHEN name = 'light' THEN score END)
    INTO v_dark, v_light
    FROM public.teams WHERE match_id = p_match_id;

    v_score := COALESCE(v_dark, 0) || '-' || COALESCE(v_light, 0);
    v_key := v_score || '|' || COALESCE(v_match.mvp_player_id::text, '');
    IF v_key IS NOT DISTINCT FROM v_match.result_posted_key THEN
        RETURN FALSE;
    END IF;

    IF v_match.result_posted_key IS NULL OR p_group_post THEN
        PERFORM emit_notification(v_match.group_id, p_match_id, 'results_posted', build_results_posted_payload(p_match_id));
        UPDATE public.matches SET result_posted_key = v_key WHERE id = p_match_id;
        RETURN TRUE;
    END IF;

    -- Drift after posting: tell the admins in-app, never the group. Dedupe
    -- against the latest change notice issued since the last group post (a
    -- notice older than the last post is stale: the admins have seen a
    -- different result in between).
    SELECT payload->>'current' INTO v_last_current
    FROM public.notifications n
    WHERE n.match_id = p_match_id AND n.type = 'results_changed'
    AND n.created_at >= COALESCE((
        SELECT MAX(created_at) FROM public.notifications
        WHERE match_id = p_match_id AND type = 'results_posted'
    ), '-infinity'::timestamptz)
    ORDER BY n.created_at DESC
    LIMIT 1;

    IF v_last_current IS NOT DISTINCT FROM v_key THEN
        UPDATE public.matches SET result_posted_key = v_key WHERE id = p_match_id;
        RETURN FALSE;
    END IF;

    SELECT * INTO v_group FROM public.groups WHERE id = v_match.group_id;
    v_previous := split_part(v_match.result_posted_key, '|', 1);
    SELECT display_name INTO v_mvp_name FROM public.player_profiles WHERE id = v_match.mvp_player_id;

    INSERT INTO public.notifications (group_id, match_id, recipient_player_id, type, payload)
    SELECT v_match.group_id, p_match_id, gm.player_id, 'results_changed', jsonb_build_object(
        'match_id', p_match_id,
        'group_name', v_group.name,
        'date_time', v_match.date_time,
        'previous', v_previous,
        'current', v_key,
        'previous_score', v_previous,
        'current_score', v_score,
        'mvp_name', v_mvp_name
    )
    FROM public.group_memberships gm
    WHERE gm.group_id = v_match.group_id AND gm.role = 'admin' AND gm.is_active;

    UPDATE public.matches SET result_posted_key = v_key WHERE id = p_match_id;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. CONSENSUS
-- ============================================

CREATE OR REPLACE FUNCTION recompute_match_consensus(p_match_id UUID)
RETURNS void AS $$
DECLARE
    v_match public.matches;
    v_team RECORD;
    v_players INTEGER;
    v_quorum INTEGER;
    v_reporters INTEGER;
    v_dark INTEGER;
    v_light INTEGER;
    v_win_weight NUMERIC;
    v_total_weight NUMERIC;
    v_team_score INTEGER;
    v_attributed INTEGER;
    v_remaining INTEGER;
    v_assists_remaining INTEGER;
    v_status TEXT;
    r RECORD;
    v_i INTEGER;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RETURN;
    END IF;
    IF NOT is_service_role() AND NOT is_group_member(v_match.group_id) THEN
        RAISE EXCEPTION 'No sos miembro de este grupo';
    END IF;
    IF v_match.result_status = 'locked' OR v_match.status <> 'finished' THEN
        RETURN;
    END IF;

    -- Quorum from the number of confirmed participants (players and guests).
    SELECT COUNT(*) INTO v_players
    FROM public.match_signups ms WHERE ms.match_id = p_match_id AND ms.status = 'confirmed';
    v_quorum := LEAST(3, CEIL(v_players / 3.0))::INTEGER;
    IF v_quorum < 1 THEN v_quorum := 1; END IF;

    SELECT COUNT(*) INTO v_reporters FROM usable_match_reports(p_match_id);

    -- Score pair: weighted plurality; ties -> raw count, highest single weight, earliest.
    SELECT u.dark_score, u.light_score, SUM(u.weight)
    INTO v_dark, v_light, v_win_weight
    FROM usable_match_reports(p_match_id) u
    WHERE u.dark_score IS NOT NULL AND u.light_score IS NOT NULL
    GROUP BY u.dark_score, u.light_score
    ORDER BY SUM(u.weight) DESC, COUNT(*) DESC, MAX(u.weight) DESC, MIN(u.created_at) ASC
    LIMIT 1;

    SELECT COALESCE(SUM(u.weight), 0) INTO v_total_weight
    FROM usable_match_reports(p_match_id) u
    WHERE u.dark_score IS NOT NULL AND u.light_score IS NOT NULL;

    -- Rebuild consensus events from scratch.
    DELETE FROM public.match_events WHERE match_id = p_match_id AND source = 'consensus';

    FOR v_team IN SELECT t.id, t.name::text AS name FROM public.teams t WHERE t.match_id = p_match_id LOOP
        v_team_score := CASE WHEN v_team.name = 'dark' THEN v_dark ELSE v_light END;

        -- Goal attributions, strongest support first. Evidence for a player =
        -- reports that mention them on this team + reports that declared this
        -- team's goal list complete (an explicit 0). Mode by weight; ties -> higher.
        v_attributed := 0;
        v_remaining := v_team_score;  -- NULL when no score consensus: everything fits.
        FOR r IN
            WITH mentions AS (
                SELECT s.report_id, COALESCE(s.player_id, s.guest_player_id) AS pkey,
                       s.player_id, s.guest_player_id, s.goals, s.assists
                FROM public.match_report_stats s
                JOIN usable_match_reports(p_match_id) u ON u.report_id = s.report_id
                WHERE s.team_id = v_team.id AND s.goals > 0
                -- assists-only rows are not evidence about goals ("no sé", not 0)
            ),
            pkeys AS (
                SELECT DISTINCT pkey, player_id, guest_player_id FROM mentions
            ),
            evidence AS (
                SELECT k.pkey, k.player_id, k.guest_player_id, u.weight,
                       COALESCE(m.goals, 0) AS goals
                FROM pkeys k
                CROSS JOIN usable_match_reports(p_match_id) u
                LEFT JOIN mentions m ON m.pkey = k.pkey AND m.report_id = u.report_id
                WHERE m.report_id IS NOT NULL
                   OR (v_team.name = 'dark' AND u.dark_goals_complete)
                   OR (v_team.name = 'light' AND u.light_goals_complete)
            ),
            modes AS (
                SELECT pkey, player_id, guest_player_id, goals, SUM(weight) AS support,
                       ROW_NUMBER() OVER (PARTITION BY pkey ORDER BY SUM(weight) DESC, goals DESC) AS rn
                FROM evidence
                GROUP BY pkey, player_id, guest_player_id, goals
            )
            SELECT player_id, guest_player_id, goals, support
            FROM modes
            WHERE rn = 1 AND goals > 0
            ORDER BY support DESC, goals DESC, pkey
        LOOP
            IF v_remaining IS NOT NULL AND v_remaining <= 0 THEN
                EXIT;
            END IF;
            v_i := r.goals;
            IF v_remaining IS NOT NULL AND v_i > v_remaining THEN
                v_i := v_remaining;  -- trim the least-supported attribution to fit
            END IF;
            INSERT INTO public.match_events (match_id, team_id, player_id, guest_player_id, event_type, source)
            SELECT p_match_id, v_team.id, r.player_id, r.guest_player_id, 'goal', 'consensus'
            FROM generate_series(1, v_i);
            v_attributed := v_attributed + v_i;
            IF v_remaining IS NOT NULL THEN
                v_remaining := v_remaining - v_i;
            END IF;
        END LOOP;

        -- No score consensus: the team's score is whatever got attributed.
        IF v_team_score IS NULL THEN
            v_team_score := v_attributed;
        ELSIF v_remaining > 0 THEN
            INSERT INTO public.match_events (match_id, team_id, event_type, source)
            SELECT p_match_id, v_team.id, 'goal', 'consensus'
            FROM generate_series(1, v_remaining);
        END IF;

        -- Assists: evidence = reports that mention the player with assists > 0;
        -- mode by weight, ties -> higher; capped at the team's goals.
        v_assists_remaining := v_team_score;
        FOR r IN
            WITH mentions AS (
                SELECT s.report_id, COALESCE(s.player_id, s.guest_player_id) AS pkey,
                       s.player_id, s.guest_player_id, s.assists, u.weight
                FROM public.match_report_stats s
                JOIN usable_match_reports(p_match_id) u ON u.report_id = s.report_id
                WHERE s.team_id = v_team.id AND s.assists > 0
            ),
            modes AS (
                SELECT pkey, player_id, guest_player_id, assists, SUM(weight) AS support,
                       ROW_NUMBER() OVER (PARTITION BY pkey ORDER BY SUM(weight) DESC, assists DESC) AS rn
                FROM mentions
                GROUP BY pkey, player_id, guest_player_id, assists
            )
            SELECT player_id, guest_player_id, assists, support
            FROM modes WHERE rn = 1
            ORDER BY support DESC, assists DESC, pkey
        LOOP
            IF v_assists_remaining <= 0 THEN
                EXIT;
            END IF;
            v_i := LEAST(r.assists, v_assists_remaining);
            INSERT INTO public.match_events (match_id, team_id, player_id, guest_player_id, event_type, source)
            SELECT p_match_id, v_team.id, r.player_id, r.guest_player_id, 'assist', 'consensus'
            FROM generate_series(1, v_i);
            v_assists_remaining := v_assists_remaining - v_i;
        END LOOP;

        UPDATE public.teams SET score = COALESCE(v_team_score, 0) WHERE id = v_team.id;
    END LOOP;

    PERFORM recompute_match_mvp(p_match_id);

    IF v_reporters = 0 THEN
        v_status := 'pending';
    ELSIF v_reporters >= v_quorum AND v_dark IS NOT NULL
          AND v_total_weight > 0 AND v_win_weight >= 0.5 * v_total_weight THEN
        v_status := 'consensus';
    ELSE
        v_status := 'provisional';
    END IF;

    UPDATE public.matches SET result_status = v_status WHERE id = p_match_id;

    IF v_status = 'consensus' THEN
        PERFORM finalize_match_results(p_match_id);
        PERFORM post_match_result_if_changed(p_match_id, FALSE);
    ELSIF v_match.result_status = 'consensus' THEN
        -- Fell back to provisional: keep stats consistent with the new status.
        PERFORM finalize_match_results(p_match_id);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 7. PLAYER RPCs
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

    IF v_match.result_status <> 'locked' THEN
        PERFORM recompute_match_consensus(p_match_id);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 8. ADMIN RPCs
-- ============================================

CREATE OR REPLACE FUNCTION admin_set_match_result(
    p_match_id UUID,
    p_dark_score INTEGER,
    p_light_score INTEGER,
    p_events JSONB,
    p_mvp_player_id UUID
)
RETURNS void AS $$
DECLARE
    v_match public.matches;
    v_player_id UUID;
    v_event JSONB;
    v_ids UUID[] := ARRAY[]::UUID[];
    v_new_id UUID;
    v_team_id UUID;
    v_pid UUID;
    v_gid UUID;
    v_type TEXT;
    v_linked INTEGER;
    v_linked_id UUID;
    v_dark_id UUID;
    v_light_id UUID;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;
    IF NOT is_service_role() AND NOT is_group_admin_or_captain(v_match.group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para cargar resultados';
    END IF;
    IF v_match.status <> 'finished' THEN
        RAISE EXCEPTION 'El partido todavía no terminó';
    END IF;
    IF p_dark_score IS NULL OR p_light_score IS NULL
       OR p_dark_score NOT BETWEEN 0 AND 99 OR p_light_score NOT BETWEEN 0 AND 99 THEN
        RAISE EXCEPTION 'Resultado inválido';
    END IF;

    SELECT id INTO v_dark_id FROM public.teams WHERE match_id = p_match_id AND name = 'dark';
    SELECT id INTO v_light_id FROM public.teams WHERE match_id = p_match_id AND name = 'light';
    IF v_dark_id IS NULL OR v_light_id IS NULL THEN
        RAISE EXCEPTION 'El partido no tiene equipos';
    END IF;

    v_player_id := get_current_player_id();

    DELETE FROM public.match_events WHERE match_id = p_match_id;

    IF p_events IS NOT NULL AND jsonb_typeof(p_events) = 'array' THEN
        -- Pass 1: everything except links.
        FOR v_event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
            v_team_id := NULLIF(v_event->>'team_id', '')::UUID;
            v_pid := NULLIF(v_event->>'player_id', '')::UUID;
            v_gid := NULLIF(v_event->>'guest_player_id', '')::UUID;
            v_type := COALESCE(v_event->>'event_type', 'goal');

            IF v_team_id IS NULL OR v_team_id NOT IN (v_dark_id, v_light_id) THEN
                RAISE EXCEPTION 'Equipo inválido en los eventos';
            END IF;
            IF v_type NOT IN ('goal', 'assist', 'own_goal') THEN
                RAISE EXCEPTION 'Tipo de evento inválido';
            END IF;
            IF v_pid IS NOT NULL AND v_gid IS NOT NULL THEN
                RAISE EXCEPTION 'Jugador inválido en los eventos';
            END IF;

            INSERT INTO public.match_events (match_id, team_id, player_id, guest_player_id, event_type, source)
            VALUES (p_match_id, v_team_id, v_pid, v_gid, v_type, 'admin')
            RETURNING id INTO v_new_id;
            v_ids := v_ids || v_new_id;
        END LOOP;

        -- Pass 2: linked_index (0-based position in p_events).
        v_linked := 0;
        FOR v_event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
            v_linked := v_linked + 1;
            IF v_event ? 'linked_index' AND jsonb_typeof(v_event->'linked_index') = 'number' THEN
                v_linked_id := v_ids[(v_event->>'linked_index')::INTEGER + 1];
                IF v_linked_id IS NOT NULL THEN
                    UPDATE public.match_events SET linked_event_id = v_linked_id WHERE id = v_ids[v_linked];
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- Unattributed goals (audit #9): the score is authoritative; whatever the
    -- goal list does not cover becomes goal events without a player so the
    -- payload and the consensus card can say "N goles sin autor".
    SELECT COUNT(*) INTO v_linked FROM public.match_events
    WHERE match_id = p_match_id AND team_id = v_dark_id AND event_type = 'goal';
    IF v_linked > p_dark_score THEN
        RAISE EXCEPTION 'Los goles cargados de Oscuro (%) superan el resultado (%)', v_linked, p_dark_score;
    END IF;
    INSERT INTO public.match_events (match_id, team_id, event_type, source)
    SELECT p_match_id, v_dark_id, 'goal', 'admin' FROM generate_series(1, p_dark_score - v_linked);

    SELECT COUNT(*) INTO v_linked FROM public.match_events
    WHERE match_id = p_match_id AND team_id = v_light_id AND event_type = 'goal';
    IF v_linked > p_light_score THEN
        RAISE EXCEPTION 'Los goles cargados de Claro (%) superan el resultado (%)', v_linked, p_light_score;
    END IF;
    INSERT INTO public.match_events (match_id, team_id, event_type, source)
    SELECT p_match_id, v_light_id, 'goal', 'admin' FROM generate_series(1, p_light_score - v_linked);

    UPDATE public.teams SET score = p_dark_score WHERE id = v_dark_id;
    UPDATE public.teams SET score = p_light_score WHERE id = v_light_id;

    -- MVP: the admin's pick wins; with none given, keep the vote-based holder.
    IF p_mvp_player_id IS NOT NULL THEN
        PERFORM set_match_mvp(p_match_id, p_mvp_player_id);
    END IF;

    UPDATE public.matches
    SET result_status = 'locked',
        result_locked_by = v_player_id,
        result_locked_at = now()
    WHERE id = p_match_id;

    UPDATE public.scheduled_jobs
    SET status = 'cancelled'
    WHERE match_id = p_match_id AND status = 'pending'
    AND job_type IN ('results_request', 'results_reminder');

    PERFORM finalize_match_results(p_match_id);
    PERFORM post_match_result_if_changed(p_match_id, TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_unlock_match_result(p_match_id UUID)
RETURNS void AS $$
DECLARE
    v_match public.matches;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;
    IF NOT is_service_role() AND NOT is_group_admin_or_captain(v_match.group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para cargar resultados';
    END IF;
    IF v_match.result_status <> 'locked' THEN
        RETURN;
    END IF;

    UPDATE public.matches
    SET result_status = 'pending', result_locked_by = NULL, result_locked_at = NULL
    WHERE id = p_match_id;

    DELETE FROM public.match_events WHERE match_id = p_match_id AND source = 'admin';
    UPDATE public.match_reports SET submitted_after_lock = FALSE
    WHERE match_id = p_match_id AND submitted_after_lock = TRUE;

    PERFORM recompute_match_consensus(p_match_id);
    -- The lock's stats/badges (incl. the mvp badge) must follow the new status
    -- even when the recompute lands on provisional/pending.
    PERFORM finalize_match_results(p_match_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 9. PRIVILEGES
-- ============================================

REVOKE ALL ON FUNCTION match_report_window_open(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION match_report_window_open(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION result_weight(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION result_weight(UUID, UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION usable_match_reports(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION usable_match_reports(UUID) TO service_role;
REVOKE ALL ON FUNCTION set_match_mvp(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_match_mvp(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION recompute_match_mvp(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION recompute_match_mvp(UUID) TO service_role;
REVOKE ALL ON FUNCTION build_results_posted_payload(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION build_results_posted_payload(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION post_match_result_if_changed(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_match_result_if_changed(UUID, BOOLEAN) TO service_role;
REVOKE ALL ON FUNCTION recompute_match_consensus(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION recompute_match_consensus(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION submit_match_report(UUID, INTEGER, INTEGER, BOOLEAN, BOOLEAN, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION submit_match_report(UUID, INTEGER, INTEGER, BOOLEAN, BOOLEAN, UUID, JSONB) TO authenticated, service_role;
REVOKE ALL ON FUNCTION delete_my_match_report(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION delete_my_match_report(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION admin_set_match_result(UUID, INTEGER, INTEGER, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_set_match_result(UUID, INTEGER, INTEGER, JSONB, UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION admin_unlock_match_result(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_unlock_match_result(UUID) TO authenticated, service_role;
