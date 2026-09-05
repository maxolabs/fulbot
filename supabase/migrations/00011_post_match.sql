-- T4 post-match: MVP recompute trigger, badges, no-show handling, voting window
-- (see docs/rework-plan.md §2.5).

-- ============================================
-- SCHEMA: matches.mvp_player_id
-- ============================================

ALTER TABLE public.matches
    ADD COLUMN IF NOT EXISTS mvp_player_id UUID REFERENCES public.player_profiles(id);

CREATE INDEX IF NOT EXISTS idx_matches_mvp_player_id ON public.matches(mvp_player_id);

-- ============================================
-- MVP RECOMPUTE (idempotent count adjustment)
-- ============================================
-- Recomputes the top-voted candidate for a match (tie -> earliest vote) and
-- reconciles matches.mvp_player_id + player_profiles.mvp_count so repeated
-- calls (insert/delete of votes) never double-count:
--   - previous holder differs from new holder -> decrement previous (floor 0),
--     increment new.
--   - no votes at all -> clears mvp_player_id and decrements the previous
--     holder once.
--   - previous holder == new holder -> no-op.
-- Also keeps the 'mvp' badge in sync with the current holder.

CREATE OR REPLACE FUNCTION recompute_match_mvp(p_match_id UUID)
RETURNS void AS $$
DECLARE
    v_old_mvp UUID;
    v_new_mvp UUID;
BEGIN
    SELECT mvp_player_id INTO v_old_mvp FROM public.matches WHERE id = p_match_id FOR UPDATE;

    SELECT candidate_player_id INTO v_new_mvp
    FROM public.match_mvp_votes
    WHERE match_id = p_match_id
    GROUP BY candidate_player_id
    ORDER BY COUNT(*) DESC, MIN(created_at) ASC
    LIMIT 1;

    -- No change: same holder (including both NULL) -> nothing to do.
    IF v_new_mvp IS NOT DISTINCT FROM v_old_mvp THEN
        RETURN;
    END IF;

    IF v_old_mvp IS NOT NULL THEN
        UPDATE public.player_profiles
        SET mvp_count = GREATEST(0, mvp_count - 1)
        WHERE id = v_old_mvp;

        DELETE FROM public.player_badges
        WHERE player_id = v_old_mvp AND badge_type = 'mvp' AND match_id = p_match_id;
    END IF;

    IF v_new_mvp IS NOT NULL THEN
        UPDATE public.player_profiles
        SET mvp_count = mvp_count + 1
        WHERE id = v_new_mvp;

        INSERT INTO public.player_badges (player_id, badge_type, match_id)
        VALUES (v_new_mvp, 'mvp', p_match_id)
        ON CONFLICT (player_id, badge_type, match_id) DO NOTHING;
    END IF;

    UPDATE public.matches SET mvp_player_id = v_new_mvp WHERE id = p_match_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- TRIGGER: recompute on vote insert/delete
-- ============================================

CREATE OR REPLACE FUNCTION trg_match_mvp_votes_recompute()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM recompute_match_mvp(NEW.match_id);
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM recompute_match_mvp(OLD.match_id);
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS match_mvp_votes_recompute ON public.match_mvp_votes;
CREATE TRIGGER match_mvp_votes_recompute
    AFTER INSERT OR DELETE ON public.match_mvp_votes
    FOR EACH ROW EXECUTE FUNCTION trg_match_mvp_votes_recompute();

-- ============================================
-- BADGES
-- ============================================
-- hat_trick (>=3 goals), playmaker (>=2 assists), safe_hands (GK, clean
-- sheet), ironman (confirmed attendance at the group's 10 most recent
-- finished matches, including this one). 'mvp' is awarded by the trigger
-- above, not here. player_badges' UNIQUE(player_id, badge_type, match_id)
-- makes every insert idempotent.

CREATE OR REPLACE FUNCTION award_badges_for_match(p_match_id UUID)
RETURNS void AS $$
DECLARE
    v_group_id UUID;
    v_recent_count INTEGER;
BEGIN
    SELECT group_id INTO v_group_id FROM public.matches WHERE id = p_match_id;
    IF v_group_id IS NULL THEN
        RETURN;
    END IF;

    -- hat_trick
    INSERT INTO public.player_badges (player_id, badge_type, match_id)
    SELECT me.player_id, 'hat_trick', p_match_id
    FROM public.match_events me
    WHERE me.match_id = p_match_id
    AND me.event_type = 'goal'
    AND me.player_id IS NOT NULL
    GROUP BY me.player_id
    HAVING COUNT(*) >= 3
    ON CONFLICT (player_id, badge_type, match_id) DO NOTHING;

    -- playmaker
    INSERT INTO public.player_badges (player_id, badge_type, match_id)
    SELECT me.player_id, 'playmaker', p_match_id
    FROM public.match_events me
    WHERE me.match_id = p_match_id
    AND me.event_type = 'assist'
    AND me.player_id IS NOT NULL
    GROUP BY me.player_id
    HAVING COUNT(*) >= 2
    ON CONFLICT (player_id, badge_type, match_id) DO NOTHING;

    -- safe_hands: GK on a team whose opponent scored 0 this match
    INSERT INTO public.player_badges (player_id, badge_type, match_id)
    SELECT ta.player_id, 'safe_hands', p_match_id
    FROM public.team_assignments ta
    JOIN public.teams t ON t.id = ta.team_id
    WHERE t.match_id = p_match_id
    AND ta.position = 'GK'
    AND ta.player_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM public.teams other_team
        WHERE other_team.match_id = p_match_id
        AND other_team.id != t.id
        AND other_team.score > 0
    )
    ON CONFLICT (player_id, badge_type, match_id) DO NOTHING;

    -- ironman: confirmed (attended, not did_not_show) at the group's 10 most
    -- recent finished matches, including this one. Only awarded once the
    -- group actually has 10 finished matches.
    SELECT COUNT(*) INTO v_recent_count
    FROM public.matches
    WHERE group_id = v_group_id AND status = 'finished';

    IF v_recent_count >= 10 THEN
        INSERT INTO public.player_badges (player_id, badge_type, match_id)
        SELECT eligible.player_id, 'ironman', p_match_id
        FROM (
            SELECT ms.player_id
            FROM public.match_signups ms
            WHERE ms.match_id IN (
                SELECT id FROM public.matches
                WHERE group_id = v_group_id AND status = 'finished'
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FINALIZE MATCH RESULTS: drop the direct mvp_count increment, award badges
-- ============================================
-- CREATE OR REPLACE of the whole function from 00005_match_results.sql,
-- preserving every behavior except the MVP block (now owned by the
-- recompute_match_mvp trigger) and adding the award_badges_for_match call.

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

        PERFORM award_badges_for_match(p_match_id);
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

    -- Increment matches_played for all confirmed signups (registered players
    -- only; did_not_show is a distinct status and is never counted here)
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

    -- Update reliability scores for all participants
    PERFORM update_player_reliability(ms.player_id)
    FROM public.match_signups ms
    WHERE ms.match_id = p_match_id
    AND ms.player_id IS NOT NULL;

    -- Update ratings for all rated players
    -- (DISTINCT inside a function call is invalid SQL; the original 00004/00005
    -- version raised at runtime, so finalizing never completed.)
    PERFORM update_player_rating(rated.pid)
    FROM (
        SELECT DISTINCT mr.rated_player_id AS pid
        FROM public.match_ratings mr
        WHERE mr.match_id = p_match_id
    ) rated;

    -- Mark as finalized to prevent double-counting
    UPDATE public.matches SET results_finalized = TRUE WHERE id = p_match_id;

    -- Award hat_trick / playmaker / safe_hands / ironman badges
    PERFORM award_badges_for_match(p_match_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PRIVILEGES
-- ============================================

REVOKE ALL ON FUNCTION recompute_match_mvp(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recompute_match_mvp(UUID) TO authenticated;

REVOKE ALL ON FUNCTION award_badges_for_match(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION award_badges_for_match(UUID) TO authenticated;

-- ============================================
-- RLS: voting window (finished, within 7 days, voter played) + safety net
-- for update_player_reliability's did_not_show handling
-- ============================================
-- update_player_reliability (00004_functions.sql) already counts
-- status = 'did_not_show' as a reliability penalty (v_no_shows) alongside
-- late cancels -- verified, no change needed there.

DROP POLICY IF EXISTS "Players can create ratings for matches they played" ON public.match_ratings;
CREATE POLICY "Players can create ratings for matches they played"
    ON public.match_ratings FOR INSERT
    WITH CHECK (
        voter_player_id = get_current_player_id() AND
        EXISTS (
            SELECT 1 FROM public.match_signups ms
            JOIN public.matches m ON m.id = ms.match_id
            WHERE ms.match_id = match_ratings.match_id
            AND ms.player_id = get_current_player_id()
            AND ms.status = 'confirmed'
            AND m.status = 'finished'
            AND m.date_time > now() - interval '7 days'
        )
    );

DROP POLICY IF EXISTS "Players can vote MVP" ON public.match_mvp_votes;
CREATE POLICY "Players can vote MVP"
    ON public.match_mvp_votes FOR INSERT
    WITH CHECK (
        voter_player_id = get_current_player_id() AND
        EXISTS (
            SELECT 1 FROM public.match_signups ms
            JOIN public.matches m ON m.id = ms.match_id
            WHERE ms.match_id = match_mvp_votes.match_id
            AND ms.player_id = get_current_player_id()
            AND ms.status = 'confirmed'
            AND m.status = 'finished'
            AND m.date_time > now() - interval '7 days'
        )
    );
