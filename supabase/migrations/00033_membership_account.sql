-- Membership exits and account deletion (wrap-up track T1, docs/review/wrapup-2026-11-15.md):
--
--   1. OD-1: an admin removal sticks. group_memberships.removed_at / removed_by
--      record it; join_group_via_invite refuses an admin-removed player with
--      'removed_by_admin', get_match_join_info hands them no invite code and
--      get_public_group_by_invite reports viewer_membership = 'removed'. Leaving
--      on your own (leave_group) stays rejoinable. Admins list ex-members with
--      admin_list_removed_members and bring one back with admin_readd_member.
--   2. Audit gap 3: leave_group and admin_remove_member also free the player's
--      spot on upcoming teams_created matches. They cancel through the normal
--      paths (cancel_my_signup / admin_remove_signup), so the waitlist promotes
--      and the match_signups lineup trigger (T2) handles the team slot.
--   3. Audit gap 9: leaving, being removed or deleting the account is not an
--      early or late cancel. Those paths set the transaction-local GUC
--      fulbot.membership_exit = 'on' and emit_cancel_event skips while it is on.
--   4. OD-5: delete_my_account() anonymizes the caller's player profile
--      ("Jugador eliminado", personal fields cleared, history kept), cancels their
--      upcoming signups, deactivates their memberships, deletes the groups where
--      they are the only member, their push subscriptions, the peer ratings they
--      wrote and the notifications addressed to them. It refuses with
--      'last_admin_of_group' while they are the last admin of a group that has
--      other members (account_deletion_blockers() lists those groups). The app
--      then deletes the auth user with the service role (/api/account/delete).
--      Members of the groups the player belonged to can still read the
--      anonymized row, so past lineups and results show "Jugador eliminado".
--   5. Email change: public.users.email follows auth.users.email once the change
--      is confirmed.
--
-- Error codes (the app maps them to ui.membership.* / ui.account.*):
--   'removed_by_admin'     -> join_group_via_invite, admin removed this player
--   'last_admin_of_group'  -> delete_my_account, DETAIL = the group names
--   'not_removed'          -> admin_readd_member on an active membership
--
-- Idempotent: safe to run twice.

-- ============================================
-- 1. REMOVAL STATE ON GROUP MEMBERSHIPS
-- ============================================

-- removed_by is deliberately not a foreign key: a second FK from
-- group_memberships to player_profiles would make every PostgREST embed
-- `group_memberships(..., player_profiles(...))` ambiguous. Profiles are never
-- deleted (account deletion anonymizes them), so the id stays resolvable.
ALTER TABLE public.group_memberships
    ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS removed_by UUID;

ALTER TABLE public.group_memberships
    DROP CONSTRAINT IF EXISTS group_memberships_removed_by_fkey;

COMMENT ON COLUMN public.group_memberships.removed_at IS
    'Set when an admin removed the member (admin_remove_member). The player cannot rejoin with the invite code until an admin re-adds them. NULL for active members and for members who left on their own.';
COMMENT ON COLUMN public.group_memberships.removed_by IS
    'player_profiles.id of the admin who removed the member (no FK, see above).';

-- Not granted to authenticated/anon (00029 grants SELECT column by column):
-- admins read the list through admin_list_removed_members().

CREATE INDEX IF NOT EXISTS idx_group_memberships_removed
    ON public.group_memberships (group_id)
    WHERE removed_at IS NOT NULL;

-- An active membership is never "removed", whichever path reactivated it.
CREATE OR REPLACE FUNCTION public.trg_group_memberships_clear_removal()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
    IF NEW.is_active THEN
        NEW.removed_at := NULL;
        NEW.removed_by := NULL;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_group_memberships_clear_removal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS group_memberships_clear_removal ON public.group_memberships;
CREATE TRIGGER group_memberships_clear_removal
    BEFORE INSERT OR UPDATE ON public.group_memberships
    FOR EACH ROW EXECUTE FUNCTION public.trg_group_memberships_clear_removal();

-- ============================================
-- 2. CANCEL EVENTS SKIP MEMBERSHIP EXITS (gap 9)
-- ============================================

-- Latest body: 00021. New: returns without an event while fulbot.membership_exit
-- is 'on' (set locally by leave_group, admin_remove_member and delete_my_account),
-- and a fixed search_path.
CREATE OR REPLACE FUNCTION public.emit_cancel_event(p_match_id UUID, p_player_id UUID)
RETURNS void AS $$
DECLARE
    v_match public.matches;
    v_hours NUMERIC;
    v_type member_event_type;
BEGIN
    IF p_player_id IS NULL THEN
        RETURN;
    END IF;
    -- Leaving the group, being removed or deleting the account is not a cancel.
    IF current_setting('fulbot.membership_exit', true) = 'on' THEN
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.emit_cancel_event(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_cancel_event(UUID, UUID) TO service_role;

-- ============================================
-- 3. LEAVE A GROUP
-- ============================================

-- Latest body: 00028. New: teams_created matches are included (gap 3) and the
-- cancels do not count as early/late cancels (gap 9). Leaving does not set
-- removed_at, so the player can come back with the invite link.
CREATE OR REPLACE FUNCTION public.leave_group(p_group_id UUID)
RETURNS void AS $$
DECLARE
    v_player_id UUID;
    v_membership public.group_memberships;
    v_prev_exit TEXT;
    r RECORD;
BEGIN
    v_player_id := get_current_player_id();
    IF v_player_id IS NULL THEN
        RAISE EXCEPTION 'Perfil de jugador no encontrado';
    END IF;

    -- Same lock the membership guard takes, so two admins cannot both leave.
    PERFORM 1 FROM public.groups WHERE id = p_group_id FOR UPDATE;

    SELECT * INTO v_membership
    FROM public.group_memberships
    WHERE group_id = p_group_id AND player_id = v_player_id AND is_active
    FOR UPDATE;

    IF v_membership.id IS NULL THEN
        RAISE EXCEPTION 'not_a_member' USING DETAIL = 'No sos miembro de este grupo';
    END IF;

    IF v_membership.role = 'admin' AND NOT EXISTS (
        SELECT 1 FROM public.group_memberships gm
        WHERE gm.group_id = p_group_id AND gm.id <> v_membership.id
          AND gm.role = 'admin' AND gm.is_active
    ) THEN
        RAISE EXCEPTION 'last_admin'
            USING DETAIL = 'El grupo tiene que tener al menos un admin activo';
    END IF;

    v_prev_exit := current_setting('fulbot.membership_exit', true);
    PERFORM set_config('fulbot.membership_exit', 'on', true);

    -- Free the player's spots on matches that are still ahead; cancel_my_signup
    -- promotes the waitlist and renumbers it. This runs before the membership is
    -- deactivated: the promotion notification (emit_notification) requires the
    -- caller to be a member of the group.
    FOR r IN
        SELECT ms.match_id
        FROM public.match_signups ms
        JOIN public.matches m ON m.id = ms.match_id
        WHERE m.group_id = p_group_id
          AND ms.player_id = v_player_id
          AND ms.status IN ('confirmed', 'waitlist')
          AND m.status IN ('signup_open', 'full', 'signup_closed', 'teams_created')
          AND m.date_time > now()
        ORDER BY m.date_time
    LOOP
        PERFORM cancel_my_signup(r.match_id);
    END LOOP;

    UPDATE public.group_memberships
    SET is_active = FALSE
    WHERE id = v_membership.id;

    PERFORM set_config('fulbot.membership_exit', COALESCE(NULLIF(v_prev_exit, ''), 'off'), true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.leave_group(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_group(UUID) TO authenticated, service_role;

-- ============================================
-- 4. REMOVE A MEMBER (ADMIN)
-- ============================================

-- Latest body: 00028. New: the removal is recorded (removed_at / removed_by,
-- OD-1), teams_created matches are included (gap 3) and the cancels are not
-- early/late cancels (gap 9). A member who already left can still be marked as
-- removed, so the invite link stops working for them too.
CREATE OR REPLACE FUNCTION public.admin_remove_member(p_membership_id UUID)
RETURNS void AS $$
DECLARE
    v_membership public.group_memberships;
    v_actor UUID;
    v_prev_exit TEXT;
    r RECORD;
BEGIN
    SELECT * INTO v_membership
    FROM public.group_memberships
    WHERE id = p_membership_id
    FOR UPDATE;

    IF v_membership.id IS NULL THEN
        RAISE EXCEPTION 'Membresía no encontrada';
    END IF;

    IF NOT is_group_admin(v_membership.group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para esta acción' USING ERRCODE = '42501';
    END IF;

    v_actor := get_current_player_id();

    IF v_membership.player_id = v_actor THEN
        RAISE EXCEPTION 'use_leave_group' USING DETAIL = 'Para salir del grupo usá leave_group';
    END IF;

    IF NOT v_membership.is_active THEN
        IF v_membership.removed_at IS NULL THEN
            UPDATE public.group_memberships
            SET removed_at = now(), removed_by = v_actor
            WHERE id = v_membership.id;
        END IF;
        RETURN;
    END IF;

    v_prev_exit := current_setting('fulbot.membership_exit', true);
    PERFORM set_config('fulbot.membership_exit', 'on', true);

    -- The membership guard (00024) still stops the last active admin going away.
    UPDATE public.group_memberships
    SET is_active = FALSE, removed_at = now(), removed_by = v_actor
    WHERE id = v_membership.id;

    FOR r IN
        SELECT ms.id
        FROM public.match_signups ms
        JOIN public.matches m ON m.id = ms.match_id
        WHERE m.group_id = v_membership.group_id
          AND ms.player_id = v_membership.player_id
          AND ms.status IN ('confirmed', 'waitlist')
          AND m.status IN ('signup_open', 'full', 'signup_closed', 'teams_created')
          AND m.date_time > now()
        ORDER BY m.date_time
    LOOP
        PERFORM admin_remove_signup(r.id);
    END LOOP;

    PERFORM set_config('fulbot.membership_exit', COALESCE(NULLIF(v_prev_exit, ''), 'off'), true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.admin_remove_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_member(UUID) TO authenticated, service_role;

-- ============================================
-- 5. EX-MEMBERS: LIST AND RE-ADD (ADMIN)
-- ============================================

-- Admin-removed players of a group, newest first. Deleted accounts are left out
-- (there is nobody to bring back).
CREATE OR REPLACE FUNCTION public.admin_list_removed_members(p_group_id UUID)
RETURNS TABLE (
    membership_id UUID,
    player_id UUID,
    display_name TEXT,
    removed_at TIMESTAMPTZ,
    removed_by_name TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NOT is_group_admin(p_group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para esta acción' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT gm.id, pp.id, pp.display_name, gm.removed_at, rb.display_name
    FROM public.group_memberships gm
    JOIN public.player_profiles pp ON pp.id = gm.player_id
    LEFT JOIN public.player_profiles rb ON rb.id = gm.removed_by
    WHERE gm.group_id = p_group_id
      AND NOT gm.is_active
      AND gm.removed_at IS NOT NULL
      AND pp.deleted_at IS NULL
    ORDER BY gm.removed_at DESC;
END;
$$;

-- Restores a former member as a plain member and clears the removal.
CREATE OR REPLACE FUNCTION public.admin_readd_member(p_membership_id UUID)
RETURNS public.group_memberships
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_membership public.group_memberships;
BEGIN
    SELECT * INTO v_membership
    FROM public.group_memberships
    WHERE id = p_membership_id
    FOR UPDATE;

    IF v_membership.id IS NULL THEN
        RAISE EXCEPTION 'Membresía no encontrada';
    END IF;

    IF NOT is_group_admin(v_membership.group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para esta acción' USING ERRCODE = '42501';
    END IF;

    IF v_membership.is_active THEN
        RAISE EXCEPTION 'not_removed' USING DETAIL = 'Ya es miembro del grupo';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.player_profiles
        WHERE id = v_membership.player_id AND deleted_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Membresía no encontrada';
    END IF;

    -- group_memberships_clear_removal clears removed_at / removed_by.
    UPDATE public.group_memberships
    SET is_active = TRUE, role = 'member'
    WHERE id = v_membership.id
    RETURNING * INTO v_membership;

    RETURN v_membership;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_removed_members(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_removed_members(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_readd_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_readd_member(UUID) TO authenticated, service_role;

-- ============================================
-- 6. JOIN PATHS REFUSE ADMIN-REMOVED PLAYERS
-- ============================================

-- Latest body: 00024. New: an admin-removed player gets 'removed_by_admin'; a
-- player who left on their own is still reactivated as a plain member.
CREATE OR REPLACE FUNCTION public.join_group_via_invite(p_invite_code TEXT)
RETURNS public.group_memberships AS $$
DECLARE
    v_group public.groups;
    v_player_id UUID;
    v_membership public.group_memberships;
BEGIN
    SELECT id INTO v_player_id
    FROM public.player_profiles
    WHERE user_id = auth.uid();

    IF v_player_id IS NULL THEN
        RAISE EXCEPTION 'Player profile not found';
    END IF;

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

        IF v_membership.removed_at IS NOT NULL THEN
            RAISE EXCEPTION 'removed_by_admin'
                USING DETAIL = 'Un admin te sacó de este grupo';
        END IF;

        -- Left on their own earlier: come back as a plain member
        UPDATE public.group_memberships
        SET is_active = TRUE, role = 'member'
        WHERE id = v_membership.id
        RETURNING * INTO v_membership;

        RETURN v_membership;
    END IF;

    INSERT INTO public.group_memberships (group_id, player_id, role)
    VALUES (v_group.id, v_player_id, 'member')
    RETURNING * INTO v_membership;

    RETURN v_membership;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.join_group_via_invite(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_group_via_invite(TEXT) TO authenticated, service_role;

-- Latest body: 00025. New: viewer_membership is 'removed' for an admin-removed
-- visitor, so the invite page explains instead of offering the join button.
CREATE OR REPLACE FUNCTION public.get_public_group_by_invite(p_invite_code TEXT)
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
            SELECT CASE
                       WHEN gm.is_active THEN 'active'
                       WHEN gm.removed_at IS NOT NULL THEN 'removed'
                       ELSE 'inactive'
                   END
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
              AND m.status IN ('signup_open', 'full', 'signup_closed', 'teams_created')
              AND m.date_time > NOW() - INTERVAL '2 hours'
            ORDER BY m.date_time ASC
            LIMIT 1
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_public_group_by_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_group_by_invite(TEXT) TO anon, authenticated, service_role;

-- Latest body: 00024. New: an admin-removed visitor gets no invite code, only
-- { group_id, invite_code: null, removed: true }, so /m explains instead of
-- offering "Unirme y anotarme".
CREATE OR REPLACE FUNCTION public.get_match_join_info(p_match_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_group_id UUID;
    v_invite_code TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NULL;
    END IF;

    -- Only while the match is taking signups: a finished or cancelled match id
    -- (for example one read from another group's badges) is not an invite.
    SELECT g.id, g.invite_code
    INTO v_group_id, v_invite_code
    FROM public.matches m
    JOIN public.groups g ON g.id = m.group_id
    WHERE m.id = p_match_id
      AND m.status IN ('signup_open', 'full', 'signup_closed')
      AND m.date_time > NOW() - INTERVAL '2 hours';

    IF v_group_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.group_memberships gm
        JOIN public.player_profiles pp ON pp.id = gm.player_id
        WHERE gm.group_id = v_group_id
          AND pp.user_id = auth.uid()
          AND NOT gm.is_active
          AND gm.removed_at IS NOT NULL
    ) THEN
        RETURN jsonb_build_object('group_id', v_group_id, 'invite_code', NULL, 'removed', TRUE);
    END IF;

    RETURN jsonb_build_object('group_id', v_group_id, 'invite_code', v_invite_code, 'removed', FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.get_match_join_info(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_match_join_info(UUID) TO authenticated, service_role;

-- ============================================
-- 7. ACCOUNT DELETION (OD-5)
-- ============================================

ALTER TABLE public.player_profiles
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.player_profiles.deleted_at IS
    'Set when the player deleted their account (delete_my_account). The row is anonymized and kept so past lineups, results and stats survive.';

-- The anonymized row carries no personal data. Members of a group the player
-- belonged to can read it, so past lineups, results and the group table show
-- "Jugador eliminado" instead of an empty slot.
DROP POLICY IF EXISTS "Members can read deleted players of their groups" ON public.player_profiles;
CREATE POLICY "Members can read deleted players of their groups"
    ON public.player_profiles FOR SELECT
    USING (
        deleted_at IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM public.group_memberships gm
            WHERE gm.player_id = player_profiles.id
              AND is_group_member(gm.group_id)
        )
    );

-- Groups that stop the caller from deleting their account: they are the only
-- active admin and the group has other active members.
CREATE OR REPLACE FUNCTION public.account_deletion_blockers()
RETURNS TABLE (group_id UUID, group_name TEXT, group_slug TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT g.id, g.name, g.slug
    FROM public.group_memberships me
    JOIN public.groups g ON g.id = me.group_id
    WHERE me.player_id = public.get_current_player_id()
      AND me.is_active
      AND me.role = 'admin'
      AND NOT EXISTS (
          SELECT 1 FROM public.group_memberships o
          WHERE o.group_id = me.group_id AND o.id <> me.id AND o.is_active AND o.role = 'admin'
      )
      AND EXISTS (
          SELECT 1 FROM public.group_memberships o
          WHERE o.group_id = me.group_id AND o.id <> me.id AND o.is_active
      )
    ORDER BY g.name;
$$;

REVOKE ALL ON FUNCTION public.account_deletion_blockers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_deletion_blockers() TO authenticated, service_role;

-- Everything account deletion does in the database, as the signed-in user. The
-- auth user itself is deleted afterwards by the app with the service role
-- (auth.admin.deleteUser), which also removes public.users and anything left
-- that cascades from it. Safe to call again after a failed auth deletion.
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_player UUID;
    v_blockers TEXT;
    v_prev_exit TEXT;
    v_deleted_groups INTEGER := 0;
    r RECORD;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    v_player := get_current_player_id();

    IF v_player IS NOT NULL THEN
        -- Same lock as leave_group and the membership guard, so nobody becomes
        -- the last admin or joins a solo group while this runs.
        PERFORM 1 FROM public.groups g
        WHERE g.id IN (
            SELECT gm.group_id FROM public.group_memberships gm
            WHERE gm.player_id = v_player AND gm.is_active
        )
        ORDER BY g.id
        FOR UPDATE;

        SELECT string_agg(b.group_name, ', ' ORDER BY b.group_name)
        INTO v_blockers
        FROM public.account_deletion_blockers() b;

        IF v_blockers IS NOT NULL THEN
            RAISE EXCEPTION 'last_admin_of_group' USING DETAIL = v_blockers;
        END IF;

        v_prev_exit := current_setting('fulbot.membership_exit', true);
        PERFORM set_config('fulbot.membership_exit', 'on', true);

        -- Upcoming signups first, while the memberships are still active (the
        -- promotion notification checks the caller's membership).
        FOR r IN
            SELECT ms.match_id
            FROM public.match_signups ms
            JOIN public.matches m ON m.id = ms.match_id
            WHERE ms.player_id = v_player
              AND ms.status IN ('confirmed', 'waitlist')
              AND m.status IN ('signup_open', 'full', 'signup_closed', 'teams_created')
              AND m.date_time > now()
            ORDER BY m.date_time
        LOOP
            PERFORM cancel_my_signup(r.match_id);
        END LOOP;

        -- A group where the player is the only active member has nobody left
        -- to use it: it goes with the account.
        DELETE FROM public.groups g
        WHERE g.id IN (
            SELECT gm.group_id FROM public.group_memberships gm
            WHERE gm.player_id = v_player AND gm.is_active
              AND NOT EXISTS (
                  SELECT 1 FROM public.group_memberships o
                  WHERE o.group_id = gm.group_id AND o.id <> gm.id AND o.is_active
              )
        );
        GET DIAGNOSTICS v_deleted_groups = ROW_COUNT;

        UPDATE public.group_memberships
        SET is_active = FALSE
        WHERE player_id = v_player AND is_active;

        -- Ratings they gave go; ratings about them stay with the anonymized row.
        DELETE FROM public.peer_ratings WHERE voter_player_id = v_player;

        DELETE FROM public.notification_reads WHERE player_id = v_player;
        DELETE FROM public.notifications
        WHERE recipient_player_id = v_player
           OR (type = 'rate_new_member' AND payload->>'player_id' = v_player::text);

        UPDATE public.player_profiles
        SET display_name = 'Jugador eliminado',
            nickname = NULL,
            preferred_positions = ARRAY['CM']::TEXT[],
            main_position = 'CM',
            footedness = 'right',
            goalkeeper_willingness = 0,
            fitness_status = 'ok',
            user_id = NULL,
            deleted_at = COALESCE(deleted_at, now())
        WHERE id = v_player;

        PERFORM set_config('fulbot.membership_exit', COALESCE(NULLIF(v_prev_exit, ''), 'off'), true);
    END IF;

    DELETE FROM public.push_subscriptions WHERE user_id = v_uid;

    UPDATE public.users
    SET name = 'Jugador eliminado', avatar_url = NULL, notification_prefs = '{}'::jsonb
    WHERE id = v_uid;

    RETURN jsonb_build_object('deleted_groups', v_deleted_groups);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated, service_role;

-- ============================================
-- 8. EMAIL CHANGE
-- ============================================

-- public.users.email mirrors auth.users.email (00024 keeps users from writing
-- it themselves). Supabase Auth updates auth.users once the change is
-- confirmed; this copies it.
CREATE OR REPLACE FUNCTION public.handle_user_email_changed()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NEW.email IS NOT NULL AND NEW.email IS DISTINCT FROM OLD.email THEN
        UPDATE public.users SET email = NEW.email WHERE id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_user_email_changed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_user_email_changed();
