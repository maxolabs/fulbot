-- fulbot demo seed (local development only).
-- Rebuilds a realistic dataset: 20 users, two groups, five finished Monday matches
-- with results/votes/badges, an open match, a full match with a waitlist, a draft,
-- rules, guests and notifications. Run with psql as postgres against a local stack
-- AFTER all migrations are applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
-- Every account's password is: password123
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
-- Dates are relative to today: the "next Monday" anchors the open match, the five
-- finished matches are the Mondays before it.
SELECT (current_date + (CASE WHEN (8 - extract(dow FROM current_date)::int) % 7 = 0 THEN 7 ELSE (8 - extract(dow FROM current_date)::int) % 7 END))::text AS next_monday \gset
\pset tuples_only off
\pset format aligned

BEGIN;

-- ---------------------------------------------------------------- clean slate
DELETE FROM public.scheduled_jobs;
DELETE FROM public.match_report_stats;
DELETE FROM public.match_reports;
DELETE FROM public.notification_reads;
DELETE FROM public.peer_ratings;
DELETE FROM public.notification_outbox;
DELETE FROM public.notifications;
DELETE FROM public.player_badges;
DELETE FROM public.match_events;
DELETE FROM public.match_ratings;
DELETE FROM public.match_mvp_votes;
DELETE FROM public.team_assignments;
DELETE FROM public.teams;
DELETE FROM public.match_signups;
DELETE FROM public.rule_sets;
DELETE FROM public.matches;
DELETE FROM public.recurring_patterns;
DELETE FROM public.guest_players;
DELETE FROM public.group_memberships;
DELETE FROM public.groups;
DELETE FROM auth.users;
DELETE FROM public.player_profiles;

-- ---------------------------------------------------------------- users
-- The auth trigger creates public.users and player_profiles from raw_user_meta_data.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, created_at, updated_at, confirmation_token,
    recovery_token, email_change_token_new, email_change, is_sso_user)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    e, crypt('password123', gen_salt('bf')), now(), jsonb_build_object('name', n),
    '{"provider":"email","providers":["email"]}', now() - interval '120 days', now(), '', '', '', '', false
FROM (VALUES
    ('maxo@test.local',   'Maxo'),
    ('juan@test.local',   'Juan Pérez'),
    ('pedro@test.local',  'Pedro Gómez'),
    ('nico@test.local',   'Nicolás Ruiz'),
    ('fede@test.local',   'Federico Sosa'),
    ('tomi@test.local',   'Tomás Díaz'),
    ('santi@test.local',  'Santiago López'),
    ('lucho@test.local',  'Luciano Torres'),
    ('mati@test.local',   'Matías Romero'),
    ('gonza@test.local',  'Gonzalo Álvarez'),
    ('nacho@test.local',  'Ignacio Castro'),
    ('franco@test.local', 'Franco Benítez'),
    ('agus@test.local',   'Agustín Molina'),
    ('rodri@test.local',  'Rodrigo Silva'),
    ('seba@test.local',   'Sebastián Acosta'),
    ('martin@test.local', 'Martín Herrera'),
    ('diego@test.local',  'Diego Medina'),
    ('pablo@test.local',  'Pablo Ríos'),
    ('facu@test.local',   'Facundo Vega'),
    ('luis@test.local',   'Luis Ortiz')
) AS t(e, n);

-- Player attributes: (email, nickname, main, preferred[], foot, gk 0-3, fitness, rating).
-- `rating` is the seed's idea of the player's level; it feeds the peer ratings below
-- (player_profiles no longer carries an overall_rating column).
CREATE TEMP TABLE seed_attrs AS
SELECT * FROM (VALUES
    ('maxo@test.local',   'Maxo',    'CM',  ARRAY['CM','CDM','CB'],  'right', 1, 'ok',      3.60),
    ('juan@test.local',   'Juampi',  'ST',  ARRAY['ST','LW','CAM'],  'left',  0, 'ok',      4.30),
    ('pedro@test.local',  'Pedrito', 'GK',  ARRAY['GK','CB'],        'right', 3, 'ok',      3.80),
    ('nico@test.local',   'Nico',    'CB',  ARRAY['CB','CDM'],       'right', 1, 'ok',      3.50),
    ('fede@test.local',   'Fede',    'CAM', ARRAY['CAM','CM','ST'],  'both',  0, 'ok',      4.60),
    ('tomi@test.local',   'Tomi',    'RW',  ARRAY['RW','RM','ST'],   'right', 0, 'limited', 3.20),
    ('santi@test.local',  'Santi',   'GK',  ARRAY['GK'],             'left',  3, 'ok',      3.40),
    ('lucho@test.local',  'Lucho',   'LB',  ARRAY['LB','LM','CB'],   'left',  0, 'ok',      3.00),
    ('mati@test.local',   'Mati',    'CDM', ARRAY['CDM','CB','CM'],  'right', 2, 'ok',      3.90),
    ('gonza@test.local',  'Gonza',   'ST',  ARRAY['ST','CF'],        'right', 0, 'ok',      4.10),
    ('nacho@test.local',  'Nacho',   'CM',  ARRAY['CM','CAM','LM'],  'right', 1, 'ok',      2.80),
    ('franco@test.local', 'Franquito','RB', ARRAY['RB','RM','CB'],   'right', 0, 'ok',      3.30),
    ('agus@test.local',   'Agus',    'LW',  ARRAY['LW','LM','ST'],   'left',  0, 'ok',      3.70),
    ('rodri@test.local',  'Rodri',   'CB',  ARRAY['CB','GK','CDM'],  'right', 2, 'ok',      3.10),
    ('seba@test.local',   'Seba',    'CM',  ARRAY['CM','RM'],        'both',  1, 'injured', 3.50),
    ('martin@test.local', 'Tincho',  'RM',  ARRAY['RM','RW','CM'],   'right', 0, 'ok',      2.60),
    ('diego@test.local',  'Dieguito','CF',  ARRAY['CF','ST','CAM'],  'left',  0, 'ok',      4.80),
    ('pablo@test.local',  'Pablito', 'CB',  ARRAY['CB','LB'],        'right', 1, 'ok',      3.00),
    ('facu@test.local',   'Facu',    'ST',  ARRAY['ST','RW'],        'right', 0, 'ok',      3.40),
    ('luis@test.local',   'Luis',    'CM',  ARRAY['CM'],             'right', 0, 'ok',      3.00)
) AS a(email, nick, main, prefs, foot, gk, fit, rating);

UPDATE public.player_profiles pp SET
    nickname = a.nick,
    main_position = a.main,
    preferred_positions = a.prefs,
    footedness = a.foot::footedness,
    goalkeeper_willingness = a.gk,
    fitness_status = a.fit::fitness_status
FROM seed_attrs a
JOIN public.users u ON u.email = a.email
WHERE pp.user_id = u.id;

-- ---------------------------------------------------------------- groups
INSERT INTO public.groups (id, name, slug, description, default_match_day, default_match_time,
    default_max_players, timezone, created_by_user_id, invite_code)
VALUES
    ('11111111-1111-4111-8111-111111111111', 'Fútbol lunes', 'futbol-lunes',
     'Fútbol 7 todos los lunes a las 21 en el club', 1, '21:00', 14,
     'America/Argentina/Buenos_Aires', (SELECT id FROM public.users WHERE email='maxo@test.local'), 'lunes2026'),
    ('22222222-2222-4222-8222-222222222222', 'Fútbol jueves', 'futbol-jueves',
     'El de los jueves, más tranqui', 4, '20:00', 10,
     'America/Argentina/Buenos_Aires', (SELECT id FROM public.users WHERE email='nico@test.local'), 'jueves2026');

INSERT INTO public.notification_settings (group_id) VALUES
    ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');

-- Lunes: everyone except Facu, Pablo and Luis. Maxo admin, Juan captain.
INSERT INTO public.group_memberships (group_id, player_id, role, joined_at)
SELECT '11111111-1111-4111-8111-111111111111', pp.id,
    CASE u.email WHEN 'maxo@test.local' THEN 'admin' WHEN 'juan@test.local' THEN 'captain' ELSE 'member' END::group_role,
    now() - interval '100 days'
FROM public.player_profiles pp JOIN public.users u ON u.id = pp.user_id
WHERE u.email NOT IN ('facu@test.local', 'pablo@test.local', 'luis@test.local');

-- Jueves: Nico admin, Maxo captain, plus a handful.
INSERT INTO public.group_memberships (group_id, player_id, role, joined_at)
SELECT '22222222-2222-4222-8222-222222222222', pp.id,
    CASE u.email WHEN 'nico@test.local' THEN 'admin' WHEN 'maxo@test.local' THEN 'captain' ELSE 'member' END::group_role,
    now() - interval '40 days'
FROM public.player_profiles pp JOIN public.users u ON u.id = pp.user_id
WHERE u.email IN ('nico@test.local','maxo@test.local','facu@test.local','pablo@test.local','fede@test.local',
                  'gonza@test.local','tomi@test.local','santi@test.local','mati@test.local','agus@test.local');

-- ---------------------------------------------------------------- peer ratings (initial scoring)
-- The membership inserts above fired the rate_new_member trigger; a seeded group is not
-- "everyone just joined", so drop those.
DELETE FROM public.notifications WHERE type = 'rate_new_member';

-- Per-dimension 1-5 values derived from the seed rating and the main position.
CREATE TEMP TABLE seed_dims AS
SELECT u.id AS user_id, pp.id AS player_id,
    LEAST(5, GREATEST(1, ROUND(CASE WHEN a.main = 'GK' THEN a.rating + 0.6 ELSE 1 + a.gk END)))::smallint AS gk,
    LEAST(5, GREATEST(1, ROUND(a.rating + CASE WHEN a.main IN ('CB','LB','RB','CDM') THEN 0.5
                                              WHEN a.main IN ('ST','CF','LW','RW','CAM') THEN -0.6
                                              WHEN a.main = 'GK' THEN -0.4 ELSE 0 END)))::smallint AS def,
    LEAST(5, GREATEST(1, ROUND(a.rating + CASE WHEN a.main IN ('ST','CF','LW','RW','CAM') THEN 0.5
                                              WHEN a.main IN ('CB','LB','RB','CDM') THEN -0.6
                                              WHEN a.main = 'GK' THEN -1.4 ELSE 0 END)))::smallint AS att,
    LEAST(5, GREATEST(1, ROUND(a.rating + CASE a.fit WHEN 'limited' THEN -0.8 WHEN 'injured' THEN -1.2 ELSE 0 END)))::smallint AS phy,
    CASE WHEN a.main = 'GK' THEN ARRAY['can_keep']
         WHEN a.main IN ('ST','CF') THEN ARRAY['scorer']
         WHEN a.main IN ('CB','CDM') THEN ARRAY['marks_well']
         WHEN a.main IN ('LW','RW','RM','LM') THEN ARRAY['fast']
         ELSE ARRAY['good_passer'] END AS tags
FROM seed_attrs a
JOIN public.users u ON u.email = a.email
JOIN public.player_profiles pp ON pp.user_id = u.id;

-- Admin baseline for every other member of each group.
INSERT INTO public.peer_ratings (group_id, voter_player_id, rated_player_id, goalkeeping, defense, attack, physical, tags, is_baseline)
SELECT gm.group_id, adm.player_id, gm.player_id, d.gk, d.def, d.att, d.phy, d.tags, TRUE
FROM public.group_memberships gm
JOIN public.group_memberships adm ON adm.group_id = gm.group_id AND adm.role = 'admin'
JOIN seed_dims d ON d.player_id = gm.player_id
WHERE gm.player_id <> adm.player_id;

-- Peer votes: roughly 60% of the remaining pairs vote (jittered -1..+1 per dimension),
-- the rest skip, and a few pairs are left pending so the group page shows the queue.
INSERT INTO public.peer_ratings (group_id, voter_player_id, rated_player_id, skipped, goalkeeping, defense, attack, physical, tags)
SELECT v.group_id, v.player_id, r.player_id,
    (x.h % 10) BETWEEN 6 AND 8,
    CASE WHEN (x.h % 10) BETWEEN 6 AND 8 THEN NULL ELSE LEAST(5, GREATEST(1, d.gk  + ((x.h / 3)  % 3) - 1)) END,
    CASE WHEN (x.h % 10) BETWEEN 6 AND 8 THEN NULL ELSE LEAST(5, GREATEST(1, d.def + ((x.h / 9)  % 3) - 1)) END,
    CASE WHEN (x.h % 10) BETWEEN 6 AND 8 THEN NULL ELSE LEAST(5, GREATEST(1, d.att + ((x.h / 27) % 3) - 1)) END,
    CASE WHEN (x.h % 10) BETWEEN 6 AND 8 THEN NULL ELSE LEAST(5, GREATEST(1, d.phy + ((x.h / 81) % 3) - 1)) END,
    CASE WHEN (x.h % 10) BETWEEN 6 AND 8 THEN '{}'::text[]
         ELSE d.tags || CASE (x.h / 243) % 4 WHEN 0 THEN ARRAY['hard_worker'] WHEN 1 THEN ARRAY['stamina'] ELSE '{}'::text[] END END
FROM public.group_memberships v
JOIN public.group_memberships r ON r.group_id = v.group_id AND r.player_id <> v.player_id
JOIN seed_dims d ON d.player_id = r.player_id
CROSS JOIN LATERAL (SELECT abs(hashtext(v.player_id::text || r.player_id::text || v.group_id::text)) AS h) x
WHERE v.role <> 'admin'
  AND (x.h % 10) <= 8;

-- ---------------------------------------------------------------- recurring patterns
INSERT INTO public.recurring_patterns (id, group_id, weekday, match_time, location, max_players,
    signup_opens_weekday, signup_opens_time, timezone, is_active, created_by_user_id)
VALUES
    ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 1, '21:00',
     'Club Ferro, cancha 3', 14, 0, '12:00', 'America/Argentina/Buenos_Aires', true,
     (SELECT id FROM public.users WHERE email='maxo@test.local')),
    ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 4, '20:00',
     'Complejo La Bombonerita', 10, 3, '12:00', 'America/Argentina/Buenos_Aires', true,
     (SELECT id FROM public.users WHERE email='nico@test.local'));

-- ---------------------------------------------------------------- rules
INSERT INTO public.rule_sets (group_id, rule_type, data, created_by_user_id)
VALUES
    ('11111111-1111-4111-8111-111111111111', 'avoid_pair',
     jsonb_build_object('player_ids', ARRAY[(SELECT id FROM public.player_profiles WHERE nickname='Fede'),
                                            (SELECT id FROM public.player_profiles WHERE nickname='Dieguito')]::text[]),
     (SELECT id FROM public.users WHERE email='maxo@test.local')),
    ('11111111-1111-4111-8111-111111111111', 'min_goalkeepers', '{"min_count": 1}',
     (SELECT id FROM public.users WHERE email='maxo@test.local'));

-- ---------------------------------------------------------------- guests
INSERT INTO public.guest_players (id, display_name, notes, estimated_rating, preferred_positions, group_id, created_by_user_id)
VALUES
    ('55555555-5555-4555-8555-555555555551', 'Primo de Juan', 'Juega bien, delantero', 3.50, ARRAY['ST'],
     '11111111-1111-4111-8111-111111111111', (SELECT id FROM public.users WHERE email='maxo@test.local')),
    ('55555555-5555-4555-8555-555555555552', 'Colo (amigo de Fede)', 'Defensor, atajó una vez', 3.00, ARRAY['CB','GK'],
     '11111111-1111-4111-8111-111111111111', (SELECT id FROM public.users WHERE email='maxo@test.local'));

COMMIT;

-- ---------------------------------------------------------------- five finished Monday matches
-- Built oldest to newest so badges (ironman) and MVP counts accumulate correctly.
DO $$
DECLARE
    v_group UUID := '11111111-1111-4111-8111-111111111111';
    v_tz TEXT := 'America/Argentina/Buenos_Aires';
    v_next_monday DATE := current_date + (CASE WHEN (8 - extract(dow FROM current_date)::int) % 7 = 0 THEN 7 ELSE (8 - extract(dow FROM current_date)::int) % 7 END);
    v_dates DATE[];
    v_k INT;
    v_match UUID;
    v_dark UUID;
    v_light UUID;
    v_when TIMESTAMPTZ;
    r RECORD;
    v_n INT;
    v_goals INT;
    v_i INT;
    v_scorer UUID;
    v_assister UUID;
    v_goal_id UUID;
    v_team UUID;
    v_voter UUID;
    v_cand UUID;
BEGIN
    v_dates := ARRAY[v_next_monday - 35, v_next_monday - 28, v_next_monday - 21, v_next_monday - 14, v_next_monday - 7];
    FOR v_k IN 1..array_length(v_dates, 1) LOOP
        v_when := (v_dates[v_k]::text || ' 21:00')::timestamp AT TIME ZONE v_tz;

        INSERT INTO public.matches (group_id, date_time, location, status, max_players, recurring_pattern_id, created_at, finished_at)
        VALUES (v_group, v_when, 'Club Ferro, cancha 3', 'finished', 14, '33333333-3333-4333-8333-333333333333', v_when - interval '2 days', v_when + interval '60 minutes')
        RETURNING id INTO v_match;

        -- 14 confirmed players, chosen by a per-match shuffle so lineups rotate. Fede and
        -- Dieguito are always there (they are the top scorers); Seba (injured) never plays.
        INSERT INTO public.match_signups (match_id, player_id, status, signup_time)
        SELECT v_match, pp.id, 'confirmed', v_when - interval '2 days' + (rn || ' minutes')::interval
        FROM (
            SELECT pp.id, row_number() OVER (ORDER BY
                CASE WHEN pp.nickname IN ('Fede','Dieguito','Pedrito','Santi') THEN 0 ELSE 1 END,
                md5(v_k::text || pp.id::text)) AS rn
            FROM public.player_profiles pp
            JOIN public.group_memberships gm ON gm.player_id = pp.id AND gm.group_id = v_group
            WHERE pp.nickname <> 'Seba'
        ) pp
        WHERE rn <= 14;

        -- Two late cancellations and one no-show across the history, for reliability.
        IF v_k = 2 THEN
            INSERT INTO public.match_signups (match_id, player_id, status, signup_time, cancel_time)
            SELECT v_match, id, 'cancelled', v_when - interval '2 days', v_when - interval '3 hours'
            FROM public.player_profiles WHERE nickname = 'Tincho'
            ON CONFLICT ON CONSTRAINT unique_player_signup DO UPDATE SET status = 'cancelled', cancel_time = EXCLUDED.cancel_time;
        END IF;
        IF v_k = 4 THEN
            UPDATE public.match_signups SET status = 'did_not_show'
            WHERE match_id = v_match AND player_id = (SELECT id FROM public.player_profiles WHERE nickname = 'Nacho');
        END IF;

        INSERT INTO public.teams (match_id, name, color_hex) VALUES (v_match, 'dark', '#1a1a1a') RETURNING id INTO v_dark;
        INSERT INTO public.teams (match_id, name, color_hex) VALUES (v_match, 'light', '#ffffff') RETURNING id INTO v_light;

        -- Split the confirmed players 7/7 with a goalkeeper on each side.
        v_n := 0;
        FOR r IN
            SELECT ms.player_id, pp.main_position, pp.goalkeeper_willingness,
                   row_number() OVER (ORDER BY pp.goalkeeper_willingness DESC, md5(v_k::text || 'team' || pp.id::text)) AS rn
            FROM public.match_signups ms
            JOIN public.player_profiles pp ON pp.id = ms.player_id
            WHERE ms.match_id = v_match AND ms.status IN ('confirmed', 'did_not_show')
        LOOP
            -- rn 1 and 2 are the two most willing keepers, one per team; the rest alternate.
            v_team := CASE WHEN r.rn % 2 = 1 THEN v_dark ELSE v_light END;
            INSERT INTO public.team_assignments (team_id, player_id, position, order_index, source)
            VALUES (v_team, r.player_id,
                    CASE WHEN r.rn <= 2 THEN 'GK' WHEN r.main_position = 'GK' THEN 'CB' ELSE r.main_position END,
                    (r.rn - 1) / 2, 'ai');
        END LOOP;

        -- Goals: dark scores (k mod 4) + 1, light scores (k*3 mod 5).
        FOR v_i IN 1..2 LOOP
            v_team := CASE WHEN v_i = 1 THEN v_dark ELSE v_light END;
            v_goals := CASE WHEN v_i = 1 THEN (v_k % 4) + 1 ELSE (v_k * 3) % 5 END;
            FOR v_n IN 1..v_goals LOOP
                -- attackers score more: prefer ST/CF/LW/RW/CAM
                SELECT ta.player_id INTO v_scorer
                FROM public.team_assignments ta JOIN public.player_profiles pp ON pp.id = ta.player_id
                WHERE ta.team_id = v_team AND ta.position <> 'GK'
                ORDER BY CASE WHEN ta.position IN ('ST','CF','LW','RW','CAM') THEN 0 ELSE 1 END,
                         md5(v_k::text || v_team::text || v_n::text)
                LIMIT 1;
                SELECT ta.player_id INTO v_assister
                FROM public.team_assignments ta
                WHERE ta.team_id = v_team AND ta.player_id <> v_scorer AND ta.position <> 'GK'
                ORDER BY md5(v_k::text || v_team::text || v_n::text || 'a')
                LIMIT 1;
                INSERT INTO public.match_events (match_id, team_id, player_id, event_type, minute)
                VALUES (v_match, v_team, v_scorer, 'goal', 5 + (v_n * 13 + v_k * 7) % 55)
                RETURNING id INTO v_goal_id;
                IF v_n % 2 = 1 THEN
                    INSERT INTO public.match_events (match_id, team_id, player_id, event_type, linked_event_id)
                    VALUES (v_match, v_team, v_assister, 'assist', v_goal_id);
                END IF;
            END LOOP;
        END LOOP;

        -- Scores come from the goal list (admin-entered results are authoritative).
        UPDATE public.teams t
        SET score = (SELECT count(*) FROM public.match_events me WHERE me.match_id = v_match AND me.team_id = t.id AND me.event_type = 'goal')
        WHERE t.match_id = v_match;

        -- MVP votes: most players vote for the top scorer of the match, a few vote elsewhere.
        SELECT me.player_id INTO v_cand
        FROM public.match_events me WHERE me.match_id = v_match AND me.event_type = 'goal'
        GROUP BY me.player_id ORDER BY count(*) DESC, min(me.created_at) LIMIT 1;
        v_n := 0;
        FOR r IN SELECT ms.player_id FROM public.match_signups ms WHERE ms.match_id = v_match AND ms.status = 'confirmed' ORDER BY md5(v_k::text || ms.player_id::text) LOOP
            v_n := v_n + 1;
            IF v_n <= 10 THEN
                v_voter := r.player_id;
                IF v_voter = v_cand THEN
                    SELECT ta.player_id INTO v_cand FROM public.team_assignments ta JOIN public.teams t ON t.id = ta.team_id
                    WHERE t.match_id = v_match AND ta.player_id <> v_voter ORDER BY md5(v_k::text || 'alt') LIMIT 1;
                END IF;
                INSERT INTO public.match_mvp_votes (match_id, voter_player_id, candidate_player_id, created_at)
                VALUES (v_match, v_voter, v_cand, v_when + interval '3 hours' + (v_n || ' minutes')::interval)
                ON CONFLICT DO NOTHING;
            END IF;
        END LOOP;

        -- Lock the result as if the admin had loaded it, drop the results-request
        -- jobs the insert trigger scheduled, then stats/badges.
        UPDATE public.matches SET result_status = 'locked', result_locked_at = v_when + interval '2 hours' WHERE id = v_match;
        PERFORM schedule_match_jobs(v_match);
        PERFORM finalize_match_results(v_match);

        -- A few 1-5 ratings so overall_rating moves.
        INSERT INTO public.match_ratings (match_id, voter_player_id, rated_player_id, rating)
        SELECT v_match, a.player_id, b.player_id, 3 + ((abs(hashtext(a.player_id::text || b.player_id::text)) % 3))
        FROM public.match_signups a JOIN public.match_signups b ON b.match_id = a.match_id AND b.player_id <> a.player_id
        WHERE a.match_id = v_match AND a.status = 'confirmed' AND b.status = 'confirmed'
          AND abs(hashtext(a.player_id::text || b.player_id::text || v_k::text)) % 5 = 0
        ON CONFLICT DO NOTHING;

    END LOOP;

    PERFORM recompute_player_stats(pp.id) FROM public.player_profiles pp;
END $$;

-- ---------------------------------------------------------------- upcoming matches
BEGIN;

-- Next Monday (relative to today): full, 14 confirmed (12 members + two guests) and two on the waitlist,
-- ready for team generation and waitlist promotion.
INSERT INTO public.matches (id, group_id, date_time, location, status, max_players, recurring_pattern_id, notes)
VALUES ('66666666-6666-4666-8666-666666666661', '11111111-1111-4111-8111-111111111111',
        ((:'next_monday' || ' 21:00')::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'),
        'Club Ferro, cancha 3', 'full', 14, '33333333-3333-4333-8333-333333333333',
        'Traer pechera. Se paga en la cancha.');

INSERT INTO public.match_signups (match_id, player_id, status, signup_time, waitlist_position)
SELECT '66666666-6666-4666-8666-666666666661', pp.id,
       CASE WHEN rn <= 12 THEN 'confirmed' ELSE 'waitlist' END::signup_status,
       now() - interval '20 hours' + (rn || ' minutes')::interval,
       CASE WHEN rn > 12 THEN rn - 12 ELSE NULL END
FROM (
    SELECT pp.id, row_number() OVER (ORDER BY
        CASE WHEN pp.nickname IN ('Pedrito','Santi','Fede','Dieguito') THEN 0 ELSE 1 END,
        md5('open' || pp.id::text)) AS rn
    FROM public.player_profiles pp JOIN public.group_memberships gm ON gm.player_id = pp.id
    WHERE gm.group_id = '11111111-1111-4111-8111-111111111111' AND pp.nickname NOT IN ('Seba', 'Maxo')
) pp WHERE rn <= 14;
INSERT INTO public.match_signups (match_id, guest_player_id, status, signup_time, notes)
VALUES ('66666666-6666-4666-8666-666666666661', '55555555-5555-4555-8555-555555555551', 'confirmed', now() - interval '19 hours 50 minutes', 'Viene con Juan'),
       ('66666666-6666-4666-8666-666666666661', '55555555-5555-4555-8555-555555555552', 'confirmed', now() - interval '19 hours 45 minutes', NULL);

-- Match-level rule for the open match: keep the two keepers apart.
INSERT INTO public.rule_sets (match_id, rule_type, data, created_by_user_id)
VALUES ('66666666-6666-4666-8666-666666666661', 'avoid_pair',
        jsonb_build_object('player_ids', ARRAY[(SELECT id FROM public.player_profiles WHERE nickname='Pedrito'),
                                               (SELECT id FROM public.player_profiles WHERE nickname='Santi')]::text[]),
        (SELECT id FROM public.users WHERE email='maxo@test.local'));

-- Wednesday friendly: full, with a waitlist of three, to test promotion on cancel/removal.
INSERT INTO public.matches (id, group_id, date_time, location, status, max_players, notes)
VALUES ('66666666-6666-4666-8666-666666666662', '11111111-1111-4111-8111-111111111111',
        (((:'next_monday'::date + 2)::text || ' 20:00')::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'),
        'Club Ferro, cancha 1', 'full', 10, 'Amistoso extra, 5 vs 5');
INSERT INTO public.match_signups (match_id, player_id, status, signup_time, waitlist_position)
SELECT '66666666-6666-4666-8666-666666666662', pp.id,
       CASE WHEN rn <= 10 THEN 'confirmed' ELSE 'waitlist' END::signup_status,
       now() - interval '30 hours' + (rn || ' minutes')::interval,
       CASE WHEN rn > 10 THEN rn - 10 ELSE NULL END
FROM (
    SELECT pp.id, row_number() OVER (ORDER BY md5('full' || pp.id::text)) AS rn
    FROM public.player_profiles pp JOIN public.group_memberships gm ON gm.player_id = pp.id
    WHERE gm.group_id = '11111111-1111-4111-8111-111111111111' AND pp.nickname NOT IN ('Seba', 'Maxo')
) pp WHERE rn <= 13;

-- Draft two Mondays ahead.
INSERT INTO public.matches (group_id, date_time, location, status, max_players, notes)
VALUES ('11111111-1111-4111-8111-111111111111',
        (((:'next_monday'::date + 7)::text || ' 21:00')::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'),
        'Club Ferro, cancha 3', 'draft', 14, 'Todavía no confirmamos la cancha');

-- Jueves group: an open match this week.
INSERT INTO public.matches (id, group_id, date_time, location, status, max_players, recurring_pattern_id)
VALUES ('66666666-6666-4666-8666-666666666663', '22222222-2222-4222-8222-222222222222',
        (((:'next_monday'::date + 3)::text || ' 20:00')::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'),
        'Complejo La Bombonerita', 'signup_open', 10, '44444444-4444-4444-8444-444444444444');
INSERT INTO public.match_signups (match_id, player_id, status, signup_time)
SELECT '66666666-6666-4666-8666-666666666663', pp.id, 'confirmed', now() - interval '5 hours'
FROM public.player_profiles pp JOIN public.group_memberships gm ON gm.player_id = pp.id
WHERE gm.group_id = '22222222-2222-4222-8222-222222222222' AND pp.nickname IN ('Nico','Facu','Pablito','Gonza','Tomi','Santi');

-- Lunes: a match that ended a while ago with teams but no result yet. Its
-- auto_finish job is already due, so the first /api/cron/tick finishes it and
-- schedules the results request. Maxo (admin) and Juan (captain) play in it.
INSERT INTO public.matches (id, group_id, date_time, location, status, max_players, notes, duration_minutes, results_request_delay_minutes)
VALUES ('66666666-6666-4666-8666-666666666664', '11111111-1111-4111-8111-111111111111',
        now() - interval '3 hours', 'Club Ferro, cancha 3', 'teams_created', 14,
        'Partido de prueba para el reporte de resultados', 60, 60);
INSERT INTO public.match_signups (match_id, player_id, status, signup_time)
SELECT '66666666-6666-4666-8666-666666666664', pp.id, 'confirmed', now() - interval '2 days' + (rn || ' minutes')::interval
FROM (
    SELECT pp.id, row_number() OVER (ORDER BY
        CASE WHEN u.email IN ('maxo@test.local','juan@test.local') OR pp.nickname IN ('Fede','Dieguito','Pedrito','Santi') THEN 0 ELSE 1 END,
        md5('past' || pp.id::text)) AS rn
    FROM public.player_profiles pp JOIN public.group_memberships gm ON gm.player_id = pp.id
    JOIN public.users u ON u.id = pp.user_id
    WHERE gm.group_id = '11111111-1111-4111-8111-111111111111' AND pp.nickname <> 'Seba'
) pp WHERE rn <= 14;
INSERT INTO public.teams (id, match_id, name, color_hex) VALUES
    ('77777777-7777-4777-8777-777777777771', '66666666-6666-4666-8666-666666666664', 'dark', '#1a1a1a'),
    ('77777777-7777-4777-8777-777777777772', '66666666-6666-4666-8666-666666666664', 'light', '#ffffff');
INSERT INTO public.team_assignments (team_id, player_id, position, order_index, source)
SELECT CASE WHEN rn % 2 = 1 THEN '77777777-7777-4777-8777-777777777771' ELSE '77777777-7777-4777-8777-777777777772' END::uuid,
       player_id,
       CASE WHEN rn <= 2 THEN 'GK' WHEN main_position = 'GK' THEN 'CB' ELSE main_position END,
       (rn - 1) / 2, 'ai'
FROM (
    SELECT ms.player_id, pp.main_position,
           row_number() OVER (ORDER BY pp.goalkeeper_willingness DESC, md5('pastteam' || pp.id::text)) AS rn
    FROM public.match_signups ms JOIN public.player_profiles pp ON pp.id = ms.player_id
    WHERE ms.match_id = '66666666-6666-4666-8666-666666666664' AND ms.status = 'confirmed'
) x;

-- ---------------------------------------------------------------- notifications
-- emit_notification requires a member or the service role; act as the service role.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT emit_notification('11111111-1111-4111-8111-111111111111', '66666666-6666-4666-8666-666666666661', 'match_created',
    jsonb_build_object('match_id', '66666666-6666-4666-8666-666666666661', 'group_name', 'Fútbol lunes',
        'date_time', ((:'next_monday' || ' 21:00')::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'),
        'location', 'Club Ferro, cancha 3', 'max_players', 14,
        'signup_url', 'http://localhost:3000/m/66666666-6666-4666-8666-666666666661'));
SELECT emit_notification('11111111-1111-4111-8111-111111111111', m.id, 'results_posted', build_results_posted_payload(m.id))
FROM (SELECT id FROM public.matches WHERE status='finished' ORDER BY date_time DESC LIMIT 1) m;

COMMIT;

-- ---------------------------------------------------------------- summary
\pset format unaligned
\pset tuples_only on
SELECT 'users: ' || count(*) FROM public.users;
SELECT 'groups: ' || string_agg(name || ' (' || (SELECT count(*) FROM public.group_memberships gm WHERE gm.group_id = g.id) || ' miembros)', ', ') FROM public.groups g;
SELECT 'matches: ' || string_agg(status || '=' || c, ', ') FROM (SELECT status, count(*) c FROM public.matches GROUP BY status ORDER BY status) s;
SELECT 'top scorers: ' || string_agg(nickname || ' ' || goals || 'g/' || assists || 'a', ', ' ORDER BY goals DESC) FROM (SELECT nickname, goals, assists FROM public.player_profiles ORDER BY goals DESC LIMIT 5) t;
SELECT 'mvps: ' || string_agg(nickname || ' x' || mvp_count, ', ') FROM public.player_profiles WHERE mvp_count > 0;
SELECT 'badges: ' || string_agg(badge_type || '=' || c, ', ') FROM (SELECT badge_type, count(*) c FROM public.player_badges GROUP BY badge_type) b;
SELECT 'reliability < 1: ' || string_agg(nickname || ' ' || reliability_score, ', ') FROM public.player_profiles WHERE reliability_score < 1;
SELECT 'notifications: ' || count(*) FROM public.notifications;
SELECT 'jobs: ' || string_agg(job_type || '/' || status || '=' || c, ', ') FROM (SELECT job_type, status, count(*) c FROM public.scheduled_jobs GROUP BY 1, 2 ORDER BY 1, 2) j;
