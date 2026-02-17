-- FUTBOT Database Functions

-- ============================================
-- SIGNUP PROCESSING
-- ============================================

-- Function: Process signup (handles waitlist logic)
CREATE OR REPLACE FUNCTION process_match_signup(
    p_match_id UUID,
    p_player_id UUID,
    p_notes TEXT DEFAULT NULL,
    p_position_preference TEXT DEFAULT NULL
)
RETURNS public.match_signups AS $$
DECLARE
    v_match public.matches;
    v_confirmed_count INTEGER;
    v_signup public.match_signups;
    v_status signup_status;
    v_waitlist_position SMALLINT;
BEGIN
    -- Get match details
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;

    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Match not found';
    END IF;

    IF v_match.status NOT IN ('signup_open', 'full') THEN
        RAISE EXCEPTION 'Match is not accepting signups';
    END IF;

    -- Count confirmed signups
    SELECT COUNT(*) INTO v_confirmed_count
    FROM public.match_signups
    WHERE match_id = p_match_id AND status = 'confirmed';

    -- Determine status
    IF v_confirmed_count < v_match.max_players THEN
        v_status := 'confirmed';
        v_waitlist_position := NULL;
    ELSE
        v_status := 'waitlist';
        SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_waitlist_position
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'waitlist';
    END IF;

    -- Insert signup
    INSERT INTO public.match_signups (
        match_id, player_id, status, notes, position_preference, waitlist_position
    )
    VALUES (
        p_match_id, p_player_id, v_status, p_notes, p_position_preference, v_waitlist_position
    )
    RETURNING * INTO v_signup;

    -- Update match status if full
    IF v_status = 'confirmed' AND v_confirmed_count + 1 >= v_match.max_players THEN
        UPDATE public.matches SET status = 'full' WHERE id = p_match_id;
    END IF;

    RETURN v_signup;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Cancel signup (promotes from waitlist)
CREATE OR REPLACE FUNCTION cancel_match_signup(
    p_match_id UUID,
    p_player_id UUID
)
RETURNS TABLE (
    cancelled_signup public.match_signups,
    promoted_signup public.match_signups
) AS $$
DECLARE
    v_signup public.match_signups;
    v_was_confirmed BOOLEAN;
    v_promoted public.match_signups;
    v_first_waitlist_id UUID;
BEGIN
    -- Get the current signup
    SELECT * INTO v_signup
    FROM public.match_signups
    WHERE match_id = p_match_id AND player_id = p_player_id;

    IF v_signup IS NULL THEN
        RAISE EXCEPTION 'Signup not found';
    END IF;

    v_was_confirmed := v_signup.status = 'confirmed';

    -- Update the signup to cancelled
    UPDATE public.match_signups
    SET status = 'cancelled', cancel_time = NOW()
    WHERE id = v_signup.id
    RETURNING * INTO v_signup;

    cancelled_signup := v_signup;
    promoted_signup := NULL;

    -- If was confirmed, promote first from waitlist
    IF v_was_confirmed THEN
        SELECT id INTO v_first_waitlist_id
        FROM public.match_signups
        WHERE match_id = p_match_id
        AND status = 'waitlist'
        ORDER BY waitlist_position ASC, signup_time ASC
        LIMIT 1;

        IF v_first_waitlist_id IS NOT NULL THEN
            UPDATE public.match_signups
            SET status = 'confirmed', waitlist_position = NULL
            WHERE id = v_first_waitlist_id
            RETURNING * INTO v_promoted;

            promoted_signup := v_promoted;

            -- Reorder remaining waitlist
            WITH numbered AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY waitlist_position ASC, signup_time ASC) as new_pos
                FROM public.match_signups
                WHERE match_id = p_match_id AND status = 'waitlist'
            )
            UPDATE public.match_signups ms
            SET waitlist_position = numbered.new_pos
            FROM numbered
            WHERE ms.id = numbered.id;
        ELSE
            -- No one to promote, update match status
            UPDATE public.matches SET status = 'signup_open' WHERE id = p_match_id;
        END IF;
    END IF;

    RETURN QUERY SELECT v_signup, v_promoted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RELIABILITY SCORE
-- ============================================

-- Function: Calculate player reliability score
CREATE OR REPLACE FUNCTION update_player_reliability(p_player_id UUID)
RETURNS DECIMAL AS $$
DECLARE
    v_total_signups INTEGER;
    v_confirmed_played INTEGER;
    v_late_cancels INTEGER;
    v_no_shows INTEGER;
    v_score DECIMAL;
BEGIN
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE ms.status = 'confirmed'),
        COUNT(*) FILTER (WHERE ms.status = 'cancelled' AND ms.cancel_time > m.date_time - INTERVAL '6 hours'),
        COUNT(*) FILTER (WHERE ms.status = 'did_not_show')
    INTO v_total_signups, v_confirmed_played, v_late_cancels, v_no_shows
    FROM public.match_signups ms
    JOIN public.matches m ON m.id = ms.match_id
    WHERE ms.player_id = p_player_id;

    IF v_total_signups = 0 THEN
        RETURN 1.00;
    END IF;

    -- Score: start at 1, subtract penalties
    v_score := 1.00 - (v_late_cancels * 0.05) - (v_no_shows * 0.15);
    v_score := GREATEST(0.00, LEAST(1.00, v_score));

    UPDATE public.player_profiles
    SET reliability_score = v_score
    WHERE id = p_player_id;

    RETURN v_score;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PLAYER RATING
-- ============================================

-- Function: Update player overall rating from match ratings
CREATE OR REPLACE FUNCTION update_player_rating(p_player_id UUID)
RETURNS DECIMAL AS $$
DECLARE
    v_avg_rating DECIMAL;
BEGIN
    SELECT AVG(rating)::DECIMAL(3,2) INTO v_avg_rating
    FROM public.match_ratings
    WHERE rated_player_id = p_player_id;

    IF v_avg_rating IS NOT NULL THEN
        UPDATE public.player_profiles
        SET overall_rating = v_avg_rating
        WHERE id = p_player_id;
    END IF;

    RETURN COALESCE(v_avg_rating, 3.00);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- MVP CALCULATION
-- ============================================

-- Function: Get match MVP
CREATE OR REPLACE FUNCTION get_match_mvp(p_match_id UUID)
RETURNS UUID AS $$
DECLARE
    v_mvp_player_id UUID;
BEGIN
    SELECT candidate_player_id INTO v_mvp_player_id
    FROM public.match_mvp_votes
    WHERE match_id = p_match_id
    GROUP BY candidate_player_id
    ORDER BY COUNT(*) DESC
    LIMIT 1;

    RETURN v_mvp_player_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STATS UPDATE
-- ============================================

-- Function: Update player stats after match completion
CREATE OR REPLACE FUNCTION update_player_stats_after_match(p_match_id UUID)
RETURNS void AS $$
BEGIN
    -- Increment matches_played for all confirmed signups
    UPDATE public.player_profiles pp
    SET matches_played = matches_played + 1
    FROM public.match_signups ms
    WHERE ms.match_id = p_match_id
    AND ms.player_id = pp.id
    AND ms.status = 'confirmed';

    -- Update MVP count for the match MVP
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- GROUP CREATION HELPER
-- ============================================

-- Function: Create group with creator as admin
CREATE OR REPLACE FUNCTION create_group_with_admin(
    p_name TEXT,
    p_slug TEXT,
    p_description TEXT DEFAULT NULL,
    p_default_match_day SMALLINT DEFAULT 1,
    p_default_match_time TIME DEFAULT '21:00',
    p_default_max_players SMALLINT DEFAULT 14
)
RETURNS public.groups AS $$
DECLARE
    v_group public.groups;
    v_player_id UUID;
BEGIN
    -- Get creator's player profile
    SELECT id INTO v_player_id
    FROM public.player_profiles
    WHERE user_id = auth.uid();

    IF v_player_id IS NULL THEN
        RAISE EXCEPTION 'Player profile not found';
    END IF;

    -- Create the group
    INSERT INTO public.groups (
        name, slug, description, default_match_day, default_match_time,
        default_max_players, created_by_user_id
    )
    VALUES (
        p_name, p_slug, p_description, p_default_match_day, p_default_match_time,
        p_default_max_players, auth.uid()
    )
    RETURNING * INTO v_group;

    -- Add creator as admin
    INSERT INTO public.group_memberships (group_id, player_id, role)
    VALUES (v_group.id, v_player_id, 'admin');

    -- Create default notification settings
    INSERT INTO public.notification_settings (group_id)
    VALUES (v_group.id);

    RETURN v_group;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- INVITE JOIN HELPER
-- ============================================

-- Function: Join group via invite code
CREATE OR REPLACE FUNCTION join_group_via_invite(p_invite_code TEXT)
RETURNS public.group_memberships AS $$
DECLARE
    v_group public.groups;
    v_player_id UUID;
    v_membership public.group_memberships;
BEGIN
    -- Get player profile
    SELECT id INTO v_player_id
    FROM public.player_profiles
    WHERE user_id = auth.uid();

    IF v_player_id IS NULL THEN
        RAISE EXCEPTION 'Player profile not found';
    END IF;

    -- Find group by invite code
    SELECT * INTO v_group
    FROM public.groups
    WHERE invite_code = p_invite_code;

    IF v_group IS NULL THEN
        RAISE EXCEPTION 'Invalid invite code';
    END IF;

    -- Check if already a member
    IF EXISTS (
        SELECT 1 FROM public.group_memberships
        WHERE group_id = v_group.id AND player_id = v_player_id
    ) THEN
        RAISE EXCEPTION 'Already a member of this group';
    END IF;

    -- Add as member
    INSERT INTO public.group_memberships (group_id, player_id, role)
    VALUES (v_group.id, v_player_id, 'member')
    RETURNING * INTO v_membership;

    RETURN v_membership;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- MATCH HISTORY FOR AI
-- ============================================

-- Function: Get recent match history for AI team generation
CREATE OR REPLACE FUNCTION get_recent_match_history(
    p_group_id UUID,
    p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
    match_id UUID,
    match_date TIMESTAMPTZ,
    dark_team_players JSONB,
    light_team_players JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id as match_id,
        m.date_time as match_date,
        (
            SELECT jsonb_agg(jsonb_build_object(
                'player_id', COALESCE(ta.player_id::text, ta.guest_player_id::text),
                'name', COALESCE(pp.display_name, gp.display_name)
            ))
            FROM public.team_assignments ta
            JOIN public.teams t ON t.id = ta.team_id
            LEFT JOIN public.player_profiles pp ON pp.id = ta.player_id
            LEFT JOIN public.guest_players gp ON gp.id = ta.guest_player_id
            WHERE t.match_id = m.id AND t.name = 'dark'
        ) as dark_team_players,
        (
            SELECT jsonb_agg(jsonb_build_object(
                'player_id', COALESCE(ta.player_id::text, ta.guest_player_id::text),
                'name', COALESCE(pp.display_name, gp.display_name)
            ))
            FROM public.team_assignments ta
            JOIN public.teams t ON t.id = ta.team_id
            LEFT JOIN public.player_profiles pp ON pp.id = ta.player_id
            LEFT JOIN public.guest_players gp ON gp.id = ta.guest_player_id
            WHERE t.match_id = m.id AND t.name = 'light'
        ) as light_team_players
    FROM public.matches m
    WHERE m.group_id = p_group_id
    AND m.status = 'finished'
    AND EXISTS (SELECT 1 FROM public.teams t WHERE t.match_id = m.id)
    ORDER BY m.date_time DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
