-- Initial scoring: peer ratings per group + aggregated rating summary per player.
--
-- Problem: every player entered the team generator at the 3.00 default until enough
-- post-match teammate ratings accumulated (and update_player_rating was barely ever
-- invoked), so balancing was blind for new groups and new members.
--
-- Design:
--   - peer_ratings: one standing opinion per (group, voter, rated) pair, editable at
--     any time. Four 1-5 dimensions (goalkeeping, defense, attack, physical) plus
--     structured tags. A row can be `skipped` (voter doesn't know the player) so the
--     pending queue stops nagging. `is_baseline` marks an admin's baseline rating,
--     which weighs 3x a regular peer vote.
--   - player_rating_summary: the aggregate the app reads (per-dimension averages,
--     tags, blended overall). Recomputed by trigger whenever peer_ratings or
--     match_ratings change. Readable ONLY by admins/captains of a group the player
--     belongs to; individual peer_ratings rows are readable only by their voter.
--   - overall = weighted blend of the peer baseline (weight = evidence, capped) and
--     post-match ratings (weight = matches rated, uncapped), so match evidence takes
--     over as history accumulates. With no data at all the overall stays 3.00.
--   - player_profiles.overall_rating is dropped: it was readable by every member via
--     the API, which contradicts the admin/captain-only visibility rule.
--   - Joining a group (or being reactivated) emits an in-app 'rate_new_member'
--     notification to the group (never to the WhatsApp outbox).

-- ============================================
-- TABLES
-- ============================================

CREATE TABLE public.peer_ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    voter_player_id UUID NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
    rated_player_id UUID NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
    skipped BOOLEAN NOT NULL DEFAULT FALSE,
    goalkeeping SMALLINT CHECK (goalkeeping BETWEEN 1 AND 5),
    defense SMALLINT CHECK (defense BETWEEN 1 AND 5),
    attack SMALLINT CHECK (attack BETWEEN 1 AND 5),
    physical SMALLINT CHECK (physical BETWEEN 1 AND 5),
    tags TEXT[] NOT NULL DEFAULT '{}',
    is_baseline BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (group_id, voter_player_id, rated_player_id),
    CHECK (voter_player_id <> rated_player_id),
    CHECK (
        (skipped AND goalkeeping IS NULL AND defense IS NULL AND attack IS NULL AND physical IS NULL)
        OR (NOT skipped AND goalkeeping IS NOT NULL AND defense IS NOT NULL AND attack IS NOT NULL AND physical IS NOT NULL)
    )
);

CREATE INDEX idx_peer_ratings_rated_player ON public.peer_ratings(rated_player_id);
CREATE INDEX idx_peer_ratings_group_voter ON public.peer_ratings(group_id, voter_player_id);

CREATE TRIGGER update_peer_ratings_updated_at BEFORE UPDATE ON public.peer_ratings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE public.player_rating_summary (
    player_id UUID PRIMARY KEY REFERENCES public.player_profiles(id) ON DELETE CASCADE,
    goalkeeping DECIMAL(3,2) CHECK (goalkeeping BETWEEN 1 AND 5),
    defense DECIMAL(3,2) CHECK (defense BETWEEN 1 AND 5),
    attack DECIMAL(3,2) CHECK (attack BETWEEN 1 AND 5),
    physical DECIMAL(3,2) CHECK (physical BETWEEN 1 AND 5),
    overall DECIMAL(3,2) NOT NULL DEFAULT 3.00 CHECK (overall BETWEEN 1 AND 5),
    tags TEXT[] NOT NULL DEFAULT '{}',
    peer_votes INTEGER NOT NULL DEFAULT 0,      -- non-skipped peer_ratings rows
    matches_rated INTEGER NOT NULL DEFAULT 0,   -- distinct matches with at least one teammate rating
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- AGGREGATION
-- ============================================

CREATE OR REPLACE FUNCTION recompute_player_rating(p_player_id UUID)
RETURNS void AS $$
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
        WHERE pr.rated_player_id = p_player_id AND NOT pr.skipped
    ) r;

    SELECT AVG(rating), COUNT(DISTINCT match_id)
    INTO v_match_avg, v_matches_rated
    FROM public.match_ratings
    WHERE rated_player_id = p_player_id;

    -- Tags: keep the ones at least two voters agree on (any tag while fewer than
    -- three people voted), top five by mentions.
    SELECT COALESCE(array_agg(t.tag ORDER BY t.n DESC, t.tag), '{}')
    INTO v_tags
    FROM (
        SELECT tag, COUNT(*) AS n
        FROM public.peer_ratings pr, unnest(pr.tags) AS tag
        WHERE pr.rated_player_id = p_player_id AND NOT pr.skipped
        GROUP BY tag
        HAVING COUNT(*) >= 2 OR v_peer_votes < 3
        ORDER BY n DESC, tag
        LIMIT 5
    ) t;

    -- Goalkeeping is deliberately left out of the outfield overall; the generator
    -- reads it separately when it needs a keeper.
    v_peer_overall := CASE WHEN v_peer_weight > 0 THEN (v_def + v_att + v_phy) / 3 END;
    v_peer_block_weight := CASE WHEN v_peer_weight > 0 THEN LEAST(v_peer_weight, c_peer_cap) ELSE c_prior_weight END;

    v_overall := (
        COALESCE(v_peer_overall, 3.00) * v_peer_block_weight
        + COALESCE(v_match_avg * v_matches_rated, 0)
    ) / (v_peer_block_weight + COALESCE(v_matches_rated, 0));

    v_overall := GREATEST(1, LEAST(5, v_overall));

    INSERT INTO public.player_rating_summary AS s
        (player_id, goalkeeping, defense, attack, physical, overall, tags, peer_votes, matches_rated, updated_at)
    VALUES (
        p_player_id,
        v_gk::DECIMAL(3,2), v_def::DECIMAL(3,2), v_att::DECIMAL(3,2), v_phy::DECIMAL(3,2),
        v_overall::DECIMAL(3,2), v_tags, v_peer_votes, COALESCE(v_matches_rated, 0), NOW()
    )
    ON CONFLICT (player_id) DO UPDATE SET
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Keep the old entry point (called by finalize_match_results) pointing at the new
-- aggregation, so nothing that PERFORMs it needs to change.
CREATE OR REPLACE FUNCTION update_player_rating(p_player_id UUID)
RETURNS DECIMAL AS $$
BEGIN
    PERFORM recompute_player_rating(p_player_id);
    RETURN COALESCE(
        (SELECT overall FROM public.player_rating_summary WHERE player_id = p_player_id),
        3.00
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION trg_ratings_recompute()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM recompute_player_rating(OLD.rated_player_id);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.rated_player_id <> OLD.rated_player_id) THEN
        PERFORM recompute_player_rating(NEW.rated_player_id);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER peer_ratings_recompute
    AFTER INSERT OR UPDATE OR DELETE ON public.peer_ratings
    FOR EACH ROW EXECUTE FUNCTION trg_ratings_recompute();

CREATE TRIGGER match_ratings_recompute
    AFTER INSERT OR UPDATE OR DELETE ON public.match_ratings
    FOR EACH ROW EXECUTE FUNCTION trg_ratings_recompute();

-- Every profile gets a summary row from the start so readers never have to special-case
-- a missing row for players nobody has rated yet.
CREATE OR REPLACE FUNCTION trg_player_profile_summary()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM recompute_player_rating(NEW.id);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER player_profile_rating_summary
    AFTER INSERT ON public.player_profiles
    FOR EACH ROW EXECUTE FUNCTION trg_player_profile_summary();

-- ============================================
-- DROP THE OLD COLUMN, BACKFILL
-- ============================================

ALTER TABLE public.player_profiles DROP COLUMN IF EXISTS overall_rating;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id FROM public.player_profiles LOOP
        PERFORM recompute_player_rating(r.id);
    END LOOP;
END $$;

-- ============================================
-- NEW MEMBER -> "rate this player" notification
-- ============================================

CREATE OR REPLACE FUNCTION trg_group_membership_rate_new_member()
RETURNS TRIGGER AS $$
DECLARE
    v_name TEXT;
BEGIN
    IF NOT NEW.is_active THEN
        RETURN NULL;
    END IF;
    -- Only on a fresh join or a reactivation, not on role changes.
    IF TG_OP = 'UPDATE' AND OLD.is_active THEN
        RETURN NULL;
    END IF;
    -- The founding admin has nobody to be rated by yet.
    IF NOT EXISTS (
        SELECT 1 FROM public.group_memberships gm
        WHERE gm.group_id = NEW.group_id AND gm.is_active AND gm.player_id <> NEW.player_id
    ) THEN
        RETURN NULL;
    END IF;

    SELECT display_name INTO v_name FROM public.player_profiles WHERE id = NEW.player_id;

    -- Inserted directly (not via emit_notification) so it never reaches the
    -- WhatsApp outbox: asking the whole chat to rate someone is not a group message.
    INSERT INTO public.notifications (group_id, match_id, recipient_player_id, type, payload)
    VALUES (
        NEW.group_id, NULL, NULL, 'rate_new_member',
        jsonb_build_object('player_id', NEW.player_id, 'player_name', v_name)
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER group_membership_rate_new_member
    AFTER INSERT OR UPDATE OF is_active ON public.group_memberships
    FOR EACH ROW EXECUTE FUNCTION trg_group_membership_rate_new_member();

-- ============================================
-- RLS
-- ============================================

ALTER TABLE public.peer_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_rating_summary ENABLE ROW LEVEL SECURITY;

-- Individual opinions stay private to whoever gave them (admins only see aggregates).
CREATE POLICY "Voters can read their own peer ratings"
    ON public.peer_ratings FOR SELECT
    USING (voter_player_id = get_current_player_id());

CREATE POLICY "Members can rate active members of their group"
    ON public.peer_ratings FOR INSERT
    WITH CHECK (
        voter_player_id = get_current_player_id()
        AND is_group_member(group_id)
        AND (NOT is_baseline OR is_group_admin(group_id))
        AND EXISTS (
            SELECT 1 FROM public.group_memberships gm
            WHERE gm.group_id = peer_ratings.group_id
            AND gm.player_id = peer_ratings.rated_player_id
            AND gm.is_active = TRUE
        )
    );

CREATE POLICY "Voters can update their own peer ratings"
    ON public.peer_ratings FOR UPDATE
    USING (voter_player_id = get_current_player_id())
    WITH CHECK (
        voter_player_id = get_current_player_id()
        AND is_group_member(group_id)
        AND (NOT is_baseline OR is_group_admin(group_id))
        AND EXISTS (
            SELECT 1 FROM public.group_memberships gm
            WHERE gm.group_id = peer_ratings.group_id
            AND gm.player_id = peer_ratings.rated_player_id
            AND gm.is_active = TRUE
        )
    );

CREATE POLICY "Voters can delete their own peer ratings"
    ON public.peer_ratings FOR DELETE
    USING (voter_player_id = get_current_player_id());

-- Scores are visible only to admins and captains of a group the player belongs to.
-- No client-side writes: the summary is maintained exclusively by the triggers above.
CREATE POLICY "Admins and captains can read rating summaries of their members"
    ON public.player_rating_summary FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.group_memberships gm
            WHERE gm.player_id = player_rating_summary.player_id
            AND gm.is_active = TRUE
            AND is_group_admin_or_captain(gm.group_id)
        )
    );

-- ============================================
-- PRIVILEGES (same shape as 00013)
-- ============================================

REVOKE EXECUTE ON FUNCTION recompute_player_rating(UUID) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION trg_ratings_recompute() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION trg_player_profile_summary() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION trg_group_membership_rate_new_member() FROM anon, authenticated, PUBLIC;
