-- T1 membership-account scenarios (00033). No BEGIN/COMMIT: run inside a rolled-back
-- transaction together with the migration (docs/review/wrapup-2026-11-15.md):
--
--   { echo "BEGIN; SET LOCAL lock_timeout = '30s';"; \
--     cat supabase/migrations/00033_membership_account.sql supabase/tests/t1_membership_account.sql; \
--     echo "ROLLBACK;"; } | psql "$DB" -v ON_ERROR_STOP=1 -q
--
-- Every assertion raises on failure. Fixtures are created here with fixed ids
-- (t1-*@test.local) and never touch the seed.
--
-- Players: A admin, B member who leaves and rejoins, C member removed by A,
-- D on the waitlist, E member who deletes the account (and owns a solo group).

RESET role;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, created_at, updated_at, confirmation_token,
    recovery_token, email_change_token_new, email_change, is_sso_user)
SELECT id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    email, crypt('password123', gen_salt('bf')), now(), jsonb_build_object('name', name),
    '{"provider":"email","providers":["email"]}', now(), now(), '', '', '', '', false
FROM (VALUES
    ('a1000000-0000-4000-8000-0000000000a1', 't1-a@test.local', 'T1 Admin'),
    ('a1000000-0000-4000-8000-0000000000b1', 't1-b@test.local', 'T1 Bruno'),
    ('a1000000-0000-4000-8000-0000000000c1', 't1-c@test.local', 'T1 Carla'),
    ('a1000000-0000-4000-8000-0000000000d1', 't1-d@test.local', 'T1 Dani'),
    ('a1000000-0000-4000-8000-0000000000e1', 't1-e@test.local', 'T1 Ema')
) AS v(id, email, name);

CREATE TEMP TABLE t1_ctx (key TEXT PRIMARY KEY, val UUID, txt TEXT) ON COMMIT DROP;
GRANT ALL ON t1_ctx TO authenticated;

INSERT INTO t1_ctx
SELECT 'p_' || substr(u.email, 4, 1), pp.id
FROM auth.users u JOIN public.player_profiles pp ON pp.user_id = u.id
WHERE u.email LIKE 't1-_@test.local';

DO $$
BEGIN
    IF (SELECT count(*) FROM t1_ctx) <> 5 THEN
        RAISE EXCEPTION 'fixture: expected 5 player profiles, got %', (SELECT count(*) FROM t1_ctx);
    END IF;
END $$;

-- A creates the group; B, C, D, E join with the invite code.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
INSERT INTO t1_ctx SELECT 'group', (create_group_with_admin('T1 Grupo', 't1-grupo-test')).id;
RESET role;

INSERT INTO t1_ctx (key, txt) SELECT 'invite', invite_code FROM public.groups WHERE slug = 't1-grupo-test';

INSERT INTO t1_ctx SELECT 'm_admin', gm.id FROM group_memberships gm
WHERE gm.group_id = (SELECT val FROM t1_ctx WHERE key = 'group')
  AND gm.player_id = (SELECT val FROM t1_ctx WHERE key = 'p_a');

-- Scoring on, so a real cancel inside the window is a late_cancel.
UPDATE public.groups
SET settings = jsonb_build_object('member_scoring', jsonb_build_object('enabled', true, 'late_cancel_hours', 6))
WHERE id = (SELECT val FROM t1_ctx WHERE key = 'group');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
SELECT join_group_via_invite((SELECT txt FROM t1_ctx WHERE key = 'invite'));
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
SELECT join_group_via_invite((SELECT txt FROM t1_ctx WHERE key = 'invite'));
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
SELECT join_group_via_invite((SELECT txt FROM t1_ctx WHERE key = 'invite'));
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
SELECT join_group_via_invite((SELECT txt FROM t1_ctx WHERE key = 'invite'));
RESET role;

-- Matches: one with teams in 2 hours (inside the late-cancel window), one open
-- in 3 days, one finished last week (history).
INSERT INTO public.matches (id, group_id, date_time, status, max_players, location)
SELECT id::uuid, (SELECT val FROM t1_ctx WHERE key = 'group'), now() + offs::interval, st::match_status, mx, 'Cancha T1'
FROM (VALUES
    ('a1000000-0000-4000-8000-00000000aa01', '2 hours', 'teams_created', 2),
    ('a1000000-0000-4000-8000-00000000aa02', '3 days', 'signup_open', 10),
    ('a1000000-0000-4000-8000-00000000aa03', '-7 days', 'finished', 10)
) AS v(id, offs, st, mx);

-- Teams match: B and C confirmed with a lineup, D waiting.
INSERT INTO public.match_signups (match_id, player_id, status, waitlist_position, signup_time)
VALUES
    ('a1000000-0000-4000-8000-00000000aa01', (SELECT val FROM t1_ctx WHERE key = 'p_b'), 'confirmed', NULL, now() - interval '3 hours'),
    ('a1000000-0000-4000-8000-00000000aa01', (SELECT val FROM t1_ctx WHERE key = 'p_c'), 'confirmed', NULL, now() - interval '170 minutes'),
    ('a1000000-0000-4000-8000-00000000aa01', (SELECT val FROM t1_ctx WHERE key = 'p_d'), 'waitlist', 1, now() - interval '160 minutes');

INSERT INTO public.teams (id, match_id, name) VALUES
    ('a1000000-0000-4000-8000-00000000bb01', 'a1000000-0000-4000-8000-00000000aa01', 'dark'),
    ('a1000000-0000-4000-8000-00000000bb02', 'a1000000-0000-4000-8000-00000000aa01', 'light'),
    ('a1000000-0000-4000-8000-00000000bb03', 'a1000000-0000-4000-8000-00000000aa03', 'dark');
INSERT INTO public.team_assignments (team_id, player_id, position) VALUES
    ('a1000000-0000-4000-8000-00000000bb01', (SELECT val FROM t1_ctx WHERE key = 'p_b'), 'CM'),
    ('a1000000-0000-4000-8000-00000000bb02', (SELECT val FROM t1_ctx WHERE key = 'p_c'), 'CM'),
    ('a1000000-0000-4000-8000-00000000bb03', (SELECT val FROM t1_ctx WHERE key = 'p_e'), 'ST');

-- Open match: B, C, D and E confirmed. Finished match: E played.
INSERT INTO public.match_signups (match_id, player_id, status)
SELECT 'a1000000-0000-4000-8000-00000000aa02', val, 'confirmed' FROM t1_ctx WHERE key IN ('p_b', 'p_c', 'p_d', 'p_e');
INSERT INTO public.match_signups (match_id, player_id, status)
VALUES ('a1000000-0000-4000-8000-00000000aa03', (SELECT val FROM t1_ctx WHERE key = 'p_e'), 'confirmed');

-- Known scores, to check that leaving / removal does not move them.
UPDATE public.group_memberships SET member_score = 4.20
WHERE group_id = (SELECT val FROM t1_ctx WHERE key = 'group')
  AND player_id IN (SELECT val FROM t1_ctx WHERE key IN ('p_b', 'p_c'));

-- ---------------------------------------------------------------------------
-- 1. B leaves: spots freed on both upcoming matches (teams_created included),
--    no cancel events, score unchanged, rejoinable.
-- ---------------------------------------------------------------------------

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
SELECT leave_group((SELECT val FROM t1_ctx WHERE key = 'group'));
RESET role;

DO $$
DECLARE
    v_b UUID := (SELECT val FROM t1_ctx WHERE key = 'p_b');
    v_d UUID := (SELECT val FROM t1_ctx WHERE key = 'p_d');
    v_g UUID := (SELECT val FROM t1_ctx WHERE key = 'group');
BEGIN
    IF EXISTS (SELECT 1 FROM match_signups WHERE player_id = v_b AND status IN ('confirmed', 'waitlist')
               AND match_id IN ('a1000000-0000-4000-8000-00000000aa01', 'a1000000-0000-4000-8000-00000000aa02')) THEN
        RAISE EXCEPTION '1: B still signed up after leaving (teams_created must be included)';
    END IF;
    IF (SELECT status FROM match_signups WHERE player_id = v_d AND match_id = 'a1000000-0000-4000-8000-00000000aa01') <> 'confirmed' THEN
        RAISE EXCEPTION '1: D was not promoted into the freed spot';
    END IF;
    IF EXISTS (SELECT 1 FROM team_assignments WHERE player_id = v_b AND team_id = 'a1000000-0000-4000-8000-00000000bb01') THEN
        RAISE EXCEPTION '1: B kept a team slot after leaving';
    END IF;
    IF EXISTS (SELECT 1 FROM member_events WHERE player_id = v_b AND type IN ('late_cancel', 'early_cancel')) THEN
        RAISE EXCEPTION '1: leaving recorded a cancel event';
    END IF;
    IF (SELECT member_score FROM group_memberships WHERE group_id = v_g AND player_id = v_b) IS DISTINCT FROM 4.20 THEN
        RAISE EXCEPTION '1: leaving changed the member score';
    END IF;
    IF (SELECT is_active OR removed_at IS NOT NULL FROM group_memberships WHERE group_id = v_g AND player_id = v_b) THEN
        RAISE EXCEPTION '1: leaving must deactivate without marking a removal';
    END IF;
    IF current_setting('fulbot.membership_exit', true) = 'on' THEN
        RAISE EXCEPTION '1: fulbot.membership_exit still on after leave_group';
    END IF;
END $$;

-- B comes back with the invite code.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
DO $$
DECLARE
    v_m group_memberships;
BEGIN
    IF (get_public_group_by_invite((SELECT txt FROM t1_ctx WHERE key = 'invite'))->>'viewer_membership') <> 'inactive' THEN
        RAISE EXCEPTION '1: a member who left should see viewer_membership = inactive';
    END IF;
    v_m := join_group_via_invite((SELECT txt FROM t1_ctx WHERE key = 'invite'));
    IF NOT v_m.is_active OR v_m.role <> 'member' THEN
        RAISE EXCEPTION '1: B could not rejoin after leaving';
    END IF;
END $$;
RESET role;

-- ---------------------------------------------------------------------------
-- 2. Control: a normal cancel still records its event (the GUC was reset).
-- ---------------------------------------------------------------------------

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
SELECT cancel_my_signup('a1000000-0000-4000-8000-00000000aa02');
RESET role;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM member_events
                   WHERE player_id = (SELECT val FROM t1_ctx WHERE key = 'p_d')
                     AND match_id = 'a1000000-0000-4000-8000-00000000aa02'
                     AND type = 'early_cancel') THEN
        RAISE EXCEPTION '2: a normal cancel must still record early_cancel';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. A removes C: removal recorded, spots freed (teams_created included), no
--    cancel events, score unchanged.
-- ---------------------------------------------------------------------------

INSERT INTO t1_ctx SELECT 'm_c', id FROM group_memberships
WHERE group_id = (SELECT val FROM t1_ctx WHERE key = 'group') AND player_id = (SELECT val FROM t1_ctx WHERE key = 'p_c');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SELECT admin_remove_member((SELECT val FROM t1_ctx WHERE key = 'm_c'));
RESET role;

DO $$
DECLARE
    v_c UUID := (SELECT val FROM t1_ctx WHERE key = 'p_c');
    v_m group_memberships;
BEGIN
    SELECT * INTO v_m FROM group_memberships WHERE id = (SELECT val FROM t1_ctx WHERE key = 'm_c');
    IF v_m.is_active OR v_m.removed_at IS NULL OR v_m.removed_by IS DISTINCT FROM (SELECT val FROM t1_ctx WHERE key = 'p_a') THEN
        RAISE EXCEPTION '3: removal not recorded (active %, removed_at %, removed_by %)', v_m.is_active, v_m.removed_at, v_m.removed_by;
    END IF;
    IF EXISTS (SELECT 1 FROM match_signups WHERE player_id = v_c AND status IN ('confirmed', 'waitlist')
               AND match_id IN ('a1000000-0000-4000-8000-00000000aa01', 'a1000000-0000-4000-8000-00000000aa02')) THEN
        RAISE EXCEPTION '3: C still signed up after removal (teams_created must be included)';
    END IF;
    IF EXISTS (SELECT 1 FROM team_assignments WHERE player_id = v_c AND team_id = 'a1000000-0000-4000-8000-00000000bb02') THEN
        RAISE EXCEPTION '3: C kept a team slot after removal';
    END IF;
    IF EXISTS (SELECT 1 FROM member_events WHERE player_id = v_c AND type IN ('late_cancel', 'early_cancel')) THEN
        RAISE EXCEPTION '3: removal recorded a cancel event';
    END IF;
    IF v_m.member_score IS DISTINCT FROM 4.20 THEN
        RAISE EXCEPTION '3: removal changed the member score';
    END IF;
    IF current_setting('fulbot.membership_exit', true) = 'on' THEN
        RAISE EXCEPTION '3: fulbot.membership_exit still on after admin_remove_member';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. C cannot come back on their own: invite code, invite page and /m link.
-- ---------------------------------------------------------------------------

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
DO $$
DECLARE
    v_info JSONB;
BEGIN
    BEGIN
        PERFORM join_group_via_invite((SELECT txt FROM t1_ctx WHERE key = 'invite'));
        RAISE EXCEPTION '4: join_group_via_invite let an admin-removed player back in';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'removed_by_admin' THEN
            RAISE EXCEPTION '4: expected removed_by_admin, got %', SQLERRM;
        END IF;
    END;

    IF (get_public_group_by_invite((SELECT txt FROM t1_ctx WHERE key = 'invite'))->>'viewer_membership') <> 'removed' THEN
        RAISE EXCEPTION '4: get_public_group_by_invite should report viewer_membership = removed';
    END IF;

    v_info := get_match_join_info('a1000000-0000-4000-8000-00000000aa02');
    IF v_info IS NULL OR NOT (v_info->>'removed')::boolean OR v_info->>'invite_code' IS NOT NULL THEN
        RAISE EXCEPTION '4: get_match_join_info must flag the removal and hide the invite code, got %', v_info;
    END IF;
END $$;

-- An unrelated signed-in visitor still gets the invite code from the /m link.
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
DO $$
BEGIN
    IF (get_match_join_info('a1000000-0000-4000-8000-00000000aa02')->>'invite_code') IS NULL THEN
        RAISE EXCEPTION '4: get_match_join_info lost the invite code for a regular visitor';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Ex-members list and re-add (admins only).
-- ---------------------------------------------------------------------------

-- B is a plain member: no list, no re-add.
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
DO $$
BEGIN
    BEGIN
        PERFORM * FROM admin_list_removed_members((SELECT val FROM t1_ctx WHERE key = 'group'));
        RAISE EXCEPTION '5: a member could list removed members';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM admin_readd_member((SELECT val FROM t1_ctx WHERE key = 'm_c'));
        RAISE EXCEPTION '5: a member could re-add a removed member';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$
DECLARE
    v_rows INTEGER;
    v_m group_memberships;
BEGIN
    SELECT count(*) INTO v_rows
    FROM admin_list_removed_members((SELECT val FROM t1_ctx WHERE key = 'group')) r
    WHERE r.membership_id = (SELECT val FROM t1_ctx WHERE key = 'm_c') AND r.removed_by_name = 'T1 Admin';
    IF v_rows <> 1 THEN
        RAISE EXCEPTION '5: C missing from the ex-members list';
    END IF;
    -- B left on their own and is back: not an ex-member.
    IF EXISTS (SELECT 1 FROM admin_list_removed_members((SELECT val FROM t1_ctx WHERE key = 'group')) r
               WHERE r.player_id = (SELECT val FROM t1_ctx WHERE key = 'p_b')) THEN
        RAISE EXCEPTION '5: a self-leaver showed up as an ex-member';
    END IF;

    v_m := admin_readd_member((SELECT val FROM t1_ctx WHERE key = 'm_c'));
    IF NOT v_m.is_active OR v_m.role <> 'member' OR v_m.removed_at IS NOT NULL OR v_m.removed_by IS NOT NULL THEN
        RAISE EXCEPTION '5: admin_readd_member did not restore a plain member';
    END IF;

    BEGIN
        PERFORM admin_readd_member((SELECT val FROM t1_ctx WHERE key = 'm_c'));
        RAISE EXCEPTION '5: re-adding an active member should fail';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'not_removed' THEN
            RAISE EXCEPTION '5: expected not_removed, got %', SQLERRM;
        END IF;
    END;
END $$;

-- C can use the invite link again (no-op for an active member).
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
DO $$
BEGIN
    IF NOT (join_group_via_invite((SELECT txt FROM t1_ctx WHERE key = 'invite'))).is_active THEN
        RAISE EXCEPTION '5: re-added member not active';
    END IF;
END $$;
RESET role;

-- ---------------------------------------------------------------------------
-- 6. Account deletion is refused for the last admin of a group with members.
-- ---------------------------------------------------------------------------

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM account_deletion_blockers() WHERE group_slug = 't1-grupo-test') THEN
        RAISE EXCEPTION '6: account_deletion_blockers should list the group A is the last admin of';
    END IF;
    BEGIN
        PERFORM delete_my_account();
        RAISE EXCEPTION '6: the last admin could delete the account';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'last_admin_of_group' THEN
            RAISE EXCEPTION '6: expected last_admin_of_group, got %', SQLERRM;
        END IF;
    END;
END $$;
RESET role;

-- ---------------------------------------------------------------------------
-- 7. E deletes the account.
-- ---------------------------------------------------------------------------

-- E: a solo group, a push subscription, a peer rating, a notification, a nickname.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
INSERT INTO t1_ctx SELECT 'solo', (create_group_with_admin('T1 Solo', 't1-solo-test')).id;
RESET role;

UPDATE public.player_profiles SET nickname = 'Emita', preferred_positions = ARRAY['ST', 'LW'], main_position = 'ST'
WHERE id = (SELECT val FROM t1_ctx WHERE key = 'p_e');
INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
VALUES ('a1000000-0000-4000-8000-0000000000e1', 'https://push.example/t1-e', 'p256', 'auth');
INSERT INTO public.peer_ratings (group_id, voter_player_id, rated_player_id, goalkeeping, defense, attack, physical)
VALUES ((SELECT val FROM t1_ctx WHERE key = 'group'), (SELECT val FROM t1_ctx WHERE key = 'p_e'),
        (SELECT val FROM t1_ctx WHERE key = 'p_b'), 3, 3, 4, 4);
INSERT INTO public.notifications (group_id, recipient_player_id, type, payload)
VALUES ((SELECT val FROM t1_ctx WHERE key = 'group'), (SELECT val FROM t1_ctx WHERE key = 'p_e'), 'waitlist_promoted', '{}');
UPDATE public.group_memberships SET member_score = 3.10
WHERE group_id = (SELECT val FROM t1_ctx WHERE key = 'group') AND player_id = (SELECT val FROM t1_ctx WHERE key = 'p_e');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
DO $$
DECLARE
    v_res JSONB;
BEGIN
    IF EXISTS (SELECT 1 FROM account_deletion_blockers()) THEN
        RAISE EXCEPTION '7: a solo group must not block deletion';
    END IF;
    v_res := delete_my_account();
    IF (v_res->>'deleted_groups')::int <> 1 THEN
        RAISE EXCEPTION '7: expected the solo group to be deleted, got %', v_res;
    END IF;
END $$;
RESET role;

DO $$
DECLARE
    v_e UUID := (SELECT val FROM t1_ctx WHERE key = 'p_e');
    v_p player_profiles;
BEGIN
    IF EXISTS (SELECT 1 FROM groups WHERE id = (SELECT val FROM t1_ctx WHERE key = 'solo')) THEN
        RAISE EXCEPTION '7: the solo group was not deleted';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM groups WHERE id = (SELECT val FROM t1_ctx WHERE key = 'group')) THEN
        RAISE EXCEPTION '7: a shared group was deleted';
    END IF;
    IF EXISTS (SELECT 1 FROM group_memberships WHERE player_id = v_e AND is_active) THEN
        RAISE EXCEPTION '7: memberships still active';
    END IF;
    IF EXISTS (SELECT 1 FROM group_memberships WHERE player_id = v_e AND removed_at IS NOT NULL) THEN
        RAISE EXCEPTION '7: account deletion must not look like an admin removal';
    END IF;
    IF (SELECT status FROM match_signups WHERE player_id = v_e AND match_id = 'a1000000-0000-4000-8000-00000000aa02') <> 'cancelled' THEN
        RAISE EXCEPTION '7: upcoming signup not cancelled';
    END IF;
    IF EXISTS (SELECT 1 FROM member_events WHERE player_id = v_e AND type IN ('late_cancel', 'early_cancel')) THEN
        RAISE EXCEPTION '7: account deletion recorded a cancel event';
    END IF;
    IF (SELECT member_score FROM group_memberships WHERE player_id = v_e AND group_id = (SELECT val FROM t1_ctx WHERE key = 'group')) IS DISTINCT FROM 3.10 THEN
        RAISE EXCEPTION '7: account deletion changed the member score';
    END IF;
    IF EXISTS (SELECT 1 FROM peer_ratings WHERE voter_player_id = v_e) THEN
        RAISE EXCEPTION '7: authored peer ratings not deleted';
    END IF;
    IF EXISTS (SELECT 1 FROM push_subscriptions WHERE user_id = 'a1000000-0000-4000-8000-0000000000e1') THEN
        RAISE EXCEPTION '7: push subscriptions not deleted';
    END IF;
    IF EXISTS (SELECT 1 FROM notifications WHERE recipient_player_id = v_e) THEN
        RAISE EXCEPTION '7: notifications addressed to the player not deleted';
    END IF;

    SELECT * INTO v_p FROM player_profiles WHERE id = v_e;
    IF v_p.id IS NULL THEN
        RAISE EXCEPTION '7: the player profile must be kept';
    END IF;
    IF v_p.display_name <> 'Jugador eliminado' OR v_p.nickname IS NOT NULL OR v_p.user_id IS NOT NULL
       OR v_p.deleted_at IS NULL OR v_p.main_position <> 'CM' OR v_p.preferred_positions <> ARRAY['CM'] THEN
        RAISE EXCEPTION '7: profile not anonymized: %', row_to_json(v_p);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM match_signups WHERE player_id = v_e AND match_id = 'a1000000-0000-4000-8000-00000000aa03' AND status = 'confirmed') THEN
        RAISE EXCEPTION '7: past signup lost';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM team_assignments WHERE player_id = v_e) THEN
        RAISE EXCEPTION '7: past lineup slot lost';
    END IF;
    IF current_setting('fulbot.membership_exit', true) = 'on' THEN
        RAISE EXCEPTION '7: fulbot.membership_exit still on after delete_my_account';
    END IF;
END $$;

-- Group members still see the anonymized name in past lineups.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
DO $$
BEGIN
    IF (SELECT pp.display_name
        FROM team_assignments ta JOIN player_profiles pp ON pp.id = ta.player_id
        WHERE ta.team_id = 'a1000000-0000-4000-8000-00000000bb03') IS DISTINCT FROM 'Jugador eliminado' THEN
        RAISE EXCEPTION '7: members cannot read the anonymized player in a past lineup';
    END IF;
END $$;
RESET role;

-- The auth user can then be deleted; history stays.
DELETE FROM auth.users WHERE id = 'a1000000-0000-4000-8000-0000000000e1';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM player_profiles WHERE id = (SELECT val FROM t1_ctx WHERE key = 'p_e')) THEN
        RAISE EXCEPTION '7: deleting the auth user removed the anonymized profile';
    END IF;
    IF EXISTS (SELECT 1 FROM public.users WHERE id = 'a1000000-0000-4000-8000-0000000000e1') THEN
        RAISE EXCEPTION '7: public.users row survived the auth user';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Email change: public.users.email follows auth.users.email.
-- ---------------------------------------------------------------------------

-- Supabase Auth writes auth.users without a request JWT.
SELECT set_config('request.jwt.claims', '', true);
UPDATE auth.users SET email = 't1-b-nuevo@test.local' WHERE id = 'a1000000-0000-4000-8000-0000000000b1';
DO $$
BEGIN
    IF (SELECT email FROM public.users WHERE id = 'a1000000-0000-4000-8000-0000000000b1') <> 't1-b-nuevo@test.local' THEN
        RAISE EXCEPTION '8: public.users.email did not follow the auth email';
    END IF;
END $$;

SELECT 't1_membership_account: all scenarios passed' AS result;
