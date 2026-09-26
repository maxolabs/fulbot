-- Match lifecycle guards, roster changes after the teams, column privileges
-- and score privacy (fix track "match-lifecycle-teams"):
--   1. matches.lineup_needs_review + a match_signups trigger: when the
--      confirmed list changes on a teams_created match, the leaver's
--      team_assignments row is removed and the lineup is flagged for review.
--      publish_match_teams clears the flag (MATCH-1 / TS-1).
--   2. promote_from_waitlist only promotes while the match tracks signups
--      (signup_open / full / signup_closed / teams_created); cancel_my_signup,
--      cancel_guest_signup and admin_remove_signup reject finished and
--      cancelled matches (MATCH-1).
--   3. signup_for_match and public_guest_signup reject signups once the match
--      has started (MATCH-2).
--   4. matches: authenticated may only UPDATE the columns the edit form
--      writes; the INSERT policy only creates draft / signup_open matches;
--      match_events has no direct write policies left (MATCH-5 / PLAT-5).
--   5. group_memberships: member_score, member_breakdown, member_score_at and
--      signup_cooldown are no longer selectable; get_member_scores() applies
--      the visibility rule (GRP-5 / TS-5).
--   6. admin_set_guest_rating() for the "Editar nivel" action (TS-4).
--   7. matches joins the supabase_realtime publication (MATCH-10).
--
-- Error messages stay Spanish (the app maps them to ui.* keys):
--   'El partido ya empezó'                          -> signups after kickoff
--   'El partido ya no admite cambios en la lista'   -> leaving / removing on
--                                                     finished or cancelled

-- ============================================
-- 1. LINEUP REVIEW FLAG
-- ============================================

ALTER TABLE public.matches
    ADD COLUMN IF NOT EXISTS lineup_needs_review BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.matches.lineup_needs_review IS
    'TRUE when the confirmed list changed after the teams were published; cleared by publish_match_teams.';

-- Keeps team_assignments in step with the confirmed list of a teams_created
-- match, whichever path changed it (member leaving, admin removal, guest
-- cancel, waitlist promotion, guest added by an admin). A player who stops
-- being confirmed loses their slot; any difference between the confirmed set
-- and the assignments flags the lineup. The promoted player is not placed
-- automatically (waits for the owner's decision, OD-2).
CREATE OR REPLACE FUNCTION public.trg_match_signups_sync_lineup()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_match_id UUID;
    v_status match_status;
    v_deleted INTEGER := 0;
    v_mismatch BOOLEAN;
BEGIN
    v_match_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.match_id ELSE NEW.match_id END;

    SELECT status INTO v_status FROM public.matches WHERE id = v_match_id;
    IF v_status IS DISTINCT FROM 'teams_created' THEN
        RETURN NULL;
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.status = 'confirmed'
       AND (TG_OP = 'DELETE' OR NEW.status IS DISTINCT FROM 'confirmed') THEN
        DELETE FROM public.team_assignments ta
        USING public.teams t
        WHERE ta.team_id = t.id
          AND t.match_id = v_match_id
          AND ((OLD.player_id IS NOT NULL AND ta.player_id = OLD.player_id)
            OR (OLD.guest_player_id IS NOT NULL AND ta.guest_player_id = OLD.guest_player_id));
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.match_signups s
        WHERE s.match_id = v_match_id AND s.status = 'confirmed'
          AND NOT EXISTS (
              SELECT 1 FROM public.team_assignments ta
              JOIN public.teams t ON t.id = ta.team_id
              WHERE t.match_id = v_match_id
                AND ((s.player_id IS NOT NULL AND ta.player_id = s.player_id)
                  OR (s.guest_player_id IS NOT NULL AND ta.guest_player_id = s.guest_player_id))
          )
    ) OR EXISTS (
        SELECT 1 FROM public.team_assignments ta
        JOIN public.teams t ON t.id = ta.team_id
        WHERE t.match_id = v_match_id
          AND NOT EXISTS (
              SELECT 1 FROM public.match_signups s
              WHERE s.match_id = v_match_id AND s.status = 'confirmed'
                AND ((ta.player_id IS NOT NULL AND s.player_id = ta.player_id)
                  OR (ta.guest_player_id IS NOT NULL AND s.guest_player_id = ta.guest_player_id))
          )
    ) INTO v_mismatch;

    IF v_deleted > 0 OR v_mismatch THEN
        UPDATE public.matches SET lineup_needs_review = TRUE
        WHERE id = v_match_id AND NOT lineup_needs_review;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_match_signups_sync_lineup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS match_signups_sync_lineup ON public.match_signups;
CREATE TRIGGER match_signups_sync_lineup
    AFTER INSERT OR UPDATE OF status OR DELETE ON public.match_signups
    FOR EACH ROW EXECUTE FUNCTION public.trg_match_signups_sync_lineup();

-- publish_match_teams: 00023 body; publishing a complete lineup clears the flag.
CREATE OR REPLACE FUNCTION public.publish_match_teams(
    p_match_id UUID,
    p_assignments JSONB,
    p_snapshot JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_match public.matches;
    v_confirmed INTEGER;
    v_dark INTEGER;
    v_light INTEGER;
    v_payload JSONB;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match.id IS NULL THEN RAISE EXCEPTION 'Partido no encontrado'; END IF;
    IF auth.uid() IS NULL OR NOT COALESCE(public.is_group_admin_or_captain(v_match.group_id), FALSE) THEN
        RAISE EXCEPTION 'No tenés permiso para armar equipos en este grupo';
    END IF;
    IF v_match.status NOT IN ('signup_open', 'full', 'signup_closed', 'teams_created') THEN
        RAISE EXCEPTION 'Este partido no permite modificar equipos';
    END IF;
    IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN
        RAISE EXCEPTION 'Las asignaciones deben ser una lista';
    END IF;
    SELECT count(*) INTO v_confirmed FROM public.match_signups WHERE match_id = p_match_id AND status = 'confirmed';
    IF v_confirmed < 4 THEN RAISE EXCEPTION 'Se necesitan al menos 4 jugadores confirmados'; END IF;
    IF jsonb_array_length(p_assignments) <> v_confirmed THEN
        RAISE EXCEPTION 'La lista de confirmados cambió. Recargá y asigná a todos los jugadores';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_to_recordset(p_assignments) AS a(team TEXT, player_id UUID, guest_player_id UUID, position TEXT, order_index INTEGER)
        WHERE a.team IS NULL OR a.team NOT IN ('dark', 'light')
          OR (a.player_id IS NULL) = (a.guest_player_id IS NULL)
          OR a.position IS NULL OR a.position NOT IN ('GK','CB','LB','RB','CDM','CM','CAM','LM','RM','LW','RW','ST','CF')
          OR a.order_index IS NULL OR a.order_index < 0 OR a.order_index > 30
          OR NOT EXISTS (
              SELECT 1 FROM public.match_signups s
              WHERE s.match_id = p_match_id AND s.status = 'confirmed'
                AND ((a.player_id IS NOT NULL AND s.player_id = a.player_id)
                  OR (a.guest_player_id IS NOT NULL AND s.guest_player_id = a.guest_player_id))
          )
    ) THEN RAISE EXCEPTION 'Asignaciones inválidas. Usá únicamente los jugadores confirmados y posiciones válidas'; END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_to_recordset(p_assignments) AS a(player_id UUID, guest_player_id UUID)
        GROUP BY a.player_id, a.guest_player_id HAVING count(*) > 1
    ) THEN RAISE EXCEPTION 'Cada jugador debe estar en un solo equipo'; END IF;
    SELECT count(*) FILTER (WHERE a->>'team' = 'dark'), count(*) FILTER (WHERE a->>'team' = 'light')
      INTO v_dark, v_light FROM jsonb_array_elements(p_assignments) a;
    IF v_dark = 0 OR v_light = 0 OR abs(v_dark - v_light) > 1 THEN
        RAISE EXCEPTION 'Repartí los jugadores en dos equipos con diferencia de tamaño máxima de uno';
    END IF;

    PERFORM public.save_team_assignments(p_match_id, p_assignments);
    PERFORM public.admin_set_match_status(p_match_id, 'teams_created');
    UPDATE public.matches
    SET ai_input_snapshot = p_snapshot, lineup_needs_review = FALSE
    WHERE id = p_match_id;

    SELECT jsonb_build_object(
        'match_id', p_match_id,
        'dark_team_names', COALESCE(jsonb_agg(COALESCE(p.display_name, g.display_name) ORDER BY a.order_index) FILTER (WHERE a.team = 'dark'), '[]'::jsonb),
        'light_team_names', COALESCE(jsonb_agg(COALESCE(p.display_name, g.display_name) ORDER BY a.order_index) FILTER (WHERE a.team = 'light'), '[]'::jsonb)
    ) INTO v_payload
    FROM jsonb_to_recordset(p_assignments) AS a(team TEXT, player_id UUID, guest_player_id UUID, order_index INTEGER)
    LEFT JOIN public.player_profiles p ON p.id = a.player_id
    LEFT JOIN public.guest_players g ON g.id = a.guest_player_id;
    -- Announce the first publish only: later edits (positions, swaps,
    -- regeneration) must not ping the whole group again.
    IF v_match.status <> 'teams_created' THEN
        PERFORM public.emit_notification(v_match.group_id, p_match_id, 'teams_created', v_payload);
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_match_teams(UUID, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_match_teams(UUID, JSONB, JSONB) TO authenticated;

-- ============================================
-- 2. STATUS GUARDS ON THE SIGNUP LIST
-- ============================================

-- promote_from_waitlist: 00021 body. New: nothing is promoted once the match
-- is draft, finished or cancelled (a no-show or a late removal on a finished
-- match must not confirm someone who never played).
CREATE OR REPLACE FUNCTION promote_from_waitlist(p_match_id UUID)
RETURNS UUID AS $$
DECLARE
    v_match public.matches;
    v_confirmed_count INTEGER;
    v_promoted_id UUID;
    v_promoted_player_id UUID;
    v_promoted_guest_id UUID;
    v_promoted_name TEXT;
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
            AND NOT (v_window_open AND waitlist_reason = 'priority_window')
            AND NOT (v_reserved_active AND waitlist_reason = 'reserved')
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

            PERFORM emit_notification(
                v_match.group_id,
                p_match_id,
                'waitlist_promoted',
                jsonb_build_object(
                    'signup_id', v_promoted_id,
                    'player_name', v_promoted_name,
                    'recipient_player_id', v_promoted_player_id
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION promote_from_waitlist(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION promote_from_waitlist(UUID) TO service_role;

-- cancel_my_signup: 00025 body. New: the match is locked first and a finished
-- or cancelled match rejects the cancel.
CREATE OR REPLACE FUNCTION cancel_my_signup(p_match_id UUID)
RETURNS void AS $$
DECLARE
    v_player_id UUID;
    v_match public.matches;
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

    IF v_match.status IN ('finished', 'cancelled') THEN
        RAISE EXCEPTION 'El partido ya no admite cambios en la lista';
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

    PERFORM emit_cancel_event(p_match_id, v_player_id);

    PERFORM promote_from_waitlist(p_match_id);

    WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY waitlist_position ASC NULLS LAST, signup_time ASC) AS new_pos
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'waitlist'
    )
    UPDATE public.match_signups ms
    SET waitlist_position = numbered.new_pos
    FROM numbered
    WHERE ms.id = numbered.id AND ms.waitlist_position IS DISTINCT FROM numbered.new_pos;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION cancel_my_signup(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cancel_my_signup(UUID) TO authenticated, service_role;

-- cancel_guest_signup: 00025 body. New: row lock on the match and the same
-- finished / cancelled guard.
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

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    IF v_match.status IN ('finished', 'cancelled') THEN
        RAISE EXCEPTION 'El partido ya no admite cambios en la lista';
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

    WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY waitlist_position ASC NULLS LAST, signup_time ASC) AS new_pos
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'waitlist'
    )
    UPDATE public.match_signups ms
    SET waitlist_position = numbered.new_pos
    FROM numbered
    WHERE ms.id = numbered.id AND ms.waitlist_position IS DISTINCT FROM numbered.new_pos;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION cancel_guest_signup(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_guest_signup(UUID, UUID) TO anon, authenticated;

-- admin_remove_signup: 00021 body. New: finished / cancelled matches keep
-- their list (attendance is corrected with the no-show toggle instead).
CREATE OR REPLACE FUNCTION admin_remove_signup(p_signup_id UUID)
RETURNS void AS $$
DECLARE
    v_signup public.match_signups;
    v_match public.matches;
    v_was_confirmed BOOLEAN;
    v_was_waitlist BOOLEAN;
BEGIN
    SELECT * INTO v_signup FROM public.match_signups WHERE id = p_signup_id;
    IF v_signup IS NULL THEN
        RAISE EXCEPTION 'Inscripción no encontrada';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = v_signup.match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    IF NOT is_group_admin_or_captain(v_match.group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para esta acción';
    END IF;

    IF v_match.status IN ('finished', 'cancelled') THEN
        RAISE EXCEPTION 'El partido ya no admite cambios en la lista';
    END IF;

    -- Re-read under lock: the row may have changed while waiting for the match.
    SELECT * INTO v_signup FROM public.match_signups WHERE id = p_signup_id FOR UPDATE;

    v_was_confirmed := v_signup.status = 'confirmed';
    v_was_waitlist := v_signup.status = 'waitlist';

    UPDATE public.match_signups
    SET status = 'cancelled', cancel_time = NOW()
    WHERE id = p_signup_id;

    IF (v_was_confirmed OR v_was_waitlist) AND v_signup.player_id IS NOT NULL THEN
        PERFORM emit_cancel_event(v_match.id, v_signup.player_id);
    END IF;

    IF v_was_confirmed THEN
        PERFORM promote_from_waitlist(v_match.id);
    END IF;

    IF v_was_confirmed OR v_was_waitlist THEN
        WITH numbered AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY waitlist_position ASC NULLS LAST, signup_time ASC) AS new_pos
            FROM public.match_signups
            WHERE match_id = v_match.id AND status = 'waitlist'
        )
        UPDATE public.match_signups ms
        SET waitlist_position = numbered.new_pos
        FROM numbered
        WHERE ms.id = numbered.id AND ms.waitlist_position IS DISTINCT FROM numbered.new_pos;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION admin_remove_signup(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_remove_signup(UUID) TO authenticated, service_role;

-- ============================================
-- 3. NO SIGNUPS AFTER KICKOFF
-- ============================================

-- signup_for_match: 00021 body plus the kickoff check.
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
    v_reason TEXT;
    v_settings JSONB;
    v_enabled BOOLEAN;
    v_mode TEXT;
    v_threshold NUMERIC;
    v_window_hours NUMERIC;
    v_reserved INTEGER;
    v_score NUMERIC;
    v_cooldown BOOLEAN;
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

    IF now() >= v_match.date_time THEN
        RAISE EXCEPTION 'El partido ya empezó';
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
        v_reason := NULL;
    ELSE
        v_status := 'waitlist';
        v_reason := 'full';
    END IF;

    -- Member scoring policies (§5.1, §5.2).
    v_settings := member_scoring_settings(v_match.group_id);
    v_enabled := COALESCE((v_settings->>'enabled')::boolean, false);
    v_mode := COALESCE(v_settings->'priority'->>'mode', 'off');
    v_threshold := COALESCE((v_settings->'priority'->>'threshold')::numeric, 3.0);
    v_window_hours := COALESCE((v_settings->'priority'->>'window_hours')::numeric, 24);
    v_reserved := COALESCE((v_settings->'priority'->>'reserved_spots')::integer, 4);

    SELECT gm.member_score, gm.signup_cooldown INTO v_score, v_cooldown
    FROM public.group_memberships gm
    WHERE gm.group_id = v_match.group_id AND gm.player_id = v_player_id
    FOR UPDATE;

    IF COALESCE(v_cooldown, false) THEN
        -- Consumed once, whether or not the policy is still on.
        UPDATE public.group_memberships SET signup_cooldown = FALSE
        WHERE group_id = v_match.group_id AND player_id = v_player_id;
        IF v_enabled AND COALESCE((v_settings->>'no_show_cooldown')::boolean, false) AND v_status = 'confirmed' THEN
            v_status := 'waitlist';
            v_reason := 'cooldown';
        END IF;
    END IF;

    IF v_enabled AND v_status = 'confirmed' AND v_score IS NOT NULL AND v_score < v_threshold THEN
        IF v_mode = 'window' AND v_match.signup_opened_at IS NOT NULL
           AND now() < v_match.signup_opened_at + (v_window_hours || ' hours')::interval THEN
            v_status := 'waitlist';
            v_reason := 'priority_window';
        ELSIF v_mode = 'reserved'
           AND now() < v_match.date_time - (v_window_hours || ' hours')::interval
           AND v_confirmed_count >= v_match.max_players - v_reserved THEN
            v_status := 'waitlist';
            v_reason := 'reserved';
        END IF;
    END IF;

    IF v_status = 'waitlist' THEN
        SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_waitlist_position
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'waitlist';
    ELSE
        v_waitlist_position := NULL;
    END IF;

    -- Upsert: a player may have a prior 'cancelled' row for this match, which
    -- the (match_id, player_id) unique constraint would otherwise conflict on.
    INSERT INTO public.match_signups (
        match_id, player_id, status, notes, position_preference, waitlist_position, waitlist_reason, signup_time, cancel_time
    )
    VALUES (
        p_match_id, v_player_id, v_status, p_notes, p_position_preference, v_waitlist_position, v_reason, NOW(), NULL
    )
    ON CONFLICT ON CONSTRAINT unique_player_signup
    DO UPDATE SET
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        position_preference = EXCLUDED.position_preference,
        waitlist_position = EXCLUDED.waitlist_position,
        waitlist_reason = EXCLUDED.waitlist_reason,
        signup_time = NOW(),
        cancel_time = NULL
    RETURNING * INTO v_signup;

    IF v_status = 'confirmed' AND v_confirmed_count + 1 >= v_match.max_players THEN
        UPDATE public.matches SET status = 'full' WHERE id = p_match_id;
    END IF;

    RETURN v_signup;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION signup_for_match(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION signup_for_match(UUID, TEXT, TEXT) TO authenticated, service_role;

-- public_guest_signup: 00025 body plus the kickoff check.
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
    v_name TEXT;
    v_recent INTEGER;
BEGIN
    v_name := btrim(COALESCE(p_display_name, ''));
    IF v_name = '' THEN
        RAISE EXCEPTION 'El nombre no puede estar vacío';
    END IF;

    IF char_length(v_name) > 60 THEN
        RAISE EXCEPTION 'El nombre es demasiado largo';
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

    IF now() >= v_match.date_time THEN
        RAISE EXCEPTION 'El partido ya empezó';
    END IF;

    SELECT COUNT(*) INTO v_recent
    FROM public.match_signups ms
    JOIN public.guest_players gp ON gp.id = ms.guest_player_id
    WHERE ms.match_id = p_match_id
      AND gp.self_signup_token IS NOT NULL
      AND ms.signup_time > NOW() - INTERVAL '1 hour';

    IF v_recent >= 10 THEN
        RAISE EXCEPTION 'Demasiadas inscripciones de invitados, probá más tarde';
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

        UPDATE public.guest_players SET display_name = v_name
        WHERE id = v_guest_id;
    ELSE
        INSERT INTO public.guest_players (display_name, group_id, self_signup_token)
        VALUES (v_name, v_match.group_id, p_token)
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

    IF v_status = 'confirmed' AND v_confirmed_count + 1 >= v_match.max_players
       AND v_match.status = 'signup_open' THEN
        UPDATE public.matches SET status = 'full' WHERE id = p_match_id;
    END IF;

    RETURN jsonb_build_object(
        'signup_id', v_signup_id,
        'status', v_status,
        'waitlist_position', v_waitlist_position
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public_guest_signup(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_guest_signup(UUID, TEXT, UUID) TO anon, authenticated;

-- ============================================
-- 4. MATCHES / MATCH_EVENTS DIRECT WRITES
-- ============================================
-- Status, results, MVP, finished_at, max_players and the AI snapshot only
-- change through the SECURITY DEFINER RPCs (admin_set_match_status,
-- admin_set_match_max_players, publish_match_teams, admin_set_match_result,
-- the consensus functions). The edit form still writes the five columns below
-- directly. teams / team_assignments keep their policies (owner decision).

REVOKE UPDATE ON public.matches FROM authenticated, anon;
GRANT UPDATE (date_time, location, notes, duration_minutes, results_request_delay_minutes)
    ON public.matches TO authenticated;

DROP POLICY IF EXISTS "Admins and captains can update matches" ON public.matches;
CREATE POLICY "Admins and captains can update matches"
    ON public.matches FOR UPDATE
    USING (is_group_admin_or_captain(group_id))
    WITH CHECK (is_group_admin_or_captain(group_id));

DROP POLICY IF EXISTS "Admins can create matches" ON public.matches;
CREATE POLICY "Admins can create matches"
    ON public.matches FOR INSERT
    WITH CHECK (is_group_admin(group_id) AND status IN ('draft', 'signup_open'));

-- Goals, assists and own goals are written by admin_set_match_result and the
-- consensus functions (SECURITY DEFINER); nothing in the app writes them directly.
DROP POLICY IF EXISTS "match_events_insert" ON public.match_events;
DROP POLICY IF EXISTS "match_events_delete" ON public.match_events;

-- ============================================
-- 5. MEMBER SCORE PRIVACY
-- ============================================
-- Column privileges: a table-level SELECT covers every column, so it is
-- revoked and the public columns are granted one by one. A `select('*')` on
-- group_memberships from the API now fails; select named columns instead.

REVOKE SELECT ON public.group_memberships FROM authenticated, anon;
GRANT SELECT (id, group_id, player_id, role, is_active, joined_at)
    ON public.group_memberships TO authenticated, anon;

-- Member scores the caller may see (docs/member-scoring.md §5.4):
--   p_group_id NULL : the caller's own row in every group they are active in
--                     (profile page).
--   p_group_id set  : for a member of that group, every membership row when
--                     the caller is admin/captain or visibility is 'group',
--                     otherwise only their own row. signup_cooldown is only
--                     returned for the caller's own row or to admins/captains.
-- Whether scoring is enabled is the caller's concern (member_scoring_settings).
CREATE OR REPLACE FUNCTION public.get_member_scores(p_group_id UUID DEFAULT NULL)
RETURNS TABLE (
    group_id UUID,
    player_id UUID,
    is_active BOOLEAN,
    member_score NUMERIC,
    member_breakdown JSONB,
    member_score_at TIMESTAMPTZ,
    signup_cooldown BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
    v_me UUID := public.get_current_player_id();
    v_staff BOOLEAN;
    v_all BOOLEAN;
BEGIN
    IF v_me IS NULL THEN
        RETURN;
    END IF;

    IF p_group_id IS NULL THEN
        RETURN QUERY
        SELECT gm.group_id, gm.player_id, gm.is_active, gm.member_score::NUMERIC,
               gm.member_breakdown, gm.member_score_at, gm.signup_cooldown
        FROM public.group_memberships gm
        WHERE gm.player_id = v_me AND gm.is_active;
        RETURN;
    END IF;

    IF NOT public.is_group_member(p_group_id) THEN
        RETURN;
    END IF;

    v_staff := COALESCE(public.is_group_admin_or_captain(p_group_id), FALSE);
    v_all := v_staff OR public.member_scoring_settings(p_group_id)->>'visibility' = 'group';

    RETURN QUERY
    SELECT gm.group_id, gm.player_id, gm.is_active, gm.member_score::NUMERIC,
           gm.member_breakdown, gm.member_score_at,
           CASE WHEN v_staff OR gm.player_id = v_me THEN gm.signup_cooldown ELSE NULL END
    FROM public.group_memberships gm
    WHERE gm.group_id = p_group_id
      AND (v_all OR gm.player_id = v_me);
END;
$$;

REVOKE ALL ON FUNCTION public.get_member_scores(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_scores(UUID) TO authenticated, service_role;

-- ============================================
-- 6. GUEST LEVEL
-- ============================================
-- "Editar nivel" on a guest row of the match page. Same permission as adding
-- the guest (admin_add_guest_signup): admins and captains of the guest's group.

CREATE OR REPLACE FUNCTION public.admin_set_guest_rating(
    p_guest_player_id UUID,
    p_rating NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_group_id UUID;
BEGIN
    IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
        RAISE EXCEPTION 'El nivel debe estar entre 1 y 5';
    END IF;

    SELECT group_id INTO v_group_id FROM public.guest_players WHERE id = p_guest_player_id;
    IF v_group_id IS NULL THEN
        RAISE EXCEPTION 'Invitado no encontrado';
    END IF;

    IF NOT COALESCE(public.is_group_admin_or_captain(v_group_id), FALSE) THEN
        RAISE EXCEPTION 'No tenés permiso para esta acción';
    END IF;

    UPDATE public.guest_players
    SET estimated_rating = round(p_rating, 2)
    WHERE id = p_guest_player_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_guest_rating(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_guest_rating(UUID, NUMERIC) TO authenticated;

-- ============================================
-- 7. REALTIME
-- ============================================
-- The match page also refreshes on status and result changes
-- (realtime-wrapper.tsx). Guarded like 00025.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'matches'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
    END IF;
END $$;
