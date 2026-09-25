-- Security hardening: group membership lifecycle and table authorization.
-- (docs/review/recheck-2026-09-24.md: B S1-S4, P1-P3, C #9-#10, D-14, D-17, E #3, A-P9)
--
--   1. group_memberships: no self-insert. Joining goes through join_group_via_invite,
--      which validates the invite code and now reactivates a removed member (role
--      member) instead of failing. UPDATE gets a WITH CHECK, and a trigger keeps
--      the last active admin from being demoted or removed.
--   2. groups: readable by members only. Public surfaces use SECURITY DEFINER RPCs
--      (get_public_group_by_invite, get_match_join_info). Admins can delete a group.
--   3. player_badges: badges are written only by SECURITY DEFINER SQL
--      (award_badges_for_match, recompute_player_stats); drop the open INSERT policy.
--   4. match_signups: members write only through the signup RPCs; drop the leftover
--      member INSERT/UPDATE policies that bypassed capacity and priority rules.
--   5. get_recent_match_history checks membership; save_team_assignments is reachable
--      only through publish_match_teams.
--   6. users: UPDATE gets WITH CHECK, and id/email cannot be changed by the user.

-- ============================================
-- 1. GROUP MEMBERSHIPS
-- ============================================

DROP POLICY IF EXISTS "Admins can insert memberships" ON public.group_memberships;
CREATE POLICY "Admins can insert memberships"
    ON public.group_memberships FOR INSERT
    WITH CHECK (is_group_admin(group_id));

DROP POLICY IF EXISTS "Admins can update memberships" ON public.group_memberships;
CREATE POLICY "Admins can update memberships"
    ON public.group_memberships FOR UPDATE
    USING (is_group_admin(group_id))
    WITH CHECK (is_group_admin(group_id));

-- Last-admin guard. Only enforced for end-user requests (auth.uid() set): the seed,
-- migrations and service-role jobs run without a user. When the group itself is
-- being deleted the cascade removes its memberships after the group row is gone,
-- so the guard steps aside.
CREATE OR REPLACE FUNCTION public.trg_group_memberships_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'UPDATE' AND (NEW.group_id <> OLD.group_id OR NEW.player_id <> OLD.player_id) THEN
        RAISE EXCEPTION 'No se puede mover una membresía a otro grupo o jugador';
    END IF;

    IF OLD.role = 'admin' AND OLD.is_active
       AND (TG_OP = 'DELETE' OR NEW.role <> 'admin' OR NOT NEW.is_active)
       AND EXISTS (SELECT 1 FROM public.groups g WHERE g.id = OLD.group_id)
       AND NOT EXISTS (
           SELECT 1 FROM public.group_memberships gm
           WHERE gm.group_id = OLD.group_id
             AND gm.id <> OLD.id
             AND gm.role = 'admin'
             AND gm.is_active
       ) THEN
        RAISE EXCEPTION 'El grupo tiene que tener al menos un admin activo';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_group_memberships_guard() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS group_memberships_guard ON public.group_memberships;
CREATE TRIGGER group_memberships_guard
    BEFORE UPDATE OR DELETE ON public.group_memberships
    FOR EACH ROW EXECUTE FUNCTION public.trg_group_memberships_guard();

-- Join via invite code (latest body: 00004). Idempotent now: an active member gets
-- their row back, a removed (inactive) member is reactivated as a plain member.
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

    SELECT * INTO v_membership
    FROM public.group_memberships
    WHERE group_id = v_group.id AND player_id = v_player_id
    FOR UPDATE;

    IF v_membership.id IS NOT NULL THEN
        IF v_membership.is_active THEN
            RETURN v_membership;
        END IF;

        -- Removed earlier: come back as a plain member
        UPDATE public.group_memberships
        SET is_active = TRUE, role = 'member'
        WHERE id = v_membership.id
        RETURNING * INTO v_membership;

        RETURN v_membership;
    END IF;

    -- Add as member
    INSERT INTO public.group_memberships (group_id, player_id, role)
    VALUES (v_group.id, v_player_id, 'member')
    RETURNING * INTO v_membership;

    RETURN v_membership;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION join_group_via_invite(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION join_group_via_invite(TEXT) TO authenticated, service_role;

-- ============================================
-- 2. GROUPS
-- ============================================

DROP POLICY IF EXISTS "Anyone can read group by invite code" ON public.groups;

DROP POLICY IF EXISTS "Admins can delete their groups" ON public.groups;
CREATE POLICY "Admins can delete their groups"
    ON public.groups FOR DELETE
    USING (is_group_admin(id));

-- Admins keep their groups on update (no moving the row out from under the policy).
DROP POLICY IF EXISTS "Admins can update their groups" ON public.groups;
CREATE POLICY "Admins can update their groups"
    ON public.groups FOR UPDATE
    USING (is_group_admin(id))
    WITH CHECK (is_group_admin(id));

-- Public view of a group through its invite code (latest body: 00016). Adds
-- viewer_membership ('active' | 'inactive' | null) so the invite page can tell a
-- removed member apart: that row is invisible to them under RLS.
CREATE OR REPLACE FUNCTION get_public_group_by_invite(p_invite_code TEXT)
RETURNS JSONB AS $$
DECLARE
    v_group public.groups;
    v_result JSONB;
BEGIN
    SELECT * INTO v_group FROM public.groups WHERE invite_code = p_invite_code;
    IF v_group IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT jsonb_build_object(
        'id', v_group.id,
        'name', v_group.name,
        'slug', v_group.slug,
        'description', v_group.description,
        'default_match_day', v_group.default_match_day,
        'default_match_time', v_group.default_match_time,
        'timezone', v_group.timezone,
        'member_count', (
            SELECT COUNT(*) FROM public.group_memberships gm
            WHERE gm.group_id = v_group.id AND gm.is_active = TRUE
        ),
        'viewer_membership', (
            SELECT CASE WHEN gm.is_active THEN 'active' ELSE 'inactive' END
            FROM public.group_memberships gm
            JOIN public.player_profiles pp ON pp.id = gm.player_id
            WHERE gm.group_id = v_group.id AND auth.uid() IS NOT NULL AND pp.user_id = auth.uid()
            LIMIT 1
        ),
        'next_match', (
            SELECT jsonb_build_object(
                'id', m.id,
                'date_time', m.date_time,
                'location', m.location,
                'status', m.status,
                'max_players', m.max_players,
                'confirmed_count', (
                    SELECT COUNT(*) FROM public.match_signups ms
                    WHERE ms.match_id = m.id AND ms.status = 'confirmed'
                )
            )
            FROM public.matches m
            WHERE m.group_id = v_group.id
              AND m.status IN ('signup_open', 'full')
              AND m.date_time > NOW() - INTERVAL '2 hours'
            ORDER BY m.date_time ASC
            LIMIT 1
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION get_public_group_by_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_group_by_invite(TEXT) TO anon, authenticated, service_role;

-- The public match page (/m/[id]) lets a signed-in non-member join the group and
-- sign up in one step, so the match link works as an invite. It used to read
-- groups.invite_code directly; this returns just what that flow needs.
CREATE OR REPLACE FUNCTION get_match_join_info(p_match_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT jsonb_build_object('group_id', g.id, 'invite_code', g.invite_code)
    INTO v_result
    FROM public.matches m
    JOIN public.groups g ON g.id = m.group_id
    WHERE m.id = p_match_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION get_match_join_info(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_match_join_info(UUID) TO authenticated, service_role;

-- ============================================
-- 3. PLAYER BADGES
-- ============================================

DROP POLICY IF EXISTS "System can insert badges" ON public.player_badges;

-- ============================================
-- 4. MATCH SIGNUPS
-- ============================================

DROP POLICY IF EXISTS "Members can create their own signups" ON public.match_signups;
DROP POLICY IF EXISTS "Members can update their own signups" ON public.match_signups;

-- ============================================
-- 5. TEAM RPCS
-- ============================================

-- Latest body: 00004 (grant in 00008). Only the caller's own groups.
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
    IF auth.uid() IS NOT NULL AND NOT is_group_member(p_group_id) THEN
        RAISE EXCEPTION 'No sos miembro de este grupo';
    END IF;

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- publish_match_teams (00023) validates the lineup and calls save_team_assignments
-- as the function owner, so end users no longer need to execute it directly.
REVOKE EXECUTE ON FUNCTION public.save_team_assignments(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_team_assignments(UUID, JSONB) TO service_role;

-- ============================================
-- 6. USERS
-- ============================================

DROP POLICY IF EXISTS "Users can update their own data" ON public.users;
CREATE POLICY "Users can update their own data"
    ON public.users FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- id and email mirror auth.users; a signed-in user cannot rewrite them.
CREATE OR REPLACE FUNCTION public.trg_users_protect_identity()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NOT NULL
       AND (NEW.id <> OLD.id OR NEW.email IS DISTINCT FROM OLD.email) THEN
        RAISE EXCEPTION 'No se puede cambiar el id ni el email del usuario';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_users_protect_identity() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS users_protect_identity ON public.users;
CREATE TRIGGER users_protect_identity
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.trg_users_protect_identity();

-- handle_user_deleted (00002) was defined for auth.users deletes but never attached.
-- It is a no-op today (ON DELETE CASCADE / SET NULL do the cleanup); wiring it up
-- keeps a single place for future cleanup.
DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
    AFTER DELETE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_user_deleted();
