-- Match Results: scores, goal events, and stat finalization

-- ============================================
-- SCHEMA CHANGES
-- ============================================

-- Add score column to teams
ALTER TABLE public.teams ADD COLUMN score SMALLINT NOT NULL DEFAULT 0;

-- Add results_finalized flag to matches (prevents double-counting stats)
ALTER TABLE public.matches ADD COLUMN results_finalized BOOLEAN NOT NULL DEFAULT FALSE;

-- Create match_events table
CREATE TABLE public.match_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    player_id UUID REFERENCES public.player_profiles(id) ON DELETE SET NULL,
    guest_player_id UUID REFERENCES public.guest_players(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('goal', 'assist', 'own_goal')),
    linked_event_id UUID REFERENCES public.match_events(id) ON DELETE SET NULL,
    minute SMALLINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_match_events_match ON public.match_events(match_id);
CREATE INDEX idx_match_events_player ON public.match_events(player_id);

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE public.match_events ENABLE ROW LEVEL SECURITY;

-- Members can view match events for their group's matches
CREATE POLICY "match_events_select" ON public.match_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_events.match_id
            AND is_group_member(m.group_id)
        )
    );

-- Admins/captains can insert match events
CREATE POLICY "match_events_insert" ON public.match_events
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_events.match_id
            AND is_group_admin_or_captain(m.group_id)
        )
    );

-- Admins/captains can delete match events (for re-recording)
CREATE POLICY "match_events_delete" ON public.match_events
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_events.match_id
            AND is_group_admin_or_captain(m.group_id)
        )
    );

-- ============================================
-- FINALIZE MATCH RESULTS FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION finalize_match_results(p_match_id UUID)
RETURNS void AS $$
DECLARE
    v_match public.matches;
BEGIN
    -- Verify match exists and is finished
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Match not found';
    END IF;
    IF v_match.status != 'finished' THEN
        RAISE EXCEPTION 'Match must be finished to finalize results';
    END IF;

    -- Prevent double-counting: only finalize once
    IF v_match.results_finalized THEN
        -- Still update team scores (events may have been re-saved), but skip player stats
        UPDATE public.teams t
        SET score = (
            SELECT COUNT(*)
            FROM public.match_events me
            WHERE me.match_id = p_match_id
            AND me.team_id = t.id
            AND me.event_type = 'goal'
        )
        WHERE t.match_id = p_match_id;
        RETURN;
    END IF;

    -- Update team scores from goal counts
    UPDATE public.teams t
    SET score = (
        SELECT COUNT(*)
        FROM public.match_events me
        WHERE me.match_id = p_match_id
        AND me.team_id = t.id
        AND me.event_type = 'goal'
    )
    WHERE t.match_id = p_match_id;

    -- Increment matches_played for all confirmed signups (registered players only)
    UPDATE public.player_profiles pp
    SET matches_played = matches_played + 1
    FROM public.match_signups ms
    WHERE ms.match_id = p_match_id
    AND ms.player_id = pp.id
    AND ms.status = 'confirmed';

    -- Increment goals for scorers
    UPDATE public.player_profiles pp
    SET goals = goals + goal_count
    FROM (
        SELECT me.player_id, COUNT(*) as goal_count
        FROM public.match_events me
        WHERE me.match_id = p_match_id
        AND me.event_type = 'goal'
        AND me.player_id IS NOT NULL
        GROUP BY me.player_id
    ) gc
    WHERE pp.id = gc.player_id;

    -- Increment assists
    UPDATE public.player_profiles pp
    SET assists = assists + assist_count
    FROM (
        SELECT me.player_id, COUNT(*) as assist_count
        FROM public.match_events me
        WHERE me.match_id = p_match_id
        AND me.event_type = 'assist'
        AND me.player_id IS NOT NULL
        GROUP BY me.player_id
    ) ac
    WHERE pp.id = ac.player_id;

    -- Clean sheets: GKs on teams that conceded 0 goals
    -- A team concedes 0 if the opposing team scored 0 goals
    UPDATE public.player_profiles pp
    SET clean_sheets = clean_sheets + 1
    FROM public.team_assignments ta
    JOIN public.teams t ON ta.team_id = t.id
    WHERE t.match_id = p_match_id
    AND ta.player_id = pp.id
    AND ta.position = 'GK'
    AND NOT EXISTS (
        -- Check that the OTHER team has 0 goals
        SELECT 1 FROM public.teams other_team
        WHERE other_team.match_id = p_match_id
        AND other_team.id != t.id
        AND other_team.score > 0
    );

    -- Update MVP count
    UPDATE public.player_profiles
    SET mvp_count = mvp_count + 1
    WHERE id = get_match_mvp(p_match_id);

    -- Update reliability scores for all participants
    PERFORM update_player_reliability(ms.player_id)
    FROM public.match_signups ms
    WHERE ms.match_id = p_match_id
    AND ms.player_id IS NOT NULL;

    -- Update ratings for all rated players
    PERFORM update_player_rating(DISTINCT mr.rated_player_id)
    FROM public.match_ratings mr
    WHERE mr.match_id = p_match_id;

    -- Mark as finalized to prevent double-counting
    UPDATE public.matches SET results_finalized = TRUE WHERE id = p_match_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop the old function that is superseded by finalize_match_results
DROP FUNCTION IF EXISTS update_player_stats_after_match(UUID);
