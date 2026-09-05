-- T1 signup: signup RPC contract (see docs/rework-plan.md §2.1).
--
-- Replaces the old process_match_signup/cancel_match_signup pair with a set of
-- SECURITY DEFINER functions that:
--   - derive the acting player from auth.uid() for every self-service action
--     (never trust a caller-supplied player id),
--   - expose a small anonymous surface (get_public_match, public_guest_signup,
--     cancel_guest_signup) for the public /m/[matchId] page, guarded by a
--     per-guest self_signup_token instead of RLS,
--   - keep matches/match_signups closed to the anon role: nothing here grants
--     anon direct table access, so RLS does not need to change.

-- ============================================
-- SCHEMA: guest self-signup token
-- ============================================

ALTER TABLE public.guest_players
    ADD COLUMN IF NOT EXISTS self_signup_token UUID UNIQUE;

-- ============================================
-- DROP SUPERSEDED FUNCTIONS
-- ============================================

DROP FUNCTION IF EXISTS process_match_signup(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS cancel_match_signup(UUID, UUID);

-- ============================================
-- INTERNAL HELPER: promote_from_waitlist
-- ============================================
-- Reused by T4 (no-shows) and T5 (notifications, which CREATE OR REPLACEs
-- this with the same signature to also emit `waitlist_promoted`).
-- Promotes the earliest waitlisted signup into a confirmed spot when there is
-- room, reorders the remaining waitlist positions, and reconciles
-- matches.status to 'full'/'signup_open' -- but only while the match is in
-- one of those two statuses; signup_closed/teams_created/finished/cancelled
-- are left untouched.

CREATE OR REPLACE FUNCTION promote_from_waitlist(p_match_id UUID)
RETURNS UUID AS $$
DECLARE
    v_match public.matches;
    v_confirmed_count INTEGER;
    v_promoted_id UUID;
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
        SELECT id INTO v_promoted_id
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'waitlist'
        ORDER BY waitlist_position ASC NULLS LAST, signup_time ASC
        LIMIT 1;

        IF v_promoted_id IS NOT NULL THEN
            UPDATE public.match_signups
            SET status = 'confirmed', waitlist_position = NULL
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
        END IF;
    END IF;

    -- Only reconcile status while the match is actively tracking signups
    IF v_match.status IN ('signup_open', 'full') THEN
        IF v_confirmed_count >= v_match.max_players THEN
            UPDATE public.matches SET status = 'full' WHERE id = p_match_id;
        ELSE
            UPDATE public.matches SET status = 'signup_open' WHERE id = p_match_id;
        END IF;
    END IF;

    RETURN v_promoted_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- MEMBER SELF-SERVICE
-- ============================================

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
        v_waitlist_position := NULL;
    ELSE
        v_status := 'waitlist';
        SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_waitlist_position
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'waitlist';
    END IF;

    -- Upsert: a player may have a prior 'cancelled' row for this match, which
    -- the (match_id, player_id) unique constraint would otherwise conflict on.
    INSERT INTO public.match_signups (
        match_id, player_id, status, notes, position_preference, waitlist_position, signup_time, cancel_time
    )
    VALUES (
        p_match_id, v_player_id, v_status, p_notes, p_position_preference, v_waitlist_position, NOW(), NULL
    )
    ON CONFLICT ON CONSTRAINT unique_player_signup
    DO UPDATE SET
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        position_preference = EXCLUDED.position_preference,
        waitlist_position = EXCLUDED.waitlist_position,
        signup_time = NOW(),
        cancel_time = NULL
    RETURNING * INTO v_signup;

    IF v_status = 'confirmed' AND v_confirmed_count + 1 >= v_match.max_players THEN
        UPDATE public.matches SET status = 'full' WHERE id = p_match_id;
    END IF;

    RETURN v_signup;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

    PERFORM promote_from_waitlist(p_match_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- ADMIN / CAPTAIN
-- ============================================

CREATE OR REPLACE FUNCTION admin_add_guest_signup(
    p_match_id UUID,
    p_display_name TEXT,
    p_notes TEXT DEFAULT NULL
)
RETURNS public.match_signups AS $$
DECLARE
    v_match public.matches;
    v_guest_id UUID;
    v_confirmed_count INTEGER;
    v_status signup_status;
    v_waitlist_position SMALLINT;
    v_signup public.match_signups;
BEGIN
    IF p_display_name IS NULL OR btrim(p_display_name) = '' THEN
        RAISE EXCEPTION 'El nombre no puede estar vacío';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    IF NOT is_group_admin_or_captain(v_match.group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para agregar invitados';
    END IF;

    IF v_match.status IN ('finished', 'cancelled') THEN
        RAISE EXCEPTION 'No se pueden agregar invitados a este partido';
    END IF;

    INSERT INTO public.guest_players (display_name, notes, group_id, created_by_user_id)
    VALUES (btrim(p_display_name), NULLIF(btrim(COALESCE(p_notes, '')), ''), v_match.group_id, auth.uid())
    RETURNING id INTO v_guest_id;

    SELECT COUNT(*) INTO v_confirmed_count
    FROM public.match_signups
    WHERE match_id = p_match_id AND status = 'confirmed';

    IF v_confirmed_count < v_match.max_players THEN
        v_status := 'confirmed';
        v_waitlist_position := NULL;
    ELSE
        v_status := 'waitlist';
        SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_waitlist_position
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'waitlist';
    END IF;

    INSERT INTO public.match_signups (
        match_id, guest_player_id, status, notes, waitlist_position
    )
    VALUES (
        p_match_id, v_guest_id, v_status, NULLIF(btrim(COALESCE(p_notes, '')), ''), v_waitlist_position
    )
    RETURNING * INTO v_signup;

    IF v_status = 'confirmed' AND v_confirmed_count + 1 >= v_match.max_players THEN
        UPDATE public.matches SET status = 'full' WHERE id = p_match_id;
    END IF;

    RETURN v_signup;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

    IF v_was_confirmed AND p_status != 'confirmed' THEN
        PERFORM promote_from_waitlist(v_match.id);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

    RETURN v_match;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- ANONYMOUS PUBLIC LINK
-- ============================================

CREATE OR REPLACE FUNCTION get_public_match(p_match_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'id', m.id,
        'group_name', g.name,
        'group_slug', g.slug,
        'date_time', m.date_time,
        'location', m.location,
        'notes', m.notes,
        'status', m.status,
        'max_players', m.max_players,
        'confirmed_count', (
            SELECT COUNT(*) FROM public.match_signups ms
            WHERE ms.match_id = m.id AND ms.status = 'confirmed'
        ),
        'waitlist_count', (
            SELECT COUNT(*) FROM public.match_signups ms
            WHERE ms.match_id = m.id AND ms.status = 'waitlist'
        ),
        'confirmed_names', (
            SELECT COALESCE(jsonb_agg(s.name ORDER BY s.signup_time), '[]'::jsonb)
            FROM (
                SELECT COALESCE(pp.display_name, gp.display_name) AS name, ms.signup_time
                FROM public.match_signups ms
                LEFT JOIN public.player_profiles pp ON pp.id = ms.player_id
                LEFT JOIN public.guest_players gp ON gp.id = ms.guest_player_id
                WHERE ms.match_id = m.id AND ms.status = 'confirmed'
            ) s
        ),
        'waitlist_names', (
            SELECT COALESCE(jsonb_agg(s.name ORDER BY s.waitlist_position), '[]'::jsonb)
            FROM (
                SELECT COALESCE(pp.display_name, gp.display_name) AS name, ms.waitlist_position
                FROM public.match_signups ms
                LEFT JOIN public.player_profiles pp ON pp.id = ms.player_id
                LEFT JOIN public.guest_players gp ON gp.id = ms.guest_player_id
                WHERE ms.match_id = m.id AND ms.status = 'waitlist'
            ) s
        )
    ) INTO v_result
    FROM public.matches m
    JOIN public.groups g ON g.id = m.group_id
    WHERE m.id = p_match_id;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public_guest_signup(
    p_match_id UUID,
    p_display_name TEXT,
    p_token UUID
)
RETURNS JSONB AS $$
DECLARE
    v_match public.matches;
    v_guest_id UUID;
    v_confirmed_count INTEGER;
    v_status signup_status;
    v_waitlist_position SMALLINT;
    v_signup_id UUID;
BEGIN
    IF p_display_name IS NULL OR btrim(p_display_name) = '' THEN
        RAISE EXCEPTION 'El nombre no puede estar vacío';
    END IF;

    IF p_token IS NULL THEN
        RAISE EXCEPTION 'Token inválido';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    IF v_match.status NOT IN ('signup_open', 'full') THEN
        RAISE EXCEPTION 'El partido no está aceptando inscripciones';
    END IF;

    -- Reuse the guest_players row tied to this token within this group, if any.
    SELECT id INTO v_guest_id
    FROM public.guest_players
    WHERE self_signup_token = p_token AND group_id = v_match.group_id;

    IF v_guest_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.match_signups
            WHERE match_id = p_match_id AND guest_player_id = v_guest_id
            AND status IN ('confirmed', 'waitlist')
        ) THEN
            RAISE EXCEPTION 'Ya estás inscripto en este partido';
        END IF;

        UPDATE public.guest_players SET display_name = btrim(p_display_name)
        WHERE id = v_guest_id;
    ELSE
        INSERT INTO public.guest_players (display_name, group_id, self_signup_token)
        VALUES (btrim(p_display_name), v_match.group_id, p_token)
        RETURNING id INTO v_guest_id;
    END IF;

    SELECT COUNT(*) INTO v_confirmed_count
    FROM public.match_signups
    WHERE match_id = p_match_id AND status = 'confirmed';

    IF v_confirmed_count < v_match.max_players THEN
        v_status := 'confirmed';
        v_waitlist_position := NULL;
    ELSE
        v_status := 'waitlist';
        SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_waitlist_position
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'waitlist';
    END IF;

    -- Upsert: the same guest may have a prior 'cancelled' row for this match.
    INSERT INTO public.match_signups (match_id, guest_player_id, status, waitlist_position, signup_time, cancel_time)
    VALUES (p_match_id, v_guest_id, v_status, v_waitlist_position, NOW(), NULL)
    ON CONFLICT ON CONSTRAINT unique_guest_signup
    DO UPDATE SET
        status = EXCLUDED.status,
        waitlist_position = EXCLUDED.waitlist_position,
        signup_time = NOW(),
        cancel_time = NULL
    RETURNING id INTO v_signup_id;

    IF v_status = 'confirmed' AND v_confirmed_count + 1 >= v_match.max_players THEN
        UPDATE public.matches SET status = 'full' WHERE id = p_match_id;
    END IF;

    RETURN jsonb_build_object(
        'signup_id', v_signup_id,
        'status', v_status,
        'waitlist_position', v_waitlist_position
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION cancel_guest_signup(
    p_match_id UUID,
    p_token UUID
)
RETURNS void AS $$
DECLARE
    v_match public.matches;
    v_guest_id UUID;
    v_signup public.match_signups;
BEGIN
    IF p_token IS NULL THEN
        RAISE EXCEPTION 'Token inválido';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    SELECT id INTO v_guest_id
    FROM public.guest_players
    WHERE self_signup_token = p_token AND group_id = v_match.group_id;

    IF v_guest_id IS NULL THEN
        RAISE EXCEPTION 'Inscripción no encontrada';
    END IF;

    SELECT * INTO v_signup
    FROM public.match_signups
    WHERE match_id = p_match_id AND guest_player_id = v_guest_id
    AND status IN ('confirmed', 'waitlist')
    FOR UPDATE;

    IF v_signup IS NULL THEN
        RAISE EXCEPTION 'Inscripción no encontrada';
    END IF;

    UPDATE public.match_signups
    SET status = 'cancelled', cancel_time = NOW()
    WHERE id = v_signup.id;

    PERFORM promote_from_waitlist(p_match_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PRIVILEGES
-- ============================================
-- Nothing here grants anon direct table access to matches/match_signups;
-- the three anon-callable functions below are the only public surface and
-- each validates match status / token ownership itself.

REVOKE ALL ON FUNCTION get_public_match(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_match(UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION public_guest_signup(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_guest_signup(UUID, TEXT, UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION cancel_guest_signup(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_guest_signup(UUID, UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION signup_for_match(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION signup_for_match(UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION cancel_my_signup(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_my_signup(UUID) TO authenticated;

REVOKE ALL ON FUNCTION admin_add_guest_signup(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_add_guest_signup(UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION admin_remove_signup(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_remove_signup(UUID) TO authenticated;

REVOKE ALL ON FUNCTION admin_set_signup_status(UUID, signup_status) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_signup_status(UUID, signup_status) TO authenticated;

REVOKE ALL ON FUNCTION admin_set_match_status(UUID, match_status) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_match_status(UUID, match_status) TO authenticated;

REVOKE ALL ON FUNCTION promote_from_waitlist(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION promote_from_waitlist(UUID) TO authenticated;
