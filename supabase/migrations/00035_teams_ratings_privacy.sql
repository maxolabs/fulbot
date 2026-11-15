-- Teams, ratings and privacy (wrap-up track T3, docs/review/wrapup-2026-11-15.md).
--
--   1. OD-6  The AI snapshot leaves `matches` (readable by every member) for
--            match_ai_snapshots, readable by the group's admins and captains
--            only and written by publish_match_teams. As defense in depth the
--            snapshot is reduced to what the organizer analysis card shows
--            (reasoning, balance, warnings, provider): member scores, ratings,
--            the player list and the raw prompt are never stored.
--            matches.ai_input_snapshot is dropped after moving existing rows.
--   2.       team_assignments and teams lose their direct-write policies: the
--            lineup is only written by SECURITY DEFINER code
--            (publish_match_teams -> save_team_assignments, the lineup trigger
--            on match_signups, the results functions for teams.score).
--   3.       guest_players: estimated_rating, notes and self_signup_token are
--            no longer selectable by authenticated/anon (column privileges);
--            organizers read the level through get_match_guest_ratings().
--            display_name gets the 00027-style length limit (trimmed, 1..60,
--            the limit public_guest_signup already enforces).
--   4. OD-9  player_rating_summary is per group: key (group_id, player_id),
--            computed from that group's peer_ratings and from the post-match
--            ratings of that group's matches only. Readable by that group's
--            admins and captains. Recomputed on peer_ratings and match_ratings
--            INSERT/UPDATE/DELETE (account deletion relies on the DELETE path).
--            Player stats stay global; deleting a group now recomputes the
--            stats of the players who played in it.
--   5. OD-10 rule_sets policies are restated (admins and captains manage the
--            group-wide rows with match_id IS NULL and the per-match rows).
--
-- Idempotent: every statement can run twice on the same database.

-- ============================================
-- 1. AI SNAPSHOTS (OD-6)
-- ============================================

CREATE TABLE IF NOT EXISTS public.match_ai_snapshots (
    match_id UUID PRIMARY KEY REFERENCES public.matches(id) ON DELETE CASCADE,
    snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.match_ai_snapshots IS
    'Analysis of the last AI lineup of a match (reasoning, balance, warnings, provider). Admins and captains only; written by publish_match_teams.';

ALTER TABLE public.match_ai_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins and captains can read AI snapshots" ON public.match_ai_snapshots;
CREATE POLICY "Admins and captains can read AI snapshots"
    ON public.match_ai_snapshots FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_ai_snapshots.match_id
              AND is_group_admin_or_captain(m.group_id)
        )
    );

-- No write policy and no write privilege: only publish_match_teams writes it.
REVOKE ALL ON public.match_ai_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.match_ai_snapshots TO authenticated;
GRANT ALL ON public.match_ai_snapshots TO service_role;

-- Whitelist of what may be stored. Anything else the caller sends (input
-- players with ratings and member scores, rules, pair history, the prompt,
-- the proposed assignments) is dropped.
CREATE OR REPLACE FUNCTION public.ai_snapshot_for_storage(p_snapshot JSONB)
RETURNS JSONB
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
    SELECT CASE
        WHEN p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' THEN NULL
        ELSE jsonb_strip_nulls(jsonb_build_object(
            'provider', CASE WHEN p_snapshot->>'provider' IN ('openai', 'fallback') THEN p_snapshot->>'provider' END,
            'model', CASE WHEN jsonb_typeof(p_snapshot->'model') = 'string' THEN left(p_snapshot->>'model', 100) END,
            'generatedAt', CASE WHEN jsonb_typeof(p_snapshot->'generatedAt') = 'string' THEN left(p_snapshot->>'generatedAt', 40) END,
            'output', jsonb_strip_nulls(jsonb_build_object(
                'reasoning', CASE WHEN jsonb_typeof(p_snapshot->'output'->'reasoning') = 'string'
                                  THEN left(p_snapshot->'output'->>'reasoning', 4000) END,
                'balanceScore', CASE WHEN jsonb_typeof(p_snapshot->'output'->'balanceScore') = 'number'
                                     THEN p_snapshot->'output'->'balanceScore' END,
                'warnings', CASE WHEN jsonb_typeof(p_snapshot->'output'->'warnings') = 'array' THEN (
                    SELECT COALESCE(jsonb_agg(left(w #>> '{}', 500)), '[]'::jsonb)
                    FROM jsonb_array_elements(p_snapshot->'output'->'warnings') w
                    WHERE jsonb_typeof(w) = 'string'
                ) END
            ))
        ))
    END
$$;

REVOKE ALL ON FUNCTION public.ai_snapshot_for_storage(JSONB) FROM PUBLIC, anon, authenticated;

-- Move existing snapshots (reduced), then drop the column. Guarded so the
-- second run, when the column is already gone, is a no-op.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'matches' AND column_name = 'ai_input_snapshot'
    ) THEN
        EXECUTE $sql$
            INSERT INTO public.match_ai_snapshots (match_id, snapshot)
            SELECT m.id, public.ai_snapshot_for_storage(m.ai_input_snapshot)
            FROM public.matches m
            WHERE m.ai_input_snapshot IS NOT NULL
              AND public.ai_snapshot_for_storage(m.ai_input_snapshot) IS NOT NULL
            ON CONFLICT (match_id) DO NOTHING
        $sql$;
        ALTER TABLE public.matches DROP COLUMN ai_input_snapshot;
    END IF;
END $$;

-- ============================================
-- 2. TEAM WRITES ONLY THROUGH SECURITY DEFINER CODE
-- ============================================

-- 00003 "Admins and captains can manage ..." (FOR ALL). Reads stay as they are.
DROP POLICY IF EXISTS "Admins and captains can manage assignments" ON public.team_assignments;
DROP POLICY IF EXISTS "Admins and captains can manage teams" ON public.teams;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.team_assignments FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.teams FROM anon, authenticated;

-- save_team_assignments: 00008 body, now with a fixed search_path. Only
-- publish_match_teams calls it (EXECUTE is service_role only since 00024).
CREATE OR REPLACE FUNCTION public.save_team_assignments(
    p_match_id UUID,
    p_assignments JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_group_id UUID;
    v_dark_team_id UUID;
    v_light_team_id UUID;
    v_item JSONB;
    v_team_name TEXT;
    v_team_id UUID;
BEGIN
    SELECT group_id INTO v_group_id FROM public.matches WHERE id = p_match_id;

    IF v_group_id IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    IF NOT COALESCE(public.is_group_admin_or_captain(v_group_id), FALSE) THEN
        RAISE EXCEPTION 'No tenés permiso para modificar los equipos de este partido';
    END IF;

    IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN
        RAISE EXCEPTION 'p_assignments debe ser un array JSON';
    END IF;

    INSERT INTO public.teams (match_id, name, color_hex)
    VALUES (p_match_id, 'dark', '#1a1a1a')
    ON CONFLICT (match_id, name) DO NOTHING;

    INSERT INTO public.teams (match_id, name, color_hex)
    VALUES (p_match_id, 'light', '#ffffff')
    ON CONFLICT (match_id, name) DO NOTHING;

    SELECT id INTO v_dark_team_id FROM public.teams WHERE match_id = p_match_id AND name = 'dark';
    SELECT id INTO v_light_team_id FROM public.teams WHERE match_id = p_match_id AND name = 'light';

    DELETE FROM public.team_assignments WHERE team_id IN (v_dark_team_id, v_light_team_id);

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_assignments)
    LOOP
        v_team_name := v_item->>'team';

        IF v_team_name = 'dark' THEN
            v_team_id := v_dark_team_id;
        ELSIF v_team_name = 'light' THEN
            v_team_id := v_light_team_id;
        ELSE
            RAISE EXCEPTION 'Equipo inválido en la asignación: %', COALESCE(v_team_name, 'null');
        END IF;

        INSERT INTO public.team_assignments (
            team_id, player_id, guest_player_id, position, order_index, source
        ) VALUES (
            v_team_id,
            NULLIF(v_item->>'player_id', '')::UUID,
            NULLIF(v_item->>'guest_player_id', '')::UUID,
            COALESCE(NULLIF(v_item->>'position', ''), 'CM'),
            COALESCE((v_item->>'order_index')::SMALLINT, 0),
            COALESCE(NULLIF(v_item->>'source', ''), 'manual')::assignment_source
        );
    END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_team_assignments(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_team_assignments(UUID, JSONB) TO service_role;

-- publish_match_teams: 00029 body. The snapshot goes to match_ai_snapshots
-- (reduced by ai_snapshot_for_storage); a NULL snapshot (manual publish)
-- removes the previous one, because its analysis no longer describes the
-- lineup.
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
    v_snapshot JSONB;
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
    UPDATE public.matches SET lineup_needs_review = FALSE WHERE id = p_match_id;

    v_snapshot := public.ai_snapshot_for_storage(p_snapshot);
    IF v_snapshot IS NULL THEN
        DELETE FROM public.match_ai_snapshots WHERE match_id = p_match_id;
    ELSE
        INSERT INTO public.match_ai_snapshots AS s (match_id, snapshot)
        VALUES (p_match_id, v_snapshot)
        ON CONFLICT (match_id) DO UPDATE
            SET snapshot = EXCLUDED.snapshot, updated_at = NOW();
    END IF;

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
-- 3. GUEST PRIVACY AND NAME LIMIT
-- ============================================

-- Members keep the guest's name and positions (rosters, lineups); the level,
-- the organizer's notes and the self-signup token are not selectable.
REVOKE SELECT ON public.guest_players FROM anon, authenticated;
GRANT SELECT (id, display_name, preferred_positions, group_id, created_by_user_id, created_at)
    ON public.guest_players TO authenticated;

-- The level (and notes) of the guests signed up to a match, for the match's
-- admins and captains. Anyone else gets no rows.
CREATE OR REPLACE FUNCTION public.get_match_guest_ratings(p_match_id UUID)
RETURNS TABLE (guest_player_id UUID, estimated_rating NUMERIC, notes TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT g.id, g.estimated_rating::NUMERIC, g.notes
    FROM public.matches m
    JOIN public.guest_players g ON g.id IN (
        SELECT s.guest_player_id FROM public.match_signups s
        WHERE s.match_id = m.id AND s.guest_player_id IS NOT NULL
    )
    WHERE m.id = p_match_id
      AND COALESCE(public.is_group_admin_or_captain(m.group_id), FALSE)
$$;

REVOKE ALL ON FUNCTION public.get_match_guest_ratings(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_match_guest_ratings(UUID) TO authenticated, service_role;

-- display_name: same treatment as 00027 (clean, then a VALID constraint).
-- 60 is the limit public_guest_signup and the /m form already use.
UPDATE public.guest_players
SET display_name = COALESCE(NULLIF(left(btrim(display_name), 60), ''), 'Invitado')
WHERE display_name IS DISTINCT FROM COALESCE(NULLIF(left(btrim(display_name), 60), ''), 'Invitado');

ALTER TABLE public.guest_players DROP CONSTRAINT IF EXISTS guest_players_display_name_length;
ALTER TABLE public.guest_players ADD CONSTRAINT guest_players_display_name_length
    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 60);

-- ============================================
-- 4. PER-GROUP RATING SUMMARY (OD-9)
-- ============================================

-- The table is derived data: the global rows are dropped and rebuilt per
-- group by the backfill below.
ALTER TABLE public.player_rating_summary
    ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE;
DELETE FROM public.player_rating_summary WHERE group_id IS NULL;
ALTER TABLE public.player_rating_summary ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE public.player_rating_summary DROP CONSTRAINT IF EXISTS player_rating_summary_pkey;
ALTER TABLE public.player_rating_summary
    ADD CONSTRAINT player_rating_summary_pkey PRIMARY KEY (group_id, player_id);
CREATE INDEX IF NOT EXISTS idx_player_rating_summary_player ON public.player_rating_summary(player_id);

COMMENT ON TABLE public.player_rating_summary IS
    'Per-group rating aggregate (OD-9): peer_ratings of the group blended with post-match ratings of the group''s matches. Admins and captains of the group only.';

-- The old global entry points go away; the per-group recompute replaces them.
DROP TRIGGER IF EXISTS player_profile_rating_summary ON public.player_profiles;
DROP FUNCTION IF EXISTS public.trg_player_profile_summary();
DROP FUNCTION IF EXISTS public.recompute_player_rating(UUID);

-- 00018 aggregation, restricted to one group. A group or player that no
-- longer exists (cascade from a delete) only loses its row.
CREATE OR REPLACE FUNCTION public.recompute_player_rating(p_group_id UUID, p_player_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    c_baseline_weight CONSTANT NUMERIC := 3;  -- an admin baseline counts like three peers
    c_peer_cap CONSTANT NUMERIC := 8;         -- max weight the peer block carries against match evidence
    c_prior_weight CONSTANT NUMERIC := 2;     -- weight of the 3.00 default while nobody has rated the player
    v_gk NUMERIC;
    v_def NUMERIC;
    v_att NUMERIC;
    v_phy NUMERIC;
    v_peer_weight NUMERIC;
    v_peer_votes INTEGER;
    v_match_avg NUMERIC;
    v_matches_rated INTEGER;
    v_peer_overall NUMERIC;
    v_peer_block_weight NUMERIC;
    v_overall NUMERIC;
    v_tags TEXT[];
BEGIN
    IF p_group_id IS NULL OR p_player_id IS NULL THEN
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.groups WHERE id = p_group_id)
       OR NOT EXISTS (SELECT 1 FROM public.player_profiles WHERE id = p_player_id) THEN
        DELETE FROM public.player_rating_summary
        WHERE group_id = p_group_id AND player_id = p_player_id;
        RETURN;
    END IF;

    SELECT
        SUM(w * goalkeeping) / NULLIF(SUM(w), 0),
        SUM(w * defense) / NULLIF(SUM(w), 0),
        SUM(w * attack) / NULLIF(SUM(w), 0),
        SUM(w * physical) / NULLIF(SUM(w), 0),
        COALESCE(SUM(w), 0),
        COUNT(*)
    INTO v_gk, v_def, v_att, v_phy, v_peer_weight, v_peer_votes
    FROM (
        SELECT pr.*, CASE WHEN pr.is_baseline THEN c_baseline_weight ELSE 1 END AS w
        FROM public.peer_ratings pr
        WHERE pr.group_id = p_group_id AND pr.rated_player_id = p_player_id AND NOT pr.skipped
    ) r;

    SELECT AVG(mr.rating), COUNT(DISTINCT mr.match_id)
    INTO v_match_avg, v_matches_rated
    FROM public.match_ratings mr
    JOIN public.matches m ON m.id = mr.match_id
    WHERE m.group_id = p_group_id AND mr.rated_player_id = p_player_id;

    -- Tags: the ones at least two voters agree on (any tag while fewer than
    -- three people voted), top five by mentions.
    SELECT COALESCE(array_agg(t.tag ORDER BY t.n DESC, t.tag), '{}')
    INTO v_tags
    FROM (
        SELECT tag, COUNT(*) AS n
        FROM public.peer_ratings pr, unnest(pr.tags) AS tag
        WHERE pr.group_id = p_group_id AND pr.rated_player_id = p_player_id AND NOT pr.skipped
        GROUP BY tag
        HAVING COUNT(*) >= 2 OR v_peer_votes < 3
        ORDER BY n DESC, tag
        LIMIT 5
    ) t;

    -- Goalkeeping is left out of the outfield overall; the generator reads it
    -- separately when it needs a keeper.
    v_peer_overall := CASE WHEN v_peer_weight > 0 THEN (v_def + v_att + v_phy) / 3 END;
    v_peer_block_weight := CASE WHEN v_peer_weight > 0 THEN LEAST(v_peer_weight, c_peer_cap) ELSE c_prior_weight END;

    v_overall := (
        COALESCE(v_peer_overall, 3.00) * v_peer_block_weight
        + COALESCE(v_match_avg * v_matches_rated, 0)
    ) / (v_peer_block_weight + COALESCE(v_matches_rated, 0));

    v_overall := GREATEST(1, LEAST(5, v_overall));

    INSERT INTO public.player_rating_summary AS s
        (group_id, player_id, goalkeeping, defense, attack, physical, overall, tags, peer_votes, matches_rated, updated_at)
    VALUES (
        p_group_id, p_player_id,
        v_gk::DECIMAL(3,2), v_def::DECIMAL(3,2), v_att::DECIMAL(3,2), v_phy::DECIMAL(3,2),
        v_overall::DECIMAL(3,2), v_tags, v_peer_votes, COALESCE(v_matches_rated, 0), NOW()
    )
    ON CONFLICT (group_id, player_id) DO UPDATE SET
        goalkeeping = EXCLUDED.goalkeeping,
        defense = EXCLUDED.defense,
        attack = EXCLUDED.attack,
        physical = EXCLUDED.physical,
        overall = EXCLUDED.overall,
        tags = EXCLUDED.tags,
        peer_votes = EXCLUDED.peer_votes,
        matches_rated = EXCLUDED.matches_rated,
        updated_at = EXCLUDED.updated_at;
END;
$$;

-- Old entry point (recompute_player_stats, finalize_match_results): every
-- group row of the player. The return value is legacy; nobody reads it.
CREATE OR REPLACE FUNCTION public.update_player_rating(p_player_id UUID)
RETURNS DECIMAL
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_group_id UUID;
BEGIN
    FOR v_group_id IN
        SELECT gm.group_id FROM public.group_memberships gm WHERE gm.player_id = p_player_id
        UNION
        SELECT pr.group_id FROM public.peer_ratings pr WHERE pr.rated_player_id = p_player_id
        UNION
        SELECT m.group_id FROM public.match_ratings mr
        JOIN public.matches m ON m.id = mr.match_id
        WHERE mr.rated_player_id = p_player_id
        UNION
        SELECT s.group_id FROM public.player_rating_summary s WHERE s.player_id = p_player_id
    LOOP
        PERFORM public.recompute_player_rating(v_group_id, p_player_id);
    END LOOP;
    RETURN NULL;
END;
$$;

-- One trigger function for both rating tables (00018 shape).
CREATE OR REPLACE FUNCTION public.trg_ratings_recompute()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_old_group UUID;
    v_new_group UUID;
BEGIN
    IF TG_TABLE_NAME = 'peer_ratings' THEN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
            PERFORM public.recompute_player_rating(OLD.group_id, OLD.rated_player_id);
        END IF;
        IF TG_OP = 'INSERT' THEN
            PERFORM public.recompute_player_rating(NEW.group_id, NEW.rated_player_id);
        ELSIF TG_OP = 'UPDATE' THEN
            IF NEW.group_id IS DISTINCT FROM OLD.group_id
               OR NEW.rated_player_id IS DISTINCT FROM OLD.rated_player_id THEN
                PERFORM public.recompute_player_rating(NEW.group_id, NEW.rated_player_id);
            END IF;
        END IF;
    ELSE
        -- match_ratings: the group is the match's. A match deleted with its
        -- ratings (cascade) has no group left to recompute.
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
            SELECT group_id INTO v_old_group FROM public.matches WHERE id = OLD.match_id;
            PERFORM public.recompute_player_rating(v_old_group, OLD.rated_player_id);
        END IF;
        IF TG_OP = 'INSERT' THEN
            SELECT group_id INTO v_new_group FROM public.matches WHERE id = NEW.match_id;
            PERFORM public.recompute_player_rating(v_new_group, NEW.rated_player_id);
        ELSIF TG_OP = 'UPDATE' THEN
            IF NEW.match_id IS DISTINCT FROM OLD.match_id
               OR NEW.rated_player_id IS DISTINCT FROM OLD.rated_player_id THEN
                SELECT group_id INTO v_new_group FROM public.matches WHERE id = NEW.match_id;
                PERFORM public.recompute_player_rating(v_new_group, NEW.rated_player_id);
            END IF;
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS peer_ratings_recompute ON public.peer_ratings;
CREATE TRIGGER peer_ratings_recompute
    AFTER INSERT OR UPDATE OR DELETE ON public.peer_ratings
    FOR EACH ROW EXECUTE FUNCTION public.trg_ratings_recompute();

DROP TRIGGER IF EXISTS match_ratings_recompute ON public.match_ratings;
CREATE TRIGGER match_ratings_recompute
    AFTER INSERT OR UPDATE OR DELETE ON public.match_ratings
    FOR EACH ROW EXECUTE FUNCTION public.trg_ratings_recompute();

-- Readable by the admins and captains of the row's group only. No client
-- writes: the triggers above maintain it.
DROP POLICY IF EXISTS "Admins and captains can read rating summaries of their members" ON public.player_rating_summary;
DROP POLICY IF EXISTS "Admins and captains can read their group's rating summaries" ON public.player_rating_summary;
CREATE POLICY "Admins and captains can read their group's rating summaries"
    ON public.player_rating_summary FOR SELECT
    USING (is_group_admin_or_captain(group_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.player_rating_summary FROM anon, authenticated;
REVOKE SELECT ON public.player_rating_summary FROM anon;

REVOKE ALL ON FUNCTION public.recompute_player_rating(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_player_rating(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_ratings_recompute() FROM PUBLIC, anon, authenticated;

-- Backfill: every membership (active or not) and every pair with ratings.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT gm.group_id, gm.player_id FROM public.group_memberships gm
        UNION
        SELECT pr.group_id, pr.rated_player_id FROM public.peer_ratings pr
        UNION
        SELECT m.group_id, mr.rated_player_id FROM public.match_ratings mr
        JOIN public.matches m ON m.id = mr.match_id
    LOOP
        PERFORM public.recompute_player_rating(r.group_id, r.player_id);
    END LOOP;
END $$;

-- ============================================
-- 4b. GLOBAL STATS AFTER A GROUP IS DELETED (OD-9 / GRP-8)
-- ============================================
-- matches_played, goals, assists, clean sheets and MVPs are global and count
-- the deleted group's matches until recomputed. Before the group row goes,
-- its matches are deleted (the same cascade the group delete would run) and
-- the stats of everyone who appeared in them are recomputed.

CREATE OR REPLACE FUNCTION public.trg_groups_recompute_stats_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_players UUID[];
    v_player_id UUID;
BEGIN
    SELECT COALESCE(array_agg(DISTINCT x.player_id), '{}') INTO v_players
    FROM (
        SELECT ms.player_id FROM public.match_signups ms
        JOIN public.matches m ON m.id = ms.match_id
        WHERE m.group_id = OLD.id
        UNION
        SELECT me.player_id FROM public.match_events me
        JOIN public.matches m ON m.id = me.match_id
        WHERE m.group_id = OLD.id
        UNION
        SELECT m.mvp_player_id FROM public.matches m WHERE m.group_id = OLD.id
    ) x
    WHERE x.player_id IS NOT NULL;

    IF array_length(v_players, 1) IS NULL THEN
        RETURN OLD;
    END IF;

    DELETE FROM public.matches WHERE group_id = OLD.id;

    FOREACH v_player_id IN ARRAY v_players LOOP
        IF EXISTS (SELECT 1 FROM public.player_profiles WHERE id = v_player_id) THEN
            PERFORM public.recompute_player_stats(v_player_id);
        END IF;
    END LOOP;

    RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_groups_recompute_stats_on_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS groups_recompute_stats_on_delete ON public.groups;
CREATE TRIGGER groups_recompute_stats_on_delete
    BEFORE DELETE ON public.groups
    FOR EACH ROW EXECUTE FUNCTION public.trg_groups_recompute_stats_on_delete();

-- ============================================
-- 5. RULE SETS (OD-10)
-- ============================================
-- Same rule as 00008 with an explicit WITH CHECK: admins and captains manage
-- group-wide rules (group_id set, match_id NULL) and the rules of their
-- group's matches. Members keep reading them (00003).

DROP POLICY IF EXISTS "Admins can manage rules" ON public.rule_sets;
CREATE POLICY "Admins can manage rules"
    ON public.rule_sets FOR ALL
    USING (
        (group_id IS NOT NULL AND is_group_admin_or_captain(group_id)) OR
        (match_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = rule_sets.match_id AND is_group_admin_or_captain(m.group_id)
        ))
    )
    WITH CHECK (
        (group_id IS NOT NULL AND is_group_admin_or_captain(group_id)) OR
        (match_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = rule_sets.match_id AND is_group_admin_or_captain(m.group_id)
        ))
    );
