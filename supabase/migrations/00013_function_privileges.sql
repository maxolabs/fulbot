-- Function privilege hardening
--
-- Supabase grants EXECUTE on every new public function to anon, authenticated and
-- service_role through ALTER DEFAULT PRIVILEGES. "REVOKE ... FROM PUBLIC" in earlier
-- migrations therefore never removed the direct grant to anon. This migration:
--   1. revokes EXECUTE from PUBLIC and anon on every function in public (a function
--      with no explicit ACL is executable by PUBLIC), grants authenticated and
--      service_role, then re-grants anon the three functions the public page needs;
--   2. makes internal helpers (called only from other SECURITY DEFINER functions or
--      triggers, which run as the function owner) unreachable from anon/authenticated;
--   3. exposes finalize_match_results only through an authorization-checked wrapper;
--   4. changes the default privileges so future functions are not anon-callable.

-- ============================================
-- 1. Strip anon from everything, re-grant the public surface
-- ============================================

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
    LOOP
        -- A function with no explicit ACL grants EXECUTE to PUBLIC, so revoke that too
        -- and re-grant the roles the app actually uses.
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
    END LOOP;
END $$;

-- RLS helpers are referenced by policies on tables anon may query (e.g. groups by
-- invite code); they must stay executable by anon or those queries error out.
-- They return false/null when there is no authenticated user.
GRANT EXECUTE ON FUNCTION get_current_player_id() TO anon;
GRANT EXECUTE ON FUNCTION is_group_member(UUID) TO anon;
GRANT EXECUTE ON FUNCTION is_group_admin(UUID) TO anon;
GRANT EXECUTE ON FUNCTION is_group_admin_or_captain(UUID) TO anon;

GRANT EXECUTE ON FUNCTION get_public_match(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public_guest_signup(UUID, TEXT, UUID) TO anon;
GRANT EXECUTE ON FUNCTION cancel_guest_signup(UUID, UUID) TO anon;

-- ============================================
-- 2. Internal helpers: owner/service_role only
-- ============================================

REVOKE EXECUTE ON FUNCTION promote_from_waitlist(UUID) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION recompute_match_mvp(UUID) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION award_badges_for_match(UUID) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION update_player_reliability(UUID) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION update_player_rating(UUID) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION finalize_match_results(UUID) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION trg_match_mvp_votes_recompute() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION handle_user_deleted() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION update_updated_at() FROM anon, authenticated, PUBLIC;

-- ============================================
-- 3. Guarded wrapper for finalizing results
-- ============================================

CREATE OR REPLACE FUNCTION admin_finalize_match_results(p_match_id UUID)
RETURNS void AS $$
DECLARE
    v_group_id UUID;
BEGIN
    SELECT group_id INTO v_group_id FROM public.matches WHERE id = p_match_id;
    IF v_group_id IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    IF COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role', '') <> 'service_role'
       AND NOT is_group_admin_or_captain(v_group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para cargar resultados';
    END IF;

    PERFORM finalize_match_results(p_match_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION admin_finalize_match_results(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_finalize_match_results(UUID) TO authenticated, service_role;

-- ============================================
-- 4. Future functions: no anon by default
-- ============================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM anon;
