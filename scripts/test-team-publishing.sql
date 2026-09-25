-- Run after migration 00023 against the local seeded database. Every write rolls back.
BEGIN;
DO $$
DECLARE
  v_user UUID; v_member UUID; v_match UUID; v_payload JSONB; v_bad JSONB;
  v_before INTEGER; v_after INTEGER; v_status public.match_status;
BEGIN
  SELECT id INTO v_user FROM public.users WHERE email = 'maxo@test.local';
  SELECT m.id INTO v_match FROM public.matches m
    WHERE m.status IN ('full', 'signup_open', 'signup_closed')
      AND (SELECT count(*) FROM public.match_signups s WHERE s.match_id = m.id AND s.status = 'confirmed') >= 4
      AND EXISTS (SELECT 1 FROM public.group_memberships gm JOIN public.player_profiles p ON p.id = gm.player_id
        WHERE gm.group_id = m.group_id AND p.user_id = v_user AND gm.role IN ('admin','captain'))
    ORDER BY m.date_time LIMIT 1;
  IF v_user IS NULL OR v_match IS NULL THEN RAISE EXCEPTION 'Local seed required'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_user::TEXT, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_user,'role','authenticated')::TEXT, true);
  SELECT jsonb_agg(jsonb_build_object('team', CASE WHEN rn <= (total + 1)/2 THEN 'dark' ELSE 'light' END,
      'player_id', player_id, 'guest_player_id', guest_player_id, 'position', 'CM', 'order_index', rn - 1, 'source','manual'))
    INTO v_payload FROM (
      SELECT s.*, row_number() OVER (ORDER BY s.id) rn, count(*) OVER () total FROM public.match_signups s
      WHERE s.match_id = v_match AND s.status = 'confirmed'
    ) x;

  SET LOCAL ROLE authenticated;
  PERFORM public.publish_match_teams(v_match, v_payload, NULL);
  SELECT status INTO v_status FROM public.matches WHERE id = v_match;
  IF v_status <> 'teams_created' THEN RAISE EXCEPTION 'TEST: status not updated'; END IF;
  SELECT count(*) INTO v_before FROM public.team_assignments a JOIN public.teams t ON t.id=a.team_id WHERE t.match_id=v_match;
  IF v_before <> jsonb_array_length(v_payload) THEN RAISE EXCEPTION 'TEST: incomplete lineup'; END IF;
  IF (SELECT ai_input_snapshot IS NOT NULL FROM public.matches WHERE id=v_match) THEN RAISE EXCEPTION 'TEST: stale AI snapshot'; END IF;
  -- Re-saving an already published lineup must not notify the group again.
  SELECT count(*) INTO v_before FROM public.notifications WHERE match_id=v_match AND type='teams_created';
  PERFORM public.publish_match_teams(v_match, v_payload, NULL);
  IF (SELECT count(*) FROM public.notifications WHERE match_id=v_match AND type='teams_created') <> v_before THEN
    RAISE EXCEPTION 'TEST: republish notified again';
  END IF;
  SELECT count(*) INTO v_before FROM public.team_assignments a JOIN public.teams t ON t.id=a.team_id WHERE t.match_id=v_match;

  -- Duplicate identities must not destroy the previously saved lineup.
  v_bad := jsonb_set(v_payload, '{1}', v_payload->0);
  BEGIN
    PERFORM public.publish_match_teams(v_match, v_bad, NULL);
    RAISE EXCEPTION 'TEST: duplicate accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST:%' THEN RAISE; END IF; END;
  -- Missing confirmed player (including a roster changing while the editor is open).
  BEGIN
    PERFORM public.publish_match_teams(v_match, v_payload - 0, NULL);
    RAISE EXCEPTION 'TEST: incomplete roster accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST:%' THEN RAISE; END IF; END;
  -- Complete rosters still need two teams of comparable size.
  SELECT jsonb_agg(jsonb_set(a, '{team}', '"dark"')) INTO v_bad FROM jsonb_array_elements(v_payload) a;
  BEGIN
    PERFORM public.publish_match_teams(v_match, v_bad, NULL);
    RAISE EXCEPTION 'TEST: uneven teams accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST:%' THEN RAISE; END IF; END;
  -- Invalid positions and outsiders are rejected.
  BEGIN
    PERFORM public.publish_match_teams(v_match, jsonb_set(v_payload, '{0,position}', '"invalid"'), NULL);
    RAISE EXCEPTION 'TEST: invalid position accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST:%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.publish_match_teams(v_match, jsonb_set(v_payload, '{0,player_id}', to_jsonb(uuid_generate_v4())), NULL);
    RAISE EXCEPTION 'TEST: outsider accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST:%' THEN RAISE; END IF; END;
  SELECT count(*) INTO v_after FROM public.team_assignments a JOIN public.teams t ON t.id=a.team_id WHERE t.match_id=v_match;
  IF v_after <> v_before THEN RAISE EXCEPTION 'TEST: failure replaced saved assignments'; END IF;

  RESET ROLE;
  SELECT p.user_id INTO v_member FROM public.group_memberships gm JOIN public.player_profiles p ON p.id=gm.player_id
    WHERE gm.group_id=(SELECT group_id FROM matches WHERE id=v_match) AND gm.role='member' AND gm.is_active LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_member::TEXT, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_member,'role','authenticated')::TEXT, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.publish_match_teams(v_match, v_payload, NULL);
    RAISE EXCEPTION 'TEST: member could publish';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST:%' THEN RAISE; END IF; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_user::TEXT, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_user,'role','authenticated')::TEXT, true);
  PERFORM public.admin_set_match_status(v_match, 'finished');
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.publish_match_teams(v_match, v_payload, NULL);
    RAISE EXCEPTION 'TEST: finished match editable';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST:%' THEN RAISE; END IF; END;
  RESET ROLE;
  RAISE NOTICE 'Team publishing checks passed: atomic save, full roster, duplicate/outsider/position validation, role and lifecycle permissions';
END;
$$;
ROLLBACK;
