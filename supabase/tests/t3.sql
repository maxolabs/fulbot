-- T3 teams-ratings scenarios (migration 00035_teams_ratings_privacy.sql).
--
-- No BEGIN/COMMIT here: run it together with the migration inside one
-- transaction that is rolled back (docs/review/wrapup-2026-11-15.md):
--
--   { echo "BEGIN; SET LOCAL lock_timeout = '30s';"; \
--     cat supabase/migrations/00035_teams_ratings_privacy.sql supabase/tests/t3.sql; \
--     echo "ROLLBACK;"; } | psql "$DB" -v ON_ERROR_STOP=1 -q
--
-- Needs the seed (groups futbol-lunes / futbol-jueves, *@test.local users).
-- Every assertion raises on failure; the last line prints 'T3 scenarios OK'.
-- Users act through real role switches: role authenticated + JWT claims.

-- ============================================
-- HELPERS AND FIXTURE (as postgres)
-- ============================================

CREATE TEMP TABLE t3_ids ON COMMIT DROP AS
SELECT u.email, u.id AS user_id, pp.id AS player_id
FROM auth.users u JOIN public.player_profiles pp ON pp.user_id = u.id;

CREATE TEMP TABLE t3_ctx (key TEXT PRIMARY KEY, val TEXT) ON COMMIT DROP;
GRANT SELECT ON t3_ids TO authenticated;
GRANT SELECT, INSERT, UPDATE ON t3_ctx TO authenticated;

CREATE FUNCTION pg_temp.act_as(p_email TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_uid UUID;
BEGIN
    SELECT user_id INTO v_uid FROM t3_ids WHERE email = p_email;
    IF v_uid IS NULL THEN RAISE EXCEPTION 'T3 fixture: unknown user %', p_email; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE FUNCTION pg_temp.pid(p_email TEXT) RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT player_id FROM t3_ids WHERE email = p_email
$$;

CREATE FUNCTION pg_temp.ctx(p_key TEXT) RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT val FROM t3_ctx WHERE key = p_key
$$;

DO $$
DECLARE
    v_lunes UUID := (SELECT id FROM public.groups WHERE slug = 'futbol-lunes');
    v_jueves UUID := (SELECT id FROM public.groups WHERE slug = 'futbol-jueves');
    v_match UUID;
    v_guest UUID;
    v_email TEXT;
BEGIN
    IF v_lunes IS NULL OR v_jueves IS NULL THEN
        RAISE EXCEPTION 'T3 fixture: seed groups missing';
    END IF;
    INSERT INTO t3_ctx VALUES ('lunes', v_lunes), ('jueves', v_jueves);

    INSERT INTO public.matches (group_id, date_time, status, max_players, location)
    VALUES (v_lunes, now() + interval '3 days', 'signup_open', 10, 'Cancha T3')
    RETURNING id INTO v_match;

    INSERT INTO public.guest_players (display_name, notes, estimated_rating, group_id)
    VALUES ('Invitado T3', 'nota privada', 4.50, v_lunes)
    RETURNING id INTO v_guest;

    FOREACH v_email IN ARRAY ARRAY['maxo@test.local', 'juan@test.local', 'agus@test.local',
                                   'diego@test.local', 'fede@test.local', 'franco@test.local'] LOOP
        INSERT INTO public.match_signups (match_id, player_id, status)
        VALUES (v_match, pg_temp.pid(v_email), 'confirmed');
    END LOOP;
    INSERT INTO public.match_signups (match_id, guest_player_id, status)
    VALUES (v_match, v_guest, 'confirmed');

    INSERT INTO t3_ctx VALUES ('match', v_match), ('guest', v_guest);
END $$;

-- Assignments for every confirmed signup of the fixture match, alternating teams.
CREATE FUNCTION pg_temp.lineup(p_match UUID) RETURNS JSONB LANGUAGE sql STABLE AS $$
    SELECT jsonb_agg(jsonb_build_object(
        'team', CASE WHEN rn % 2 = 0 THEN 'dark' ELSE 'light' END,
        'player_id', player_id,
        'guest_player_id', guest_player_id,
        'position', 'CM',
        'order_index', rn / 2,
        'source', 'manual'
    ))
    FROM (
        SELECT player_id, guest_player_id, (row_number() OVER (ORDER BY id) - 1)::INT AS rn
        FROM public.match_signups
        WHERE match_id = p_match AND status = 'confirmed'
    ) s
$$;
GRANT EXECUTE ON FUNCTION pg_temp.lineup(UUID) TO authenticated;

-- ============================================
-- 1. OD-6: AI SNAPSHOT TABLE
-- ============================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'matches' AND column_name = 'ai_input_snapshot') THEN
        RAISE EXCEPTION 'T3-1: matches.ai_input_snapshot still exists';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.match_ai_snapshots'::regclass) THEN
        RAISE EXCEPTION 'T3-1: match_ai_snapshots without RLS';
    END IF;
END $$;

-- Admin publishes an AI lineup with the full debugging snapshot the route used to send.
DO $$
BEGIN
    PERFORM pg_temp.act_as('maxo@test.local');
    PERFORM public.publish_match_teams(
        pg_temp.ctx('match')::UUID,
        pg_temp.lineup(pg_temp.ctx('match')::UUID),
        jsonb_build_object(
            'input', jsonb_build_object(
                'players', jsonb_build_array(jsonb_build_object('id', 'x', 'name', 'Agus', 'rating', 4.2, 'memberScore', 2.1)),
                'prompt', 'PROMPT CON memberScore Y RATINGS',
                'rules', '[]'::jsonb
            ),
            'output', jsonb_build_object(
                'dark', '[]'::jsonb, 'light', '[]'::jsonb,
                'reasoning', 'Equipos parejos', 'balanceScore', 91,
                'warnings', jsonb_build_array('Falta un arquero')
            ),
            'provider', 'openai', 'model', 'gpt-test', 'generatedAt', '2026-11-15T12:00:00Z'
        )
    );
END $$;
RESET role;

DO $$
DECLARE
    v_snap JSONB;
BEGIN
    SELECT snapshot INTO v_snap FROM public.match_ai_snapshots WHERE match_id = pg_temp.ctx('match')::UUID;
    IF v_snap IS NULL THEN RAISE EXCEPTION 'T3-1: publish_match_teams did not store the snapshot'; END IF;
    IF v_snap ? 'input' OR v_snap::TEXT ILIKE '%memberScore%' OR v_snap::TEXT ILIKE '%prompt%'
       OR v_snap->'output' ? 'dark' THEN
        RAISE EXCEPTION 'T3-1: snapshot not stripped: %', v_snap;
    END IF;
    IF v_snap->'output'->>'reasoning' <> 'Equipos parejos'
       OR (v_snap->'output'->>'balanceScore')::INT <> 91
       OR v_snap->'output'->'warnings' <> '["Falta un arquero"]'::jsonb
       OR v_snap->>'provider' <> 'openai' THEN
        RAISE EXCEPTION 'T3-1: analysis fields lost: %', v_snap;
    END IF;
    IF (SELECT status FROM public.matches WHERE id = pg_temp.ctx('match')::UUID) <> 'teams_created' THEN
        RAISE EXCEPTION 'T3-1: match not teams_created after publish';
    END IF;
END $$;

-- Visibility by role: admin and captain see it, members do not (nico is a
-- member of lunes and admin of jueves).
DO $$
DECLARE
    v_case RECORD;
    v_n INTEGER;
BEGIN
    FOR v_case IN SELECT * FROM (VALUES
        ('maxo@test.local', 1), ('juan@test.local', 1),
        ('agus@test.local', 0), ('nico@test.local', 0)
    ) AS c(email, expected) LOOP
        PERFORM pg_temp.act_as(v_case.email);
        SELECT count(*) INTO v_n FROM public.match_ai_snapshots WHERE match_id = pg_temp.ctx('match')::UUID;
        IF v_n <> v_case.expected THEN
            RAISE EXCEPTION 'T3-1: % sees % snapshot rows, expected %', v_case.email, v_n, v_case.expected;
        END IF;
    END LOOP;
END $$;
RESET role;

-- Nobody writes the snapshot table directly.
DO $$
BEGIN
    PERFORM pg_temp.act_as('maxo@test.local');
    BEGIN
        UPDATE public.match_ai_snapshots SET snapshot = '{}' WHERE match_id = pg_temp.ctx('match')::UUID;
        RAISE EXCEPTION 'T3-1: admin updated match_ai_snapshots directly';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
RESET role;

-- ============================================
-- 2. TEAM WRITES ONLY THROUGH SECURITY DEFINER CODE
-- ============================================

DO $$
DECLARE
    v_team UUID;
    v_n INTEGER;
BEGIN
    PERFORM pg_temp.act_as('maxo@test.local');
    SELECT id INTO v_team FROM public.teams WHERE match_id = pg_temp.ctx('match')::UUID AND name = 'dark';
    IF v_team IS NULL THEN RAISE EXCEPTION 'T3-2: admin cannot read the teams'; END IF;

    BEGIN
        INSERT INTO public.team_assignments (team_id, player_id, position, order_index)
        VALUES (v_team, pg_temp.pid('pedro@test.local'), 'CM', 9);
        RAISE EXCEPTION 'T3-2: admin inserted a team_assignments row directly';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE public.team_assignments SET position = 'GK' WHERE team_id = v_team;
        RAISE EXCEPTION 'T3-2: admin updated team_assignments directly';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        DELETE FROM public.team_assignments WHERE team_id = v_team;
        RAISE EXCEPTION 'T3-2: admin deleted team_assignments directly';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE public.teams SET score = 9 WHERE id = v_team;
        RAISE EXCEPTION 'T3-2: admin updated teams.score directly';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        DELETE FROM public.teams WHERE id = v_team;
        RAISE EXCEPTION 'T3-2: admin deleted a team directly';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    SELECT count(*) INTO v_n FROM public.team_assignments ta
    JOIN public.teams t ON t.id = ta.team_id WHERE t.match_id = pg_temp.ctx('match')::UUID;
    IF v_n <> 7 THEN RAISE EXCEPTION 'T3-2: admin reads % assignments, expected 7', v_n; END IF;

    PERFORM pg_temp.act_as('agus@test.local');
    SELECT count(*) INTO v_n FROM public.team_assignments ta
    JOIN public.teams t ON t.id = ta.team_id WHERE t.match_id = pg_temp.ctx('match')::UUID;
    IF v_n <> 7 THEN RAISE EXCEPTION 'T3-2: member reads % assignments, expected 7', v_n; END IF;
END $$;
RESET role;

-- The lineup trigger (00029, T2 owns it) still removes a leaver's slot: it
-- runs as SECURITY DEFINER, so it does not need the dropped policies.
DO $$
BEGIN
    PERFORM pg_temp.act_as('agus@test.local');
    PERFORM public.cancel_my_signup(pg_temp.ctx('match')::UUID);
END $$;
RESET role;
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.team_assignments ta JOIN public.teams t ON t.id = ta.team_id
        WHERE t.match_id = pg_temp.ctx('match')::UUID AND ta.player_id = pg_temp.pid('agus@test.local')
    ) THEN
        RAISE EXCEPTION 'T3-2: the leaver kept a team_assignments row';
    END IF;
END $$;

-- Captain republishes by hand (NULL snapshot): the old analysis is removed.
DO $$
BEGIN
    PERFORM pg_temp.act_as('juan@test.local');
    PERFORM public.publish_match_teams(pg_temp.ctx('match')::UUID, pg_temp.lineup(pg_temp.ctx('match')::UUID), NULL);
END $$;
RESET role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.match_ai_snapshots WHERE match_id = pg_temp.ctx('match')::UUID) THEN
        RAISE EXCEPTION 'T3-2: manual publish kept the AI snapshot';
    END IF;
    IF (SELECT count(*) FROM public.team_assignments ta JOIN public.teams t ON t.id = ta.team_id
        WHERE t.match_id = pg_temp.ctx('match')::UUID) <> 6 THEN
        RAISE EXCEPTION 'T3-2: manual publish did not save 6 assignments';
    END IF;
    IF (SELECT lineup_needs_review FROM public.matches WHERE id = pg_temp.ctx('match')::UUID) THEN
        RAISE EXCEPTION 'T3-2: publish did not clear lineup_needs_review';
    END IF;
END $$;

-- A member cannot publish.
DO $$
BEGIN
    PERFORM pg_temp.act_as('diego@test.local');
    BEGIN
        PERFORM public.publish_match_teams(pg_temp.ctx('match')::UUID, pg_temp.lineup(pg_temp.ctx('match')::UUID), '{"provider":"openai"}');
        RAISE EXCEPTION 'T3-2: member published teams';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE 'No tenés permiso%' THEN RAISE; END IF;
    END;
END $$;
RESET role;

-- ============================================
-- 3. GUEST PRIVACY AND NAME LIMIT
-- ============================================

DO $$
DECLARE
    v_name TEXT;
    v_n INTEGER;
    v_rating NUMERIC;
    v_col TEXT;
BEGIN
    PERFORM pg_temp.act_as('agus@test.local');
    SELECT display_name INTO v_name FROM public.guest_players WHERE id = pg_temp.ctx('guest')::UUID;
    IF v_name IS DISTINCT FROM 'Invitado T3' THEN RAISE EXCEPTION 'T3-3: member cannot read the guest name'; END IF;

    FOREACH v_col IN ARRAY ARRAY['estimated_rating', 'notes', 'self_signup_token'] LOOP
        BEGIN
            EXECUTE format('SELECT %I::TEXT FROM public.guest_players WHERE id = $1', v_col)
                INTO v_name USING pg_temp.ctx('guest')::UUID;
            RAISE EXCEPTION 'T3-3: member read guest_players.%', v_col;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
    END LOOP;

    -- The embed the app uses for rosters still works.
    SELECT count(*) INTO v_n FROM public.match_signups s
    JOIN public.guest_players g ON g.id = s.guest_player_id
    WHERE s.match_id = pg_temp.ctx('match')::UUID;
    IF v_n <> 1 THEN RAISE EXCEPTION 'T3-3: member roster join returned % guest rows', v_n; END IF;

    SELECT count(*) INTO v_n FROM public.get_match_guest_ratings(pg_temp.ctx('match')::UUID);
    IF v_n <> 0 THEN RAISE EXCEPTION 'T3-3: member got guest ratings'; END IF;

    PERFORM pg_temp.act_as('nico@test.local');
    SELECT count(*) INTO v_n FROM public.get_match_guest_ratings(pg_temp.ctx('match')::UUID);
    IF v_n <> 0 THEN RAISE EXCEPTION 'T3-3: another group''s admin got guest ratings'; END IF;

    PERFORM pg_temp.act_as('juan@test.local');
    SELECT estimated_rating INTO v_rating FROM public.get_match_guest_ratings(pg_temp.ctx('match')::UUID);
    IF v_rating IS DISTINCT FROM 4.50 THEN RAISE EXCEPTION 'T3-3: captain got guest rating %', v_rating; END IF;
    PERFORM public.admin_set_guest_rating(pg_temp.ctx('guest')::UUID, 2);

    PERFORM pg_temp.act_as('maxo@test.local');
    SELECT estimated_rating INTO v_rating FROM public.get_match_guest_ratings(pg_temp.ctx('match')::UUID);
    IF v_rating IS DISTINCT FROM 2.00 THEN RAISE EXCEPTION 'T3-3: admin got guest rating %', v_rating; END IF;
END $$;
RESET role;

DO $$
BEGIN
    BEGIN
        INSERT INTO public.guest_players (display_name, group_id)
        VALUES (repeat('x', 61), pg_temp.ctx('lunes')::UUID);
        RAISE EXCEPTION 'T3-3: 61-character guest name accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO public.guest_players (display_name, group_id) VALUES ('   ', pg_temp.ctx('lunes')::UUID);
        RAISE EXCEPTION 'T3-3: blank guest name accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    INSERT INTO public.guest_players (display_name, group_id) VALUES (repeat('y', 60), pg_temp.ctx('lunes')::UUID);
END $$;

-- ============================================
-- 4. OD-9: PER-GROUP RATING SUMMARY
-- ============================================

DO $$
DECLARE
    v_bad INTEGER;
BEGIN
    IF EXISTS (SELECT 1 FROM public.player_rating_summary WHERE group_id IS NULL) THEN
        RAISE EXCEPTION 'T3-4: summary rows without group';
    END IF;
    -- Every row counts only its own group's peer ratings and match ratings.
    SELECT count(*) INTO v_bad FROM public.player_rating_summary s
    WHERE s.peer_votes <> (SELECT count(*) FROM public.peer_ratings pr
                           WHERE pr.group_id = s.group_id AND pr.rated_player_id = s.player_id AND NOT pr.skipped)
       OR s.matches_rated <> (SELECT count(DISTINCT mr.match_id) FROM public.match_ratings mr
                              JOIN public.matches m ON m.id = mr.match_id
                              WHERE m.group_id = s.group_id AND mr.rated_player_id = s.player_id);
    IF v_bad > 0 THEN RAISE EXCEPTION 'T3-4: % summary rows mix groups', v_bad; END IF;
    -- Backfill: every membership has a row.
    SELECT count(*) INTO v_bad FROM public.group_memberships gm
    WHERE NOT EXISTS (SELECT 1 FROM public.player_rating_summary s
                      WHERE s.group_id = gm.group_id AND s.player_id = gm.player_id);
    IF v_bad > 0 THEN RAISE EXCEPTION 'T3-4: % memberships without a summary row', v_bad; END IF;
    -- fede plays in both groups and has a row in each.
    IF (SELECT count(*) FROM public.player_rating_summary
        WHERE player_id = pg_temp.pid('fede@test.local')
          AND group_id IN (pg_temp.ctx('lunes')::UUID, pg_temp.ctx('jueves')::UUID)) <> 2 THEN
        RAISE EXCEPTION 'T3-4: fede should have one summary row per group';
    END IF;
END $$;

-- Visibility: only the row's group admins and captains.
DO $$
DECLARE
    v_case RECORD;
    v_lunes INTEGER;
    v_jueves INTEGER;
BEGIN
    FOR v_case IN SELECT * FROM (VALUES
        ('maxo@test.local', TRUE, TRUE),     -- admin lunes, captain jueves
        ('juan@test.local', TRUE, FALSE),    -- captain lunes
        ('nico@test.local', FALSE, TRUE),    -- member lunes, admin jueves
        ('agus@test.local', FALSE, FALSE)    -- member of both
    ) AS c(email, sees_lunes, sees_jueves) LOOP
        PERFORM pg_temp.act_as(v_case.email);
        SELECT count(*) FILTER (WHERE group_id = pg_temp.ctx('lunes')::UUID),
               count(*) FILTER (WHERE group_id = pg_temp.ctx('jueves')::UUID)
          INTO v_lunes, v_jueves
        FROM public.player_rating_summary;
        IF (v_lunes > 0) <> v_case.sees_lunes OR (v_jueves > 0) <> v_case.sees_jueves THEN
            RAISE EXCEPTION 'T3-4: % sees % lunes / % jueves summary rows', v_case.email, v_lunes, v_jueves;
        END IF;
        BEGIN
            UPDATE public.player_rating_summary SET overall = 5;
            RAISE EXCEPTION 'T3-4: % updated the summary directly', v_case.email;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
    END LOOP;
END $$;
RESET role;

-- Recompute on peer_ratings DELETE / INSERT / UPDATE, one group at a time.
DO $$
DECLARE
    v_jueves_before public.player_rating_summary;
    v_row public.player_rating_summary;
BEGIN
    SELECT * INTO v_jueves_before FROM public.player_rating_summary
    WHERE group_id = pg_temp.ctx('jueves')::UUID AND player_id = pg_temp.pid('fede@test.local');

    DELETE FROM public.peer_ratings
    WHERE group_id = pg_temp.ctx('lunes')::UUID AND rated_player_id = pg_temp.pid('fede@test.local');

    SELECT * INTO v_row FROM public.player_rating_summary
    WHERE group_id = pg_temp.ctx('lunes')::UUID AND player_id = pg_temp.pid('fede@test.local');
    IF v_row.peer_votes <> 0 OR v_row.defense IS NOT NULL THEN
        RAISE EXCEPTION 'T3-4: DELETE did not recompute (peer_votes %)', v_row.peer_votes;
    END IF;

    SELECT * INTO v_row FROM public.player_rating_summary
    WHERE group_id = pg_temp.ctx('jueves')::UUID AND player_id = pg_temp.pid('fede@test.local');
    IF v_row.peer_votes <> v_jueves_before.peer_votes OR v_row.overall <> v_jueves_before.overall THEN
        RAISE EXCEPTION 'T3-4: deleting lunes ratings changed the jueves row';
    END IF;
END $$;

DO $$
DECLARE
    v_row public.player_rating_summary;
BEGIN
    PERFORM pg_temp.act_as('agus@test.local');
    INSERT INTO public.peer_ratings (group_id, voter_player_id, rated_player_id, goalkeeping, defense, attack, physical, tags)
    VALUES (pg_temp.ctx('lunes')::UUID, pg_temp.pid('agus@test.local'), pg_temp.pid('fede@test.local'), 1, 5, 4, 3, ARRAY['fast']);
END $$;
RESET role;

DO $$
DECLARE
    v_row public.player_rating_summary;
BEGIN
    SELECT * INTO v_row FROM public.player_rating_summary
    WHERE group_id = pg_temp.ctx('lunes')::UUID AND player_id = pg_temp.pid('fede@test.local');
    IF v_row.peer_votes <> 1 OR v_row.defense <> 5 OR v_row.tags <> ARRAY['fast'] THEN
        RAISE EXCEPTION 'T3-4: INSERT did not recompute: %', row_to_json(v_row);
    END IF;
END $$;

DO $$
BEGIN
    PERFORM pg_temp.act_as('agus@test.local');
    UPDATE public.peer_ratings SET defense = 2
    WHERE group_id = pg_temp.ctx('lunes')::UUID AND voter_player_id = pg_temp.pid('agus@test.local')
      AND rated_player_id = pg_temp.pid('fede@test.local');
END $$;
RESET role;

DO $$
BEGIN
    IF (SELECT defense FROM public.player_rating_summary
        WHERE group_id = pg_temp.ctx('lunes')::UUID AND player_id = pg_temp.pid('fede@test.local')) <> 2 THEN
        RAISE EXCEPTION 'T3-4: UPDATE did not recompute';
    END IF;
END $$;

-- The voter deletes their rating (the path account deletion uses).
DO $$
BEGIN
    PERFORM pg_temp.act_as('agus@test.local');
    DELETE FROM public.peer_ratings
    WHERE group_id = pg_temp.ctx('lunes')::UUID AND voter_player_id = pg_temp.pid('agus@test.local')
      AND rated_player_id = pg_temp.pid('fede@test.local');
END $$;
RESET role;

DO $$
BEGIN
    IF (SELECT peer_votes FROM public.player_rating_summary
        WHERE group_id = pg_temp.ctx('lunes')::UUID AND player_id = pg_temp.pid('fede@test.local')) <> 0 THEN
        RAISE EXCEPTION 'T3-4: voter DELETE did not recompute';
    END IF;
END $$;

-- A post-match rating only moves the row of the match's group.
DO $$
DECLARE
    v_finished UUID;
    v_lunes_before INTEGER;
    v_jueves_before INTEGER;
BEGIN
    SELECT m.id INTO v_finished FROM public.matches m
    WHERE m.group_id = pg_temp.ctx('lunes')::UUID AND m.status = 'finished'
      AND NOT EXISTS (SELECT 1 FROM public.match_ratings mr
                      WHERE mr.match_id = m.id AND mr.rated_player_id = pg_temp.pid('fede@test.local'))
    ORDER BY m.date_time DESC LIMIT 1;
    IF v_finished IS NULL THEN RAISE EXCEPTION 'T3-4 fixture: no finished lunes match without fede ratings'; END IF;

    SELECT matches_rated INTO v_lunes_before FROM public.player_rating_summary
    WHERE group_id = pg_temp.ctx('lunes')::UUID AND player_id = pg_temp.pid('fede@test.local');
    SELECT matches_rated INTO v_jueves_before FROM public.player_rating_summary
    WHERE group_id = pg_temp.ctx('jueves')::UUID AND player_id = pg_temp.pid('fede@test.local');

    INSERT INTO public.match_ratings (match_id, voter_player_id, rated_player_id, rating)
    VALUES (v_finished, pg_temp.pid('juan@test.local'), pg_temp.pid('fede@test.local'), 5);

    IF (SELECT matches_rated FROM public.player_rating_summary
        WHERE group_id = pg_temp.ctx('lunes')::UUID AND player_id = pg_temp.pid('fede@test.local')) <> v_lunes_before + 1
       OR (SELECT matches_rated FROM public.player_rating_summary
           WHERE group_id = pg_temp.ctx('jueves')::UUID AND player_id = pg_temp.pid('fede@test.local')) <> v_jueves_before THEN
        RAISE EXCEPTION 'T3-4: match rating recompute crossed groups';
    END IF;
END $$;

-- ============================================
-- 5. OD-10: GROUP-WIDE RULES
-- ============================================

DO $$
DECLARE
    v_rule UUID;
BEGIN
    PERFORM pg_temp.act_as('juan@test.local');
    INSERT INTO public.rule_sets (group_id, match_id, rule_type, data)
    VALUES (pg_temp.ctx('lunes')::UUID, NULL, 'min_goalkeepers', '{"min_count": 1}')
    RETURNING id INTO v_rule;
    UPDATE public.rule_sets SET is_active = FALSE WHERE id = v_rule;
    IF NOT FOUND THEN RAISE EXCEPTION 'T3-5: captain could not deactivate a group rule'; END IF;

    BEGIN
        INSERT INTO public.rule_sets (group_id, match_id, rule_type, data)
        VALUES (pg_temp.ctx('jueves')::UUID, NULL, 'min_goalkeepers', '{"min_count": 1}');
        RAISE EXCEPTION 'T3-5: captain of lunes wrote a jueves rule';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    PERFORM pg_temp.act_as('maxo@test.local');
    INSERT INTO public.rule_sets (group_id, match_id, rule_type, data)
    VALUES (pg_temp.ctx('jueves')::UUID, NULL, 'avoid_pair',
            jsonb_build_object('player_ids', jsonb_build_array(pg_temp.pid('agus@test.local'), pg_temp.pid('fede@test.local'))));

    PERFORM pg_temp.act_as('agus@test.local');
    BEGIN
        INSERT INTO public.rule_sets (group_id, match_id, rule_type, data)
        VALUES (pg_temp.ctx('lunes')::UUID, NULL, 'min_defenders', '{"min_count": 2}');
        RAISE EXCEPTION 'T3-5: member wrote a group rule';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    IF NOT EXISTS (SELECT 1 FROM public.rule_sets WHERE group_id = pg_temp.ctx('jueves')::UUID AND match_id IS NULL) THEN
        RAISE EXCEPTION 'T3-5: member cannot read group rules';
    END IF;
END $$;
RESET role;

-- ============================================
-- 6. OD-9 / GRP-8: GLOBAL STATS AFTER A GROUP IS DELETED
-- ============================================

DO $$
BEGIN
    IF (SELECT matches_played FROM public.player_profiles WHERE id = pg_temp.pid('diego@test.local')) = 0 THEN
        RAISE EXCEPTION 'T3-6 fixture: diego has no lunes matches to lose';
    END IF;
    INSERT INTO t3_ctx VALUES ('jueves_rows', (SELECT count(*) FROM public.player_rating_summary
                                               WHERE group_id = pg_temp.ctx('jueves')::UUID)::TEXT);
END $$;

-- Everyone who appears in a lunes match. Only their stats are asserted: the
-- shared DB may hold other players whose stats are stale for unrelated reasons.
CREATE TEMP TABLE t3_affected ON COMMIT DROP AS
SELECT DISTINCT ms.player_id FROM public.match_signups ms
JOIN public.matches m ON m.id = ms.match_id
WHERE m.group_id = (SELECT id FROM public.groups WHERE slug = 'futbol-lunes') AND ms.player_id IS NOT NULL;

DO $$
DECLARE
    v_n INTEGER;
BEGIN
    PERFORM pg_temp.act_as('maxo@test.local');
    DELETE FROM public.groups WHERE id = pg_temp.ctx('lunes')::UUID;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'T3-6: admin could not delete the group'; END IF;
END $$;
RESET role;
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

DO $$
DECLARE
    v_stale INTEGER;
BEGIN
    -- Expected stats come from what is left (jueves only).
    SELECT count(*) INTO v_stale FROM public.player_profiles pp
    WHERE pp.id IN (SELECT player_id FROM t3_affected)
      AND (pp.matches_played <> (
            SELECT count(*) FROM public.match_signups ms JOIN public.matches m ON m.id = ms.match_id
            WHERE ms.player_id = pp.id AND ms.status = 'confirmed' AND m.status = 'finished')
       OR pp.goals <> (
            SELECT count(*) FROM public.match_events me JOIN public.matches m ON m.id = me.match_id
            WHERE me.player_id = pp.id AND me.event_type = 'goal'
              AND m.status = 'finished' AND m.result_status IN ('consensus', 'locked'))
       OR pp.mvp_count <> (
            SELECT count(*) FROM public.matches m
            WHERE m.mvp_player_id = pp.id AND m.status = 'finished' AND m.result_status IN ('consensus', 'locked')));
    IF v_stale > 0 THEN RAISE EXCEPTION 'T3-6: % players kept stale stats after the group delete', v_stale; END IF;

    IF (SELECT goals FROM public.player_profiles WHERE id = pg_temp.pid('juan@test.local')) <> 0 THEN
        RAISE EXCEPTION 'T3-6: juan kept his lunes goals';
    END IF;
    IF EXISTS (SELECT 1 FROM public.player_rating_summary WHERE group_id = pg_temp.ctx('lunes')::UUID) THEN
        RAISE EXCEPTION 'T3-6: lunes summary rows survived the delete';
    END IF;
    IF (SELECT count(*) FROM public.player_rating_summary WHERE group_id = pg_temp.ctx('jueves')::UUID)
       <> pg_temp.ctx('jueves_rows')::INTEGER THEN
        RAISE EXCEPTION 'T3-6: the jueves summary rows changed';
    END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'T3 scenarios OK'; END $$;
