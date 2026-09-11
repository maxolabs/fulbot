-- Manual add of a guest by an admin/captain now carries an optional estimated
-- rating (1-5) and preferred positions, so a hand-added player weighs correctly
-- in the AI/fallback team balance instead of always landing on the 3.00 default.
--
-- The old 3-argument overload is dropped first: keeping both would make an RPC
-- call with three arguments ambiguous for PostgREST.

DROP FUNCTION IF EXISTS admin_add_guest_signup(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION admin_add_guest_signup(
    p_match_id UUID,
    p_display_name TEXT,
    p_notes TEXT DEFAULT NULL,
    p_estimated_rating NUMERIC DEFAULT NULL,
    p_preferred_positions TEXT[] DEFAULT NULL
)
RETURNS public.match_signups AS $$
DECLARE
    v_match public.matches;
    v_guest_id UUID;
    v_confirmed_count INTEGER;
    v_status signup_status;
    v_waitlist_position SMALLINT;
    v_signup public.match_signups;
    v_notes TEXT;
    v_rating NUMERIC(3,2);
    v_positions TEXT[];
BEGIN
    IF p_display_name IS NULL OR btrim(p_display_name) = '' THEN
        RAISE EXCEPTION 'El nombre no puede estar vacío';
    END IF;

    IF p_estimated_rating IS NOT NULL AND (p_estimated_rating < 1 OR p_estimated_rating > 5) THEN
        RAISE EXCEPTION 'El nivel debe estar entre 1 y 5';
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

    v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');
    v_rating := COALESCE(p_estimated_rating, 3.00);

    -- Drop empty entries; fall back to the column default when nothing is left.
    SELECT ARRAY_AGG(upper(btrim(pos)))
    INTO v_positions
    FROM unnest(COALESCE(p_preferred_positions, ARRAY[]::TEXT[])) AS pos
    WHERE btrim(pos) <> '';

    IF v_positions IS NULL OR cardinality(v_positions) = 0 THEN
        v_positions := ARRAY['CM'];
    END IF;

    INSERT INTO public.guest_players (
        display_name, notes, estimated_rating, preferred_positions, group_id, created_by_user_id
    )
    VALUES (
        btrim(p_display_name), v_notes, v_rating, v_positions, v_match.group_id, auth.uid()
    )
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
        p_match_id, v_guest_id, v_status, v_notes, v_waitlist_position
    )
    RETURNING * INTO v_signup;

    IF v_status = 'confirmed' AND v_confirmed_count + 1 >= v_match.max_players THEN
        UPDATE public.matches SET status = 'full' WHERE id = p_match_id;
    END IF;

    RETURN v_signup;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION admin_add_guest_signup(UUID, TEXT, TEXT, NUMERIC, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_add_guest_signup(UUID, TEXT, TEXT, NUMERIC, TEXT[]) TO authenticated;
