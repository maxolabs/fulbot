-- Track T2 (match lifecycle) scenarios for 00034_lineup_finish_priority.sql.
--
-- Run inside a transaction that is always rolled back (no BEGIN/COMMIT here):
--   DB=postgresql://postgres:postgres@127.0.0.1:56622/postgres
--   { echo "BEGIN; SET LOCAL lock_timeout = '30s';"; \
--     cat supabase/migrations/00034_lineup_finish_priority.sql supabase/tests/t2.sql; \
--     echo "ROLLBACK;"; } | psql "$DB" -v ON_ERROR_STOP=1 -q
--
-- Needs the seed (supabase/seed.sql): groups futbol-lunes (admin maxo, captain
-- juan) and futbol-jueves (admin nico, captain maxo) and their *@test.local
-- members. Every match, guest and setting it uses is created here.
-- Deferred lineup_changed notifications are flushed with SET CONSTRAINTS.
-- Each scenario ends with RAISE NOTICE 'ok: ...'.

-- ============================================
-- Helpers
-- ============================================

CREATE TEMP TABLE t2_ids (k TEXT PRIMARY KEY, id UUID NOT NULL);
GRANT SELECT ON t2_ids TO authenticated, anon;

INSERT INTO t2_ids (k, id)
SELECT split_part(u.email, '@', 1), p.id
FROM auth.users u JOIN public.player_profiles p ON p.user_id = u.id
WHERE u.email LIKE '%@test.local';

INSERT INTO t2_ids (k, id) VALUES
    ('lunes', '11111111-1111-4111-8111-111111111111'),
    ('jueves', '22222222-2222-4222-8222-222222222222'),
    ('m_swap', 'a2000000-0000-4000-8000-000000000001'),
    ('m_late', 'a2000000-0000-4000-8000-000000000002'),
    ('m_early', 'a2000000-0000-4000-8000-000000000003'),
    ('m_auto', 'a2000000-0000-4000-8000-000000000004'),
    ('m_empty', 'a2000000-0000-4000-8000-000000000005'),
    ('m_admin', 'a2000000-0000-4000-8000-000000000006'),
    ('m_future', 'a2000000-0000-4000-8000-000000000007'),
    ('m_teams_fin', 'a2000000-0000-4000-8000-000000000008'),
    ('m_guest_w', 'a2000000-0000-4000-8000-000000000009'),
    ('m_guest_r', 'a2000000-0000-4000-8000-00000000000a'),
    ('m_guest_off', 'a2000000-0000-4000-8000-00000000000b'),
    ('g_a', 'b2000000-0000-4000-8000-000000000001'),
    ('g_b', 'b2000000-0000-4000-8000-000000000002'),
    ('g_c', 'b2000000-0000-4000-8000-000000000003'),
    ('tok_a', 'c2000000-0000-4000-8000-000000000001'),
    ('tok_c', 'c2000000-0000-4000-8000-000000000003'),
    ('tok_w', 'c2000000-0000-4000-8000-000000000004'),
    ('tok_r1', 'c2000000-0000-4000-8000-000000000005'),
    ('tok_r2', 'c2000000-0000-4000-8000-000000000006'),
    ('tok_off', 'c2000000-0000-4000-8000-000000000007'),
    ('tok_full', 'c2000000-0000-4000-8000-000000000008');

CREATE FUNCTION pg_temp.idof(p_key TEXT) RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT id FROM t2_ids WHERE k = p_key $$;

-- JWT claims for a seed user (by the part before @), 'anon' or 'service'.
CREATE FUNCTION pg_temp.claims(p_who TEXT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT CASE p_who
        WHEN 'anon' THEN json_build_object('role', 'anon')::TEXT
        WHEN 'service' THEN json_build_object('role', 'service_role')::TEXT
        ELSE (SELECT json_build_object('sub', u.id, 'role', 'authenticated')::TEXT
              FROM auth.users u WHERE u.email = p_who || '@test.local')
    END
$$;

CREATE FUNCTION pg_temp.signup_id(p_match TEXT, p_who TEXT) RETURNS UUID
LANGUAGE sql STABLE AS $$
    SELECT s.id FROM public.match_signups s
    WHERE s.match_id = pg_temp.idof(p_match)
      AND (s.player_id = pg_temp.idof(p_who) OR s.guest_player_id = pg_temp.idof(p_who))
$$;

-- 'dark:ST:2' for a player or guest of a match, NULL without a slot.
CREATE FUNCTION pg_temp.slot(p_match TEXT, p_who TEXT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT t.name || ':' || ta.position || ':' || ta.order_index
    FROM public.team_assignments ta JOIN public.teams t ON t.id = ta.team_id
    WHERE t.match_id = pg_temp.idof(p_match)
      AND (ta.player_id = pg_temp.idof(p_who) OR ta.guest_player_id = pg_temp.idof(p_who))
$$;

CREATE FUNCTION pg_temp.status_of(p_match TEXT, p_who TEXT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT s.status::TEXT FROM public.match_signups s WHERE s.id = pg_temp.signup_id(p_match, p_who)
$$;

CREATE FUNCTION pg_temp.add_signup(p_match TEXT, p_who TEXT, p_status signup_status, p_pos SMALLINT DEFAULT NULL)
RETURNS VOID LANGUAGE sql AS $$
    INSERT INTO public.match_signups (match_id, player_id, guest_player_id, status, waitlist_position, waitlist_reason, signup_time)
    SELECT pg_temp.idof(p_match),
           CASE WHEN p_who LIKE 'g\_%' THEN NULL ELSE pg_temp.idof(p_who) END,
           CASE WHEN p_who LIKE 'g\_%' THEN pg_temp.idof(p_who) END,
           p_status, p_pos, CASE WHEN p_status = 'waitlist' THEN 'full' END,
           now() - interval '1 day' + (COALESCE(p_pos, 0) || ' minutes')::interval
$$;

CREATE FUNCTION pg_temp.add_match(p_key TEXT, p_group TEXT, p_status match_status, p_at TIMESTAMPTZ, p_max INTEGER)
RETURNS VOID LANGUAGE sql AS $$
    INSERT INTO public.matches (id, group_id, date_time, location, status, max_players, duration_minutes)
    VALUES (pg_temp.idof(p_key), pg_temp.idof(p_group), p_at, 'Cancha T2', p_status, p_max, 60)
$$;

-- Guests used on the teams_created match (A and C sign up themselves on /m).
INSERT INTO public.guest_players (id, display_name, group_id, self_signup_token) VALUES
    (pg_temp.idof('g_a'), 'Invitado A', pg_temp.idof('lunes'), pg_temp.idof('tok_a')),
    (pg_temp.idof('g_b'), 'Invitado B', pg_temp.idof('lunes'), NULL),
    (pg_temp.idof('g_c'), 'Invitado C', pg_temp.idof('lunes'), pg_temp.idof('tok_c'));

-- ============================================
-- OD-2: lineup swap on a teams_created match
-- ============================================
-- m_swap (lunes, in 2 days, 6 players):
--   dark : agus GK 0, diego CB 1, Invitado A ST 2
--   light: fede GK 0, Invitado B CB 1, franco ST 2
--   waitlist: Invitado C, gonza, lucho

SELECT pg_temp.add_match('m_swap', 'lunes', 'signup_closed', now() + interval '2 days', 6);
SELECT pg_temp.add_signup('m_swap', 'agus', 'confirmed');
SELECT pg_temp.add_signup('m_swap', 'diego', 'confirmed');
SELECT pg_temp.add_signup('m_swap', 'g_a', 'confirmed');
SELECT pg_temp.add_signup('m_swap', 'fede', 'confirmed');
SELECT pg_temp.add_signup('m_swap', 'g_b', 'confirmed');
SELECT pg_temp.add_signup('m_swap', 'franco', 'confirmed');
SELECT pg_temp.add_signup('m_swap', 'g_c', 'waitlist', 1::SMALLINT);
SELECT pg_temp.add_signup('m_swap', 'gonza', 'waitlist', 2::SMALLINT);
SELECT pg_temp.add_signup('m_swap', 'lucho', 'waitlist', 3::SMALLINT);

INSERT INTO public.teams (match_id, name, color_hex) VALUES
    (pg_temp.idof('m_swap'), 'dark', '#1C1C1E'), (pg_temp.idof('m_swap'), 'light', '#F3F0E6');
INSERT INTO public.team_assignments (team_id, player_id, guest_player_id, position, order_index, source)
SELECT t.id, CASE WHEN a.who LIKE 'g\_%' THEN NULL ELSE pg_temp.idof(a.who) END,
       CASE WHEN a.who LIKE 'g\_%' THEN pg_temp.idof(a.who) END, a.pos, a.ord, 'ai'
FROM (VALUES ('dark', 'agus', 'GK', 0), ('dark', 'diego', 'CB', 1), ('dark', 'g_a', 'ST', 2),
             ('light', 'fede', 'GK', 0), ('light', 'g_b', 'CB', 1), ('light', 'franco', 'ST', 2))
     AS a(team, who, pos, ord)
JOIN public.teams t ON t.match_id = pg_temp.idof('m_swap') AND t.name::TEXT = a.team;
UPDATE public.matches SET status = 'teams_created', lineup_needs_review = FALSE WHERE id = pg_temp.idof('m_swap');

-- S1: a guest leaves from /m, the first on the waitlist is a guest.
DELETE FROM public.notifications WHERE match_id = pg_temp.idof('m_swap');
SELECT set_config('request.jwt.claims', pg_temp.claims('anon'), true);
SET LOCAL role anon;
SELECT public.cancel_guest_signup(pg_temp.idof('m_swap'), pg_temp.idof('tok_a'));
SET CONSTRAINTS public.match_signups_notify_lineup IMMEDIATE;
SET CONSTRAINTS public.match_signups_notify_lineup DEFERRED;
RESET role;
SELECT set_config('request.jwt.claims', '', true);

DO $$
DECLARE n RECORD;
BEGIN
    IF pg_temp.status_of('m_swap', 'g_c') <> 'confirmed' THEN RAISE EXCEPTION 'S1: Invitado C was not promoted'; END IF;
    IF pg_temp.slot('m_swap', 'g_c') IS DISTINCT FROM 'dark:ST:2' THEN
        RAISE EXCEPTION 'S1: Invitado C got %, expected dark:ST:2', pg_temp.slot('m_swap', 'g_c');
    END IF;
    IF pg_temp.slot('m_swap', 'g_a') IS NOT NULL THEN RAISE EXCEPTION 'S1: Invitado A kept a slot'; END IF;
    IF (SELECT lineup_needs_review FROM public.matches WHERE id = pg_temp.idof('m_swap')) THEN
        RAISE EXCEPTION 'S1: a full swap must not flag the lineup';
    END IF;
    IF (SELECT count(*) FROM public.notifications WHERE match_id = pg_temp.idof('m_swap') AND type = 'lineup_changed') <> 2
       OR EXISTS (SELECT 1 FROM public.notifications WHERE match_id = pg_temp.idof('m_swap') AND type = 'lineup_changed'
                  AND recipient_player_id NOT IN (pg_temp.idof('maxo'), pg_temp.idof('juan'))) THEN
        RAISE EXCEPTION 'S1: lineup_changed must reach exactly the admin and the captain';
    END IF;
    SELECT * INTO n FROM public.notifications
    WHERE match_id = pg_temp.idof('m_swap') AND type = 'lineup_changed' AND recipient_player_id = pg_temp.idof('maxo');
    IF n.payload->>'phase' <> 'teams'
       OR n.payload->'swaps' <> '[{"left": "Invitado A", "in": "Invitado C", "team": "dark", "position": "ST"}]'::jsonb
       OR (n.payload->>'needs_review')::boolean THEN
        RAISE EXCEPTION 'S1: unexpected lineup_changed payload %', n.payload;
    END IF;
    SELECT * INTO n FROM public.notifications WHERE match_id = pg_temp.idof('m_swap') AND type = 'waitlist_promoted';
    IF n.payload->>'team' <> 'dark' OR n.payload->>'position' <> 'ST' OR n.recipient_player_id IS NOT NULL THEN
        RAISE EXCEPTION 'S1: waitlist_promoted payload %', n.payload;
    END IF;
    IF EXISTS (SELECT 1 FROM public.notifications WHERE match_id = pg_temp.idof('m_swap')
               AND type NOT IN ('lineup_changed', 'waitlist_promoted')) THEN
        RAISE EXCEPTION 'S1: unexpected notification types';
    END IF;
    RAISE NOTICE 'ok: S1 guest leaves, guest from the waitlist takes dark ST';
END $$;

-- S2: a member leaves, a member is promoted.
DELETE FROM public.notifications WHERE match_id = pg_temp.idof('m_swap');
SELECT set_config('request.jwt.claims', pg_temp.claims('agus'), true);
SET LOCAL role authenticated;
SELECT public.cancel_my_signup(pg_temp.idof('m_swap'));
SET CONSTRAINTS public.match_signups_notify_lineup IMMEDIATE;
SET CONSTRAINTS public.match_signups_notify_lineup DEFERRED;
RESET role;
SELECT set_config('request.jwt.claims', '', true);

DO $$
DECLARE n RECORD;
BEGIN
    IF pg_temp.slot('m_swap', 'gonza') IS DISTINCT FROM 'dark:GK:0' THEN
        RAISE EXCEPTION 'S2: gonza got %, expected dark:GK:0', pg_temp.slot('m_swap', 'gonza');
    END IF;
    IF pg_temp.slot('m_swap', 'agus') IS NOT NULL THEN RAISE EXCEPTION 'S2: agus kept a slot'; END IF;
    IF (SELECT lineup_needs_review FROM public.matches WHERE id = pg_temp.idof('m_swap')) THEN
        RAISE EXCEPTION 'S2: flagged after a swap';
    END IF;
    SELECT * INTO n FROM public.notifications WHERE match_id = pg_temp.idof('m_swap') AND type = 'waitlist_promoted';
    IF n.recipient_player_id <> pg_temp.idof('gonza') OR n.payload->>'team' <> 'dark' OR n.payload->>'position' <> 'GK' THEN
        RAISE EXCEPTION 'S2: waitlist_promoted %', n.payload;
    END IF;
    IF (SELECT count(*) FROM public.notifications WHERE match_id = pg_temp.idof('m_swap') AND type = 'lineup_changed') <> 2 THEN
        RAISE EXCEPTION 'S2: expected 2 lineup_changed rows';
    END IF;
    IF (SELECT count(*) FROM public.team_assignments ta JOIN public.teams t ON t.id = ta.team_id
        WHERE t.match_id = pg_temp.idof('m_swap')) <> 6 THEN
        RAISE EXCEPTION 'S2: the lineup lost a slot';
    END IF;
    RAISE NOTICE 'ok: S2 member leaves, member from the waitlist takes dark GK';
END $$;

-- S3: the admin removes a guest; the admin is not notified of their own action.
DELETE FROM public.notifications WHERE match_id = pg_temp.idof('m_swap');
SELECT set_config('request.jwt.claims', pg_temp.claims('maxo'), true);
SET LOCAL role authenticated;
SELECT public.admin_remove_signup(pg_temp.signup_id('m_swap', 'g_b'));
SET CONSTRAINTS public.match_signups_notify_lineup IMMEDIATE;
SET CONSTRAINTS public.match_signups_notify_lineup DEFERRED;
RESET role;
SELECT set_config('request.jwt.claims', '', true);

DO $$
BEGIN
    IF pg_temp.slot('m_swap', 'lucho') IS DISTINCT FROM 'light:CB:1' THEN
        RAISE EXCEPTION 'S3: lucho got %, expected light:CB:1', pg_temp.slot('m_swap', 'lucho');
    END IF;
    IF (SELECT array_agg(recipient_player_id) FROM public.notifications
        WHERE match_id = pg_temp.idof('m_swap') AND type = 'lineup_changed') <> ARRAY[pg_temp.idof('juan')] THEN
        RAISE EXCEPTION 'S3: only the captain should hear about the admin''s removal';
    END IF;
    RAISE NOTICE 'ok: S3 admin removes a guest, member takes light CB, actor not notified';
END $$;

-- S4: nobody left on the waitlist: the slot goes and the lineup is flagged.
DELETE FROM public.notifications WHERE match_id = pg_temp.idof('m_swap');
SELECT set_config('request.jwt.claims', pg_temp.claims('diego'), true);
SET LOCAL role authenticated;
SELECT public.cancel_my_signup(pg_temp.idof('m_swap'));
SET CONSTRAINTS public.match_signups_notify_lineup IMMEDIATE;
SET CONSTRAINTS public.match_signups_notify_lineup DEFERRED;
RESET role;
SELECT set_config('request.jwt.claims', '', true);

DO $$
DECLARE n RECORD;
BEGIN
    IF pg_temp.slot('m_swap', 'diego') IS NOT NULL THEN RAISE EXCEPTION 'S4: diego kept a slot'; END IF;
    IF NOT (SELECT lineup_needs_review FROM public.matches WHERE id = pg_temp.idof('m_swap')) THEN
        RAISE EXCEPTION 'S4: an unfilled slot must flag the lineup';
    END IF;
    SELECT * INTO n FROM public.notifications
    WHERE match_id = pg_temp.idof('m_swap') AND type = 'lineup_changed' AND recipient_player_id = pg_temp.idof('maxo');
    IF n.payload->'swaps' <> '[]'::jsonb OR n.payload->'promoted' <> '[]'::jsonb
       OR NOT (n.payload->>'needs_review')::boolean OR (n.payload->>'spots_left')::int <> 1 THEN
        RAISE EXCEPTION 'S4: payload %', n.payload;
    END IF;
    IF EXISTS (SELECT 1 FROM public.notifications WHERE match_id = pg_temp.idof('m_swap') AND type = 'waitlist_promoted') THEN
        RAISE EXCEPTION 'S4: nobody was promoted';
    END IF;
    RAISE NOTICE 'ok: S4 no waitlist, slot removed, lineup flagged';
END $$;

-- S5: a swap while the lineup is already flagged keeps the flag.
SELECT pg_temp.add_signup('m_swap', 'martin', 'waitlist', 1::SMALLINT);
SELECT set_config('request.jwt.claims', pg_temp.claims('franco'), true);
SET LOCAL role authenticated;
SELECT public.cancel_my_signup(pg_temp.idof('m_swap'));
SET CONSTRAINTS public.match_signups_notify_lineup IMMEDIATE;
SET CONSTRAINTS public.match_signups_notify_lineup DEFERRED;
RESET role;
SELECT set_config('request.jwt.claims', '', true);

DO $$
BEGIN
    IF pg_temp.slot('m_swap', 'martin') IS DISTINCT FROM 'light:ST:2' THEN
        RAISE EXCEPTION 'S5: martin got %, expected light:ST:2', pg_temp.slot('m_swap', 'martin');
    END IF;
    IF NOT (SELECT lineup_needs_review FROM public.matches WHERE id = pg_temp.idof('m_swap')) THEN
        RAISE EXCEPTION 'S5: the earlier gap is still there, the flag must stay';
    END IF;
    RAISE NOTICE 'ok: S5 swap on a flagged lineup keeps the flag';
END $$;

-- ============================================
-- OD-11: drop-outs before the teams
-- ============================================

-- S6: inside the late-cancel window (lunes default 6 h; kickoff in 3 h).
SELECT pg_temp.add_match('m_late', 'lunes', 'signup_open', now() + interval '3 hours', 4);
SELECT pg_temp.add_signup('m_late', 'agus', 'confirmed');
SELECT pg_temp.add_signup('m_late', 'diego', 'confirmed');
SELECT pg_temp.add_signup('m_late', 'fede', 'confirmed');
SELECT pg_temp.add_signup('m_late', 'franco', 'confirmed');
SELECT pg_temp.add_signup('m_late', 'gonza', 'waitlist', 1::SMALLINT);
UPDATE public.matches SET status = 'full' WHERE id = pg_temp.idof('m_late');
DELETE FROM public.notifications WHERE match_id = pg_temp.idof('m_late');

SELECT set_config('request.jwt.claims', pg_temp.claims('agus'), true);
SET LOCAL role authenticated;
SELECT public.cancel_my_signup(pg_temp.idof('m_late'));
SET CONSTRAINTS public.match_signups_notify_lineup IMMEDIATE;
SET CONSTRAINTS public.match_signups_notify_lineup DEFERRED;
RESET role;
SELECT set_config('request.jwt.claims', '', true);

DO $$
DECLARE n RECORD;
BEGIN
    IF (SELECT count(*) FROM public.notifications WHERE match_id = pg_temp.idof('m_late') AND type = 'lineup_changed') <> 2 THEN
        RAISE EXCEPTION 'S6: a late drop-out must reach the admin and the captain';
    END IF;
    SELECT * INTO n FROM public.notifications
    WHERE match_id = pg_temp.idof('m_late') AND type = 'lineup_changed' AND recipient_player_id = pg_temp.idof('juan');
    IF n.payload->>'phase' <> 'late' OR n.payload->'promoted'->0->>'name' IS NULL
       OR n.payload->'left'->0->>'player_id' <> pg_temp.idof('agus')::TEXT THEN
        RAISE EXCEPTION 'S6: payload %', n.payload;
    END IF;
    IF EXISTS (SELECT 1 FROM public.notifications WHERE match_id = pg_temp.idof('m_late')
               AND type NOT IN ('lineup_changed', 'waitlist_promoted')) THEN
        RAISE EXCEPTION 'S6: a drop-out must not notify the whole group';
    END IF;
    RAISE NOTICE 'ok: S6 late drop-out before teams notifies admin and captain only';
END $$;

-- S7: outside the window and without teams: nobody but the promoted player hears.
SELECT pg_temp.add_match('m_early', 'lunes', 'signup_open', now() + interval '3 days', 4);
SELECT pg_temp.add_signup('m_early', 'agus', 'confirmed');
SELECT pg_temp.add_signup('m_early', 'diego', 'confirmed');
SELECT pg_temp.add_signup('m_early', 'fede', 'confirmed');
SELECT pg_temp.add_signup('m_early', 'franco', 'confirmed');
SELECT pg_temp.add_signup('m_early', 'gonza', 'waitlist', 1::SMALLINT);
UPDATE public.matches SET status = 'full' WHERE id = pg_temp.idof('m_early');
DELETE FROM public.notifications WHERE match_id = pg_temp.idof('m_early');

SELECT set_config('request.jwt.claims', pg_temp.claims('agus'), true);
SET LOCAL role authenticated;
SELECT public.cancel_my_signup(pg_temp.idof('m_early'));
SET CONSTRAINTS public.match_signups_notify_lineup IMMEDIATE;
SET CONSTRAINTS public.match_signups_notify_lineup DEFERRED;
RESET role;
SELECT set_config('request.jwt.claims', '', true);

DO $$
BEGIN
    IF pg_temp.status_of('m_early', 'gonza') <> 'confirmed' THEN RAISE EXCEPTION 'S7: gonza not promoted'; END IF;
    IF EXISTS (SELECT 1 FROM public.notifications WHERE match_id = pg_temp.idof('m_early') AND type <> 'waitlist_promoted') THEN
        RAISE EXCEPTION 'S7: an early drop-out without teams must not notify anyone else';
    END IF;
    IF (SELECT recipient_player_id FROM public.notifications WHERE match_id = pg_temp.idof('m_early')) <> pg_temp.idof('gonza') THEN
        RAISE EXCEPTION 'S7: waitlist_promoted goes to the promoted player';
    END IF;
    RAISE NOTICE 'ok: S7 early drop-out without teams: no drop-out notification';
END $$;

-- ============================================
-- OD-3: attendance-only finish
-- ============================================

-- S8: the ticker finishes a teamless match after kickoff + duration.
SELECT pg_temp.add_match('m_auto', 'lunes', 'signup_open', now() - interval '2 hours', 6);
SELECT pg_temp.add_signup('m_auto', 'agus', 'confirmed');
SELECT pg_temp.add_signup('m_auto', 'diego', 'confirmed');
SELECT pg_temp.add_signup('m_auto', 'fede', 'confirmed');
SELECT pg_temp.add_signup('m_auto', 'franco', 'confirmed');
SELECT pg_temp.add_signup('m_auto', 'gonza', 'waitlist', 1::SMALLINT);
UPDATE public.matches SET status = 'signup_closed' WHERE id = pg_temp.idof('m_auto');

SELECT set_config('request.jwt.claims', pg_temp.claims('service'), true);
DO $$
BEGIN
    IF NOT public.auto_finish_match(pg_temp.idof('m_auto')) THEN RAISE EXCEPTION 'S8: auto_finish_match did nothing'; END IF;
END $$;
SELECT set_config('request.jwt.claims', '', true);

DO $$
DECLARE m public.matches;
BEGIN
    SELECT * INTO m FROM public.matches WHERE id = pg_temp.idof('m_auto');
    IF m.status <> 'finished' OR m.finished_at IS NULL OR NOT m.results_finalized THEN
        RAISE EXCEPTION 'S8: status % finished_at % finalized %', m.status, m.finished_at, m.results_finalized;
    END IF;
    IF (SELECT count(*) FROM public.member_events WHERE match_id = m.id AND type = 'attended') <> 4 THEN
        RAISE EXCEPTION 'S8: attendance events missing';
    END IF;
    IF EXISTS (SELECT 1 FROM public.scheduled_jobs WHERE match_id = m.id AND status = 'pending') THEN
        RAISE EXCEPTION 'S8: an attendance-only match must not queue results jobs';
    END IF;
    -- Stats were recomputed for the players who attended (finalize_match_results).
    IF (SELECT matches_played FROM public.player_profiles WHERE id = pg_temp.idof('agus'))
       <> (SELECT count(*) FROM public.match_signups ms JOIN public.matches mm ON mm.id = ms.match_id
           WHERE ms.player_id = pg_temp.idof('agus') AND ms.status = 'confirmed' AND mm.status = 'finished') THEN
        RAISE EXCEPTION 'S8: matches_played not recomputed from attendance';
    END IF;
    IF EXISTS (SELECT 1 FROM public.notifications WHERE match_id = m.id AND type LIKE 'results%') THEN
        RAISE EXCEPTION 'S8: results notification for an attendance-only match';
    END IF;
    RAISE NOTICE 'ok: S8 auto-finish without teams: attendance, stats, no results jobs';
END $$;

-- S9: nobody confirmed: the ticker leaves it for the organizer.
SELECT pg_temp.add_match('m_empty', 'lunes', 'signup_open', now() - interval '2 hours', 6);
SELECT set_config('request.jwt.claims', pg_temp.claims('service'), true);
DO $$
BEGIN
    IF public.auto_finish_match(pg_temp.idof('m_empty')) THEN RAISE EXCEPTION 'S9: finished an empty match'; END IF;
    IF (SELECT status FROM public.matches WHERE id = pg_temp.idof('m_empty')) <> 'signup_open' THEN
        RAISE EXCEPTION 'S9: status changed';
    END IF;
    RAISE NOTICE 'ok: S9 empty teamless match is not auto-finished';
END $$;
SELECT set_config('request.jwt.claims', '', true);

-- S10: a captain finishes a teamless match after kickoff; not before; members never.
SELECT pg_temp.add_match('m_admin', 'jueves', 'signup_open', now() - interval '30 minutes', 10);
SELECT pg_temp.add_signup('m_admin', 'agus', 'confirmed');
SELECT pg_temp.add_signup('m_admin', 'facu', 'confirmed');
SELECT pg_temp.add_signup('m_admin', 'fede', 'confirmed');
SELECT pg_temp.add_match('m_future', 'jueves', 'signup_open', now() + interval '1 day', 10);
SELECT pg_temp.add_signup('m_future', 'agus', 'confirmed');

SELECT set_config('request.jwt.claims', pg_temp.claims('agus'), true);
SET LOCAL role authenticated;
DO $$
BEGIN
    BEGIN
        PERFORM public.admin_set_match_status(pg_temp.idof('m_admin'), 'finished');
        RAISE EXCEPTION 'S10: a member finished the match';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE 'No tenés permiso%' THEN RAISE; END IF;
    END;
END $$;
RESET role;
SELECT set_config('request.jwt.claims', '', true);

SELECT set_config('request.jwt.claims', pg_temp.claims('maxo'), true);
SET LOCAL role authenticated;
DO $$
BEGIN
    BEGIN
        PERFORM public.admin_set_match_status(pg_temp.idof('m_future'), 'finished');
        RAISE EXCEPTION 'S10: finished before kickoff';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'El partido todavía no empezó' THEN RAISE; END IF;
    END;
    PERFORM public.admin_set_match_status(pg_temp.idof('m_admin'), 'finished');
END $$;
RESET role;
SELECT set_config('request.jwt.claims', '', true);

DO $$
BEGIN
    IF (SELECT status FROM public.matches WHERE id = pg_temp.idof('m_admin')) <> 'finished' THEN
        RAISE EXCEPTION 'S10: captain could not finish';
    END IF;
    IF (SELECT count(*) FROM public.member_events WHERE match_id = pg_temp.idof('m_admin') AND type = 'attended') <> 3 THEN
        RAISE EXCEPTION 'S10: attendance events missing';
    END IF;
    IF EXISTS (SELECT 1 FROM public.scheduled_jobs WHERE match_id = pg_temp.idof('m_admin') AND status = 'pending') THEN
        RAISE EXCEPTION 'S10: results jobs queued';
    END IF;
    RAISE NOTICE 'ok: S10 captain finishes a teamless match after kickoff only';
END $$;

-- S11/S12: no report and no MVP vote on an attendance-only match.
SELECT set_config('request.jwt.claims', pg_temp.claims('agus'), true);
SET LOCAL role authenticated;
DO $$
BEGIN
    BEGIN
        PERFORM public.submit_match_report(pg_temp.idof('m_auto'), 3, 2, FALSE, FALSE, NULL, NULL);
        RAISE EXCEPTION 'S11: report accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE 'Este partido se cerró sin equipos%' THEN RAISE; END IF;
    END;
    BEGIN
        INSERT INTO public.match_mvp_votes (match_id, voter_player_id, candidate_player_id)
        VALUES (pg_temp.idof('m_auto'), pg_temp.idof('agus'), pg_temp.idof('diego'));
        RAISE EXCEPTION 'S12: MVP vote accepted';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
    RAISE NOTICE 'ok: S11/S12 no report and no MVP vote without teams';
END $$;
RESET role;
SELECT set_config('request.jwt.claims', '', true);

-- S13: a results job queued before the finish closes without running.
INSERT INTO public.scheduled_jobs (group_id, match_id, job_type, run_at, payload)
VALUES (pg_temp.idof('lunes'), pg_temp.idof('m_auto'), 'results_request', now() - interval '1 minute', '{}'::jsonb);
SELECT set_config('request.jwt.claims', pg_temp.claims('service'), true);
DO $$
DECLARE r JSONB;
BEGIN
    r := public.run_scheduled_job((SELECT id FROM public.scheduled_jobs
        WHERE match_id = pg_temp.idof('m_auto') AND job_type = 'results_request' AND status = 'pending'));
    IF r->>'skipped' <> 'attendance_only' THEN RAISE EXCEPTION 'S13: %', r; END IF;
    IF EXISTS (SELECT 1 FROM public.notifications WHERE match_id = pg_temp.idof('m_auto') AND type = 'results_request') THEN
        RAISE EXCEPTION 'S13: results_request sent';
    END IF;
    RAISE NOTICE 'ok: S13 stale results job skipped for an attendance-only match';
END $$;
SELECT set_config('request.jwt.claims', '', true);

-- S14: regression: finishing with teams still opens the results flow.
SELECT pg_temp.add_match('m_teams_fin', 'lunes', 'signup_closed', now() - interval '2 hours', 4);
SELECT pg_temp.add_signup('m_teams_fin', 'agus', 'confirmed');
SELECT pg_temp.add_signup('m_teams_fin', 'diego', 'confirmed');
INSERT INTO public.teams (match_id, name, color_hex) VALUES
    (pg_temp.idof('m_teams_fin'), 'dark', '#1C1C1E'), (pg_temp.idof('m_teams_fin'), 'light', '#F3F0E6');
INSERT INTO public.team_assignments (team_id, player_id, position, order_index)
SELECT t.id, pg_temp.idof(CASE t.name WHEN 'dark' THEN 'agus' ELSE 'diego' END), 'ST', 0
FROM public.teams t WHERE t.match_id = pg_temp.idof('m_teams_fin');
UPDATE public.matches SET status = 'teams_created' WHERE id = pg_temp.idof('m_teams_fin');

SELECT set_config('request.jwt.claims', pg_temp.claims('juan'), true);
SET LOCAL role authenticated;
SELECT (public.admin_set_match_status(pg_temp.idof('m_teams_fin'), 'finished')).status;
RESET role;
SELECT set_config('request.jwt.claims', '', true);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.scheduled_jobs WHERE match_id = pg_temp.idof('m_teams_fin')
                   AND job_type = 'results_request' AND status = 'pending') THEN
        RAISE EXCEPTION 'S14: results_request not scheduled for a match with teams';
    END IF;
    IF (SELECT results_finalized FROM public.matches WHERE id = pg_temp.idof('m_teams_fin')) THEN
        RAISE EXCEPTION 'S14: a match with teams must wait for its result';
    END IF;
    RAISE NOTICE 'ok: S14 finish with teams keeps the results flow';
END $$;

-- ============================================
-- OD-8: self-signup guests and the priority policy
-- ============================================

-- S15: priority window: the guest waits and gets in when the window closes.
UPDATE public.groups
SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{member_scoring}',
    '{"enabled": true, "priority": {"mode": "window", "threshold": 3.0, "window_hours": 24}}'::jsonb)
WHERE id = pg_temp.idof('jueves');
SELECT pg_temp.add_match('m_guest_w', 'jueves', 'signup_open', now() + interval '3 days', 6);
SELECT pg_temp.add_signup('m_guest_w', 'agus', 'confirmed');
SELECT pg_temp.add_signup('m_guest_w', 'facu', 'confirmed');

SELECT set_config('request.jwt.claims', pg_temp.claims('anon'), true);
SET LOCAL role anon;
DO $$
DECLARE r JSONB;
BEGIN
    r := public.public_guest_signup(pg_temp.idof('m_guest_w'), 'Invitado W', pg_temp.idof('tok_w'));
    IF r->>'status' <> 'waitlist' OR r->>'waitlist_reason' <> 'priority_window' THEN
        RAISE EXCEPTION 'S15: guest signup %', r;
    END IF;
END $$;
RESET role;
SELECT set_config('request.jwt.claims', '', true);

DO $$
DECLARE h JSONB;
BEGIN
    h := public.guest_priority_hold(pg_temp.idof('m_guest_w'));
    IF h->>'reason' <> 'priority_window' OR NOT (h->>'holds')::boolean THEN RAISE EXCEPTION 'S15: hold %', h; END IF;
END $$;

-- A member signing up meanwhile is not held (newcomer, no score).
SELECT set_config('request.jwt.claims', pg_temp.claims('fede'), true);
SET LOCAL role authenticated;
SELECT (public.signup_for_match(pg_temp.idof('m_guest_w'))).status;
RESET role;
SELECT set_config('request.jwt.claims', '', true);

UPDATE public.matches SET signup_opened_at = now() - interval '25 hours' WHERE id = pg_temp.idof('m_guest_w');
SELECT public.run_priority_window_close_job(pg_temp.idof('m_guest_w'));
DO $$
BEGIN
    IF (SELECT s.status FROM public.match_signups s JOIN public.guest_players g ON g.id = s.guest_player_id
        WHERE s.match_id = pg_temp.idof('m_guest_w') AND g.self_signup_token = pg_temp.idof('tok_w')) <> 'confirmed' THEN
        RAISE EXCEPTION 'S15: the guest was not promoted at window close';
    END IF;
    IF public.guest_priority_hold(pg_temp.idof('m_guest_w')) IS NOT NULL THEN
        RAISE EXCEPTION 'S15: hold after the window';
    END IF;
    RAISE NOTICE 'ok: S15 guest waits during the priority window and is promoted at its close';
END $$;

-- S16: reserved spots: the guest waits once only the reserved spots are left.
UPDATE public.groups
SET settings = jsonb_set(settings, '{member_scoring}',
    '{"enabled": true, "priority": {"mode": "reserved", "threshold": 3.0, "window_hours": 24, "reserved_spots": 2}}'::jsonb)
WHERE id = pg_temp.idof('jueves');
SELECT pg_temp.add_match('m_guest_r', 'jueves', 'signup_open', now() + interval '3 days', 6);
SELECT pg_temp.add_signup('m_guest_r', 'agus', 'confirmed');
SELECT pg_temp.add_signup('m_guest_r', 'facu', 'confirmed');
SELECT pg_temp.add_signup('m_guest_r', 'fede', 'confirmed');
SELECT pg_temp.add_signup('m_guest_r', 'gonza', 'confirmed');

SELECT set_config('request.jwt.claims', pg_temp.claims('anon'), true);
SET LOCAL role anon;
DO $$
DECLARE r JSONB;
BEGIN
    r := public.public_guest_signup(pg_temp.idof('m_guest_r'), 'Invitado R1', pg_temp.idof('tok_r1'));
    IF r->>'status' <> 'waitlist' OR r->>'waitlist_reason' <> 'reserved' THEN RAISE EXCEPTION 'S16: guest 1 %', r; END IF;
END $$;
RESET role;
SELECT set_config('request.jwt.claims', '', true);

-- A confirmed member is removed: 3 confirmed < 6 - 2, the reserved hold is off,
-- the guest is promoted.
SELECT set_config('request.jwt.claims', pg_temp.claims('nico'), true);
SET LOCAL role authenticated;
SELECT public.admin_remove_signup(pg_temp.signup_id('m_guest_r', 'gonza'));
RESET role;
SELECT set_config('request.jwt.claims', '', true);

SELECT set_config('request.jwt.claims', pg_temp.claims('anon'), true);
SET LOCAL role anon;
DO $$
DECLARE r JSONB;
BEGIN
    r := public.public_guest_signup(pg_temp.idof('m_guest_r'), 'Invitado R2', pg_temp.idof('tok_r2'));
    IF r->>'status' <> 'waitlist' OR r->>'waitlist_reason' <> 'reserved' THEN RAISE EXCEPTION 'S16: guest 2 %', r; END IF;
END $$;
RESET role;
SELECT set_config('request.jwt.claims', '', true);

DO $$
BEGIN
    IF (SELECT s.status FROM public.match_signups s JOIN public.guest_players g ON g.id = s.guest_player_id
        WHERE s.match_id = pg_temp.idof('m_guest_r') AND g.self_signup_token = pg_temp.idof('tok_r1')) <> 'confirmed' THEN
        RAISE EXCEPTION 'S16: guest 1 not promoted once a regular spot freed up';
    END IF;
    RAISE NOTICE 'ok: S16 reserved spots hold guests and release them';
END $$;

-- S17: no policy: the guest is confirmed; a full match records reason 'full'.
UPDATE public.groups SET settings = settings - 'member_scoring' WHERE id = pg_temp.idof('jueves');
SELECT pg_temp.add_match('m_guest_off', 'jueves', 'signup_open', now() + interval '3 days', 3);
SELECT pg_temp.add_signup('m_guest_off', 'agus', 'confirmed');
SELECT pg_temp.add_signup('m_guest_off', 'facu', 'confirmed');

SELECT set_config('request.jwt.claims', pg_temp.claims('anon'), true);
SET LOCAL role anon;
DO $$
DECLARE r JSONB;
BEGIN
    r := public.public_guest_signup(pg_temp.idof('m_guest_off'), 'Invitado Off', pg_temp.idof('tok_off'));
    IF r->>'status' <> 'confirmed' OR r->>'waitlist_reason' IS NOT NULL THEN RAISE EXCEPTION 'S17: %', r; END IF;
    r := public.public_guest_signup(pg_temp.idof('m_guest_off'), 'Invitado Full', pg_temp.idof('tok_full'));
    IF r->>'status' <> 'waitlist' OR r->>'waitlist_reason' <> 'full' THEN RAISE EXCEPTION 'S17 full: %', r; END IF;
    RAISE NOTICE 'ok: S17 no policy: guest confirmed, full match waitlists with reason full';
END $$;
RESET role;
SELECT set_config('request.jwt.claims', '', true);
