-- 00037: fixes from the independent audit of the 2026-11-15 wrap-up
-- (docs/review/wrapup-2026-11-15.md, "Audit and follow-ups").
--
-- H1  match_ratings (post-match ratings) were readable, voter ids included, by
--     every member of the group, although the rating card and the privacy page
--     say nobody else sees them. Players now read only their own rows; the
--     player page average comes from get_player_match_rating_avg().
-- M1  promote_from_waitlist skipped waitlisted rows with a NULL
--     waitlist_reason (organizer-added guests, admin moves, legacy rows) while
--     a priority window or reserved period was running: NOT (true AND NULL)
--     is NULL. Compare through COALESCE.
-- M2  players who left or were removed vanished from past lineups and results
--     because their profile was only readable with an active membership.
--     Members now read the profiles of anyone who has ever been a member of
--     one of their groups.
-- L3  account deletion left group rules naming the deleted player.
-- L4  six older SECURITY DEFINER signup functions had no pinned search_path.
--
-- Idempotent: safe to apply more than once.

-- ============================================
-- H1: post-match ratings are private to the voter
-- ============================================

DROP POLICY IF EXISTS "Members can read ratings" ON public.match_ratings;
DROP POLICY IF EXISTS "Players can read their own ratings" ON public.match_ratings;
CREATE POLICY "Players can read their own ratings"
    ON public.match_ratings FOR SELECT
    USING (voter_player_id = get_current_player_id());

-- Average post-match rating a player received in one group's matches, for the
-- player page. Only members of that group get an answer; no voter is exposed.
CREATE OR REPLACE FUNCTION public.get_player_match_rating_avg(p_group_id UUID, p_player_id UUID)
RETURNS TABLE (avg_rating NUMERIC, ratings INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT is_group_member(p_group_id) THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT ROUND(AVG(mr.rating)::NUMERIC, 2), COUNT(*)::INTEGER
    FROM public.match_ratings mr
    JOIN public.matches m ON m.id = mr.match_id
    WHERE m.group_id = p_group_id
      AND mr.rated_player_id = p_player_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_player_match_rating_avg(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_player_match_rating_avg(UUID, UUID) TO authenticated, service_role;

-- ============================================
-- M1: NULL-safe priority filters when promoting from the waitlist
-- ============================================

CREATE OR REPLACE FUNCTION public.promote_from_waitlist(p_match_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_match public.matches;
    v_confirmed_count INTEGER;
    v_promoted_id UUID;
    v_promoted_player_id UUID;
    v_promoted_guest_id UUID;
    v_promoted_name TEXT;
    v_team TEXT;
    v_position TEXT;
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

    IF v_match.status NOT IN ('signup_open', 'full', 'signup_closed', 'teams_created') THEN
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
            AND NOT (v_window_open AND COALESCE(waitlist_reason, '') = 'priority_window')
            AND NOT (v_reserved_active AND COALESCE(waitlist_reason, '') = 'reserved')
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

            -- The slot the sync trigger gave them, if the teams are out.
            IF v_match.status = 'teams_created' THEN
                SELECT t.name::TEXT, ta.position INTO v_team, v_position
                FROM public.team_assignments ta
                JOIN public.teams t ON t.id = ta.team_id
                WHERE t.match_id = p_match_id
                  AND ((v_promoted_player_id IS NOT NULL AND ta.player_id = v_promoted_player_id)
                    OR (v_promoted_guest_id IS NOT NULL AND ta.guest_player_id = v_promoted_guest_id))
                LIMIT 1;
            END IF;

            PERFORM emit_notification(
                v_match.group_id,
                p_match_id,
                'waitlist_promoted',
                jsonb_build_object(
                    'signup_id', v_promoted_id,
                    'player_name', v_promoted_name,
                    'recipient_player_id', v_promoted_player_id,
                    'team', v_team,
                    'position', v_position
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
$function$;


-- ============================================
-- M2: past members stay visible in their groups' history
-- ============================================

DROP POLICY IF EXISTS "Users can read player profiles in their groups" ON public.player_profiles;
CREATE POLICY "Users can read player profiles in their groups"
    ON public.player_profiles FOR SELECT
    USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.group_memberships gm
            WHERE gm.player_id = player_profiles.id
              AND is_group_member(gm.group_id)
        )
    );

-- ============================================
-- L3: account deletion drops the group rules that name the player
-- ============================================

CREATE OR REPLACE FUNCTION public.trg_player_profiles_drop_rules_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.rule_sets
    WHERE data ? 'player_ids'
      AND (data -> 'player_ids') ? NEW.id::TEXT;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_player_profiles_drop_rules_on_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS player_profiles_drop_rules_on_delete ON public.player_profiles;
CREATE TRIGGER player_profiles_drop_rules_on_delete
    AFTER UPDATE OF deleted_at ON public.player_profiles
    FOR EACH ROW
    WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
    EXECUTE FUNCTION public.trg_player_profiles_drop_rules_on_delete();

-- Accounts deleted before this migration.
DELETE FROM public.rule_sets r
WHERE r.data ? 'player_ids'
  AND EXISTS (
      SELECT 1 FROM public.player_profiles p
      WHERE p.deleted_at IS NOT NULL
        AND (r.data -> 'player_ids') ? p.id::TEXT
  );

-- ============================================
-- L4: pin search_path on the older signup functions
-- ============================================

ALTER FUNCTION public.signup_for_match(UUID, TEXT, TEXT) SET search_path = public;
ALTER FUNCTION public.cancel_my_signup(UUID) SET search_path = public;
ALTER FUNCTION public.cancel_guest_signup(UUID, UUID) SET search_path = public;
ALTER FUNCTION public.admin_remove_signup(UUID) SET search_path = public;
ALTER FUNCTION public.admin_add_guest_signup(UUID, TEXT, TEXT, NUMERIC, TEXT[]) SET search_path = public;
ALTER FUNCTION public.admin_set_signup_status(UUID, signup_status) SET search_path = public;
