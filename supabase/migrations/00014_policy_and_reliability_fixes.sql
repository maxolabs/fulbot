-- Fix: the player_profiles SELECT policy from 00003 joined player_profiles inside its
-- own USING clause, which Postgres rejects with "infinite recursion detected in policy"
-- as soon as an authenticated user reads another player's profile (signup lists, team
-- pages, rules editor). Route the membership check through the SECURITY DEFINER helper
-- instead, which is what every other policy already does.

DROP POLICY IF EXISTS "Users can read player profiles in their groups" ON public.player_profiles;

CREATE POLICY "Users can read player profiles in their groups"
    ON public.player_profiles FOR SELECT
    USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.group_memberships gm
            WHERE gm.player_id = player_profiles.id
            AND gm.is_active = TRUE
            AND is_group_member(gm.group_id)
        )
    );

-- ============================================
-- Reliability: recompute when an admin marks a no-show (or reverts one).
-- Reliability was only recomputed inside finalize_match_results, so no-shows marked
-- after loading results never affected the score.
-- ============================================

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
        waitlist_position = CASE WHEN p_status = 'waitlist' THEN waitlist_position ELSE NULL END
    WHERE id = p_signup_id;

    -- Only promote while the match is still tracking signups; a no-show on a finished
    -- match must not pull someone off the waitlist.
    IF v_was_confirmed AND p_status != 'confirmed'
       AND v_match.status IN ('signup_open', 'full', 'signup_closed') THEN
        PERFORM promote_from_waitlist(v_match.id);
    END IF;

    IF v_signup.player_id IS NOT NULL THEN
        PERFORM update_player_reliability(v_signup.player_id);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION admin_set_signup_status(UUID, signup_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_set_signup_status(UUID, signup_status) TO authenticated, service_role;
