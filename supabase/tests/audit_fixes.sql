-- Scenarios for 00037_audit_fixes.sql (findings H1, M1, M2, L3 of the
-- 2026-11-15 wrap-up audit). Run inside a transaction that is always rolled
-- back (no BEGIN/COMMIT here):
--   DB=postgresql://postgres:postgres@127.0.0.1:56622/postgres
--   { echo "BEGIN;"; cat supabase/migrations/00037_audit_fixes.sql supabase/tests/audit_fixes.sql; \
--     echo "ROLLBACK;"; } | psql "$DB" -v ON_ERROR_STOP=1 -q
-- Needs the seed (supabase/seed.sql).

CREATE TEMP TABLE af_ids (k TEXT PRIMARY KEY, id UUID NOT NULL);
GRANT SELECT ON af_ids TO authenticated, anon;
INSERT INTO af_ids (k, id)
SELECT split_part(u.email, '@', 1), p.id
FROM auth.users u JOIN public.player_profiles p ON p.user_id = u.id
WHERE u.email LIKE '%@test.local';
INSERT INTO af_ids (k, id) VALUES
    ('lunes', '11111111-1111-4111-8111-111111111111'),
    ('jueves', '22222222-2222-4222-8222-222222222222'),
    ('m_prio', 'af000000-0000-4000-8000-000000000001'),
    ('g_org', 'af000000-0000-4000-8000-0000000000a1');

CREATE FUNCTION pg_temp.idof(p_key TEXT) RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT id FROM af_ids WHERE k = p_key $$;

CREATE FUNCTION pg_temp.act_as(p_who TEXT) RETURNS VOID
LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims',
        (SELECT json_build_object('sub', u.id, 'role', 'authenticated')::TEXT
         FROM auth.users u WHERE u.email = p_who || '@test.local'), true)
$$;

-- ============================================
-- H1: post-match ratings are private to the voter
-- ============================================

SELECT pg_temp.act_as('agus');
SET LOCAL role authenticated;
DO $$
DECLARE
    v_others INTEGER;
    v_avg NUMERIC;
    v_n INTEGER;
BEGIN
    SELECT count(*) INTO v_others FROM public.match_ratings
    WHERE voter_player_id <> pg_temp.idof('agus');
    IF v_others <> 0 THEN
        RAISE EXCEPTION 'H1: a member reads % ratings cast by others', v_others;
    END IF;

    SELECT avg_rating, ratings INTO v_avg, v_n
    FROM public.get_player_match_rating_avg(pg_temp.idof('lunes'), pg_temp.idof('fede'));
    IF v_n IS NULL OR v_n = 0 OR v_avg IS NULL THEN
        RAISE EXCEPTION 'H1: a member gets no average for a lunes player (n=%, avg=%)', v_n, v_avg;
    END IF;
END $$;
RESET role;

-- The average matches the table, read as postgres.
DO $$
DECLARE v_expected NUMERIC;
BEGIN
    SELECT ROUND(AVG(mr.rating)::NUMERIC, 2) INTO v_expected
    FROM public.match_ratings mr JOIN public.matches m ON m.id = mr.match_id
    WHERE m.group_id = pg_temp.idof('lunes') AND mr.rated_player_id = pg_temp.idof('fede');
    PERFORM pg_temp.act_as('agus');
    SET LOCAL role authenticated;
    IF (SELECT avg_rating FROM public.get_player_match_rating_avg(pg_temp.idof('lunes'), pg_temp.idof('fede')))
       IS DISTINCT FROM v_expected THEN
        RAISE EXCEPTION 'H1: average differs from the table';
    END IF;
    RESET role;
END $$;

-- A user who is not a member of the group gets nothing.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_user_meta_data, created_at, updated_at)
VALUES ('af000000-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'af-outsider@test.local', '', now(),
        '{"name": "Outsider"}'::jsonb, now(), now());
SELECT set_config('request.jwt.claims',
    json_build_object('sub', 'af000000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::TEXT, true);
SET LOCAL role authenticated;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.get_player_match_rating_avg(pg_temp.idof('lunes'), pg_temp.idof('fede'))) THEN
        RAISE EXCEPTION 'H1: an outsider gets an average';
    END IF;
    IF EXISTS (SELECT 1 FROM public.match_ratings) THEN
        RAISE EXCEPTION 'H1: an outsider reads ratings';
    END IF;
END $$;
RESET role;
SELECT set_config('request.jwt.claims', '', true);
DO $$ BEGIN RAISE NOTICE 'ok: H1 ratings private, average through the RPC for members only'; END $$;

-- ============================================
-- M1: a NULL waitlist_reason is promoted during the priority window
-- ============================================

UPDATE public.groups
SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{member_scoring}',
    '{"enabled": true, "priority": {"mode": "window", "threshold": 3.0, "window_hours": 24}}'::jsonb)
WHERE id = pg_temp.idof('jueves');

INSERT INTO public.matches (id, group_id, date_time, location, status, max_players, duration_minutes)
VALUES (pg_temp.idof('m_prio'), pg_temp.idof('jueves'), now() + interval '3 days', 'Cancha AF', 'full', 2, 60);
INSERT INTO public.guest_players (id, display_name, group_id) VALUES
    (pg_temp.idof('g_org'), 'Invitado del organizador', pg_temp.idof('jueves'));
INSERT INTO public.match_signups (match_id, player_id, guest_player_id, status, waitlist_position, waitlist_reason, signup_time)
VALUES
    (pg_temp.idof('m_prio'), pg_temp.idof('agus'), NULL, 'confirmed', NULL, NULL, now() - interval '2 hours'),
    (pg_temp.idof('m_prio'), pg_temp.idof('facu'), NULL, 'confirmed', NULL, NULL, now() - interval '2 hours'),
    (pg_temp.idof('m_prio'), NULL, pg_temp.idof('g_org'), 'waitlist', 1, NULL, now() - interval '1 hour');

DO $$
BEGIN
    IF (SELECT signup_opened_at FROM public.matches WHERE id = pg_temp.idof('m_prio')) IS NULL THEN
        UPDATE public.matches SET signup_opened_at = now() - interval '1 hour' WHERE id = pg_temp.idof('m_prio');
    END IF;
END $$;

UPDATE public.match_signups SET status = 'cancelled', cancel_time = now()
WHERE match_id = pg_temp.idof('m_prio') AND player_id = pg_temp.idof('facu');
SELECT public.promote_from_waitlist(pg_temp.idof('m_prio'));

DO $$
BEGIN
    IF (SELECT status::TEXT FROM public.match_signups
        WHERE match_id = pg_temp.idof('m_prio') AND guest_player_id = pg_temp.idof('g_org')) <> 'confirmed' THEN
        RAISE EXCEPTION 'M1: the organizer-added guest (NULL reason) stayed on the waitlist during the window';
    END IF;
    RAISE NOTICE 'ok: M1 NULL waitlist_reason promoted during the priority window';
END $$;

-- ============================================
-- M2: a player who left stays readable to the group
-- ============================================

UPDATE public.group_memberships SET is_active = FALSE
WHERE group_id = pg_temp.idof('lunes') AND player_id = pg_temp.idof('gonza');

SELECT pg_temp.act_as('agus');
SET LOCAL role authenticated;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.player_profiles WHERE id = pg_temp.idof('gonza')) THEN
        RAISE EXCEPTION 'M2: a member cannot read a past member of their group';
    END IF;
END $$;
RESET role;

-- An outsider still cannot.
SELECT set_config('request.jwt.claims',
    json_build_object('sub', 'af000000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::TEXT, true);
SET LOCAL role authenticated;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.player_profiles WHERE id = pg_temp.idof('gonza')) THEN
        RAISE EXCEPTION 'M2: an outsider reads a profile';
    END IF;
    RAISE NOTICE 'ok: M2 past members readable by their groups only';
END $$;
RESET role;
SELECT set_config('request.jwt.claims', '', true);

-- ============================================
-- L3: account deletion drops the rules that name the player
-- ============================================

INSERT INTO public.rule_sets (group_id, match_id, rule_type, data)
VALUES (pg_temp.idof('lunes'), NULL, 'avoid_pair',
        jsonb_build_object('player_ids', jsonb_build_array(pg_temp.idof('lucho'), pg_temp.idof('mati'))));
UPDATE public.player_profiles SET deleted_at = now() WHERE id = pg_temp.idof('lucho');
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.rule_sets WHERE (data -> 'player_ids') ? pg_temp.idof('lucho')::TEXT) THEN
        RAISE EXCEPTION 'L3: a rule still names the deleted player';
    END IF;
    RAISE NOTICE 'ok: L3 rules naming a deleted player are dropped';
END $$;

DO $$ BEGIN RAISE NOTICE 'audit_fixes: all scenarios passed'; END $$;
