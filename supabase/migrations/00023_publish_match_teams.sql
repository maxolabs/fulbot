-- Publish a complete lineup atomically, whether assembled manually or by AI.
-- Lock the match just like signup/status RPCs so the confirmed roster cannot
-- change between validation and saving. Existing lineups survive any failure.
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
    UPDATE public.matches SET ai_input_snapshot = p_snapshot WHERE id = p_match_id;

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
