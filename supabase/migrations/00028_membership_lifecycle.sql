-- Membership lifecycle, group time zone and group settings.
-- (fix track groups-membership: GRP-1, GRP-2a, GRP-3, GRP-4, GRP-9, ONB-6)
--
--   1. groups: the time zone is validated against pg_timezone_names on insert and
--      update (NULL falls back to the Buenos Aires default), and the slug 'new' is
--      rejected because /groups/new is the static create route.
--   2. create_group_with_admin takes an optional p_timezone. The 6-argument version
--      is dropped: a second overload with a defaulted parameter would make every
--      named call without p_timezone ambiguous.
--   3. regenerate_invite_code: admins rotate the invite link. The old link stops
--      working at once. (Blocking rejoin by removed members is a separate decision.)
--   4. leave_group: a member deactivates their own membership and their signups on
--      upcoming matches are cancelled through cancel_my_signup, so the waitlist
--      promotes. The last active admin cannot leave (raises 'last_admin').
--   5. admin_remove_member: an admin deactivates another member and cancels their
--      signups on upcoming matches through admin_remove_signup (promotion and
--      notifications run as for a manual removal).
--   6. player_profiles.profile_completed_at: set when the player saves their profile
--      (or dismisses the "tell us where you play" prompt). NULL means the positions
--      and goalkeeper willingness are still the column defaults nobody chose.

-- ============================================
-- 1. GROUPS: TIME ZONE AND RESERVED SLUGS
-- ============================================

CREATE OR REPLACE FUNCTION public.trg_groups_validate_timezone()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
    IF NEW.timezone IS NULL OR btrim(NEW.timezone) = '' THEN
        NEW.timezone := 'America/Argentina/Buenos_Aires';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.timezone) THEN
        RAISE EXCEPTION 'invalid_timezone'
            USING ERRCODE = '22023', DETAIL = format('Zona horaria inválida: %s', NEW.timezone);
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_groups_validate_timezone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS groups_validate_timezone ON public.groups;
CREATE TRIGGER groups_validate_timezone
    BEFORE INSERT OR UPDATE OF timezone ON public.groups
    FOR EACH ROW EXECUTE FUNCTION public.trg_groups_validate_timezone();

-- A group created with the slug 'new' could never be opened (/groups/new is the
-- create form). Move any such group out of the way before adding the check.
UPDATE public.groups
SET slug = 'new-' || left(replace(id::text, '-', ''), 6)
WHERE slug = 'new';

ALTER TABLE public.groups DROP CONSTRAINT IF EXISTS groups_slug_not_reserved;
ALTER TABLE public.groups
    ADD CONSTRAINT groups_slug_not_reserved CHECK (slug <> 'new');

-- ============================================
-- 2. CREATE GROUP WITH A TIME ZONE
-- ============================================

-- Latest body: 00004. Adds p_timezone and a fixed search_path.
DROP FUNCTION IF EXISTS public.create_group_with_admin(TEXT, TEXT, TEXT, SMALLINT, TIME, SMALLINT);

CREATE OR REPLACE FUNCTION public.create_group_with_admin(
    p_name TEXT,
    p_slug TEXT,
    p_description TEXT DEFAULT NULL,
    p_default_match_day SMALLINT DEFAULT 1,
    p_default_match_time TIME DEFAULT '21:00',
    p_default_max_players SMALLINT DEFAULT 14,
    p_timezone TEXT DEFAULT NULL
)
RETURNS public.groups AS $$
DECLARE
    v_group public.groups;
    v_player_id UUID;
BEGIN
    SELECT id INTO v_player_id
    FROM public.player_profiles
    WHERE user_id = auth.uid();

    IF v_player_id IS NULL THEN
        RAISE EXCEPTION 'Player profile not found';
    END IF;

    -- groups_validate_timezone fills in the default and rejects unknown zones.
    INSERT INTO public.groups (
        name, slug, description, default_match_day, default_match_time,
        default_max_players, created_by_user_id, timezone
    )
    VALUES (
        p_name, p_slug, p_description, p_default_match_day, p_default_match_time,
        p_default_max_players, auth.uid(), NULLIF(btrim(p_timezone), '')
    )
    RETURNING * INTO v_group;

    INSERT INTO public.group_memberships (group_id, player_id, role)
    VALUES (v_group.id, v_player_id, 'admin');

    INSERT INTO public.notification_settings (group_id)
    VALUES (v_group.id);

    RETURN v_group;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.create_group_with_admin(TEXT, TEXT, TEXT, SMALLINT, TIME, SMALLINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group_with_admin(TEXT, TEXT, TEXT, SMALLINT, TIME, SMALLINT, TEXT) TO authenticated, service_role;

-- ============================================
-- 3. ROTATE THE INVITE CODE
-- ============================================

CREATE OR REPLACE FUNCTION public.regenerate_invite_code(p_group_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_code TEXT;
BEGIN
    IF NOT is_group_admin(p_group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para esta acción' USING ERRCODE = '42501';
    END IF;

    -- 48 random bits; retry on the (very unlikely) collision.
    FOR i IN 1..5 LOOP
        BEGIN
            v_code := encode(gen_random_bytes(6), 'hex');
            UPDATE public.groups SET invite_code = v_code WHERE id = p_group_id;
            RETURN v_code;
        EXCEPTION WHEN unique_violation THEN
            -- try another code
        END;
    END LOOP;

    RAISE EXCEPTION 'No se pudo generar un código de invitación nuevo';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION public.regenerate_invite_code(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_invite_code(UUID) TO authenticated, service_role;

-- ============================================
-- 4. LEAVE A GROUP
-- ============================================

CREATE OR REPLACE FUNCTION public.leave_group(p_group_id UUID)
RETURNS void AS $$
DECLARE
    v_player_id UUID;
    v_membership public.group_memberships;
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
          AND m.status IN ('signup_open', 'full', 'signup_closed')
          AND m.date_time > now()
        ORDER BY m.date_time
    LOOP
        PERFORM cancel_my_signup(r.match_id);
    END LOOP;

    UPDATE public.group_memberships
    SET is_active = FALSE
    WHERE id = v_membership.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.leave_group(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_group(UUID) TO authenticated, service_role;

-- ============================================
-- 5. REMOVE A MEMBER (ADMIN)
-- ============================================

CREATE OR REPLACE FUNCTION public.admin_remove_member(p_membership_id UUID)
RETURNS void AS $$
DECLARE
    v_membership public.group_memberships;
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

    IF v_membership.player_id = get_current_player_id() THEN
        RAISE EXCEPTION 'use_leave_group' USING DETAIL = 'Para salir del grupo usá leave_group';
    END IF;

    IF NOT v_membership.is_active THEN
        RETURN;
    END IF;

    -- The membership guard (00024) still stops the last active admin going away.
    UPDATE public.group_memberships
    SET is_active = FALSE
    WHERE id = v_membership.id;

    FOR r IN
        SELECT ms.id
        FROM public.match_signups ms
        JOIN public.matches m ON m.id = ms.match_id
        WHERE m.group_id = v_membership.group_id
          AND ms.player_id = v_membership.player_id
          AND ms.status IN ('confirmed', 'waitlist')
          AND m.status IN ('signup_open', 'full', 'signup_closed')
          AND m.date_time > now()
        ORDER BY m.date_time
    LOOP
        PERFORM admin_remove_signup(r.id);
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.admin_remove_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_member(UUID) TO authenticated, service_role;

-- ============================================
-- 6. PROFILE COMPLETION
-- ============================================

ALTER TABLE public.player_profiles
    ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ;

-- Existing players who already moved off the defaults, and players without an
-- account (created by an admin), are not asked again.
UPDATE public.player_profiles
SET profile_completed_at = COALESCE(updated_at, now())
WHERE profile_completed_at IS NULL
  AND (
      user_id IS NULL
      OR main_position IS DISTINCT FROM 'CM'
      OR goalkeeper_willingness IS DISTINCT FROM 0
      OR preferred_positions IS DISTINCT FROM ARRAY['CM']::TEXT[]
  );
