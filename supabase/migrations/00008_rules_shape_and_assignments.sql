-- T2 ai-teams: canonical rule_sets.data shape + save_team_assignments RPC
--
-- 1. Backfill rule_sets.data for avoid_pair/force_pair rows:
--      { player_id_a, player_id_b } -> { player_ids: [player_id_a, player_id_b] }
--    min_defenders/min_goalkeepers rows already use the canonical { min_count } shape,
--    so nothing to backfill for those.
-- 2. RPC save_team_assignments(p_match_id, p_assignments) replacing team_assignments
--    atomically for the match's two teams (used by manual drag/drop edits and by the
--    team generation route).
-- 3. Make sure get_recent_match_history is callable by authenticated users.
-- 4. Fix rule_sets' "Admins can manage rules" RLS policy (00003) to allow captains,
--    not just admins: the rules-manager.tsx UI (client-side insert/update straight
--    against the table, no SECURITY DEFINER RPC) is shown to any admin OR captain
--    (isAdminOrCaptain), matching the sibling teams/team_assignments policies which
--    already use is_group_admin_or_captain.
--
-- Written defensively: idempotent (safe to run more than once).

-- ============================================
-- 1. Backfill legacy pair-rule shape
-- ============================================

UPDATE public.rule_sets
SET data = jsonb_build_object(
    'player_ids', jsonb_build_array(data->'player_id_a', data->'player_id_b')
)
WHERE rule_type IN ('avoid_pair', 'force_pair')
  AND data ? 'player_id_a'
  AND data ? 'player_id_b'
  AND NOT (data ? 'player_ids');

-- ============================================
-- 2. save_team_assignments RPC
-- ============================================
-- p_assignments is a JSONB array of:
--   { "team": "dark" | "light", "player_id": uuid|null, "guest_player_id": uuid|null,
--     "position": text, "order_index": int, "source": "ai"|"manual" (optional, defaults
--     to "manual" - the AI generation route passes "ai" explicitly) }
-- Replaces ALL team_assignments for the match's dark/light teams atomically.
-- Creates the teams rows if they don't exist yet (so this RPC alone is enough for
-- both the initial AI-generated save and later manual edits).

CREATE OR REPLACE FUNCTION public.save_team_assignments(
    p_match_id UUID,
    p_assignments JSONB
)
RETURNS VOID AS $$
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

    IF NOT is_group_admin_or_captain(v_group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para modificar los equipos de este partido';
    END IF;

    IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN
        RAISE EXCEPTION 'p_assignments debe ser un array JSON';
    END IF;

    -- Ensure both teams exist
    INSERT INTO public.teams (match_id, name, color_hex)
    VALUES (p_match_id, 'dark', '#1a1a1a')
    ON CONFLICT (match_id, name) DO NOTHING;

    INSERT INTO public.teams (match_id, name, color_hex)
    VALUES (p_match_id, 'light', '#ffffff')
    ON CONFLICT (match_id, name) DO NOTHING;

    SELECT id INTO v_dark_team_id FROM public.teams WHERE match_id = p_match_id AND name = 'dark';
    SELECT id INTO v_light_team_id FROM public.teams WHERE match_id = p_match_id AND name = 'light';

    -- Replace all assignments for both teams atomically (single transaction: the
    -- function body runs inside one transaction already)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.save_team_assignments(UUID, JSONB) TO authenticated;

-- ============================================
-- 3. Make get_recent_match_history callable by authenticated users
-- ============================================

GRANT EXECUTE ON FUNCTION public.get_recent_match_history(UUID, INTEGER) TO authenticated;

-- ============================================
-- 4. rule_sets RLS: admins AND captains can manage rules (not admins only)
-- ============================================
-- 00003 created this policy scoped to is_group_admin only, inconsistent with the
-- teams/team_assignments policies (is_group_admin_or_captain) and with the UI, which
-- shows RulesManager to isAdminOrCaptain. DROP + CREATE is idempotent (safe to rerun).

DROP POLICY IF EXISTS "Admins can manage rules" ON public.rule_sets;

CREATE POLICY "Admins can manage rules"
    ON public.rule_sets FOR ALL
    USING (
        (group_id IS NOT NULL AND is_group_admin_or_captain(group_id)) OR
        (match_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_id AND is_group_admin_or_captain(m.group_id)
        ))
    );
