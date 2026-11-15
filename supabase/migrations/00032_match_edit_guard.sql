-- Finished and cancelled matches keep their date, place and cap (MATCH-5).
--
-- 00029 limited direct UPDATEs on matches to the columns the edit form writes
-- (date_time, location, notes, duration_minutes, results_request_delay_minutes)
-- but not by status: an admin or captain could still move a finished or
-- cancelled match, which rewrites history (stats, the results thread, the
-- "played on" date) and fires match_updated notifications for a match that is
-- over. The cap already goes through admin_set_match_max_players, which rejects
-- finished and cancelled matches; it is covered here too as defense in depth.
--
-- Scope: API callers only (current_user anon / authenticated, the same test as
-- trg_player_profiles_protect_stats in 00024). SECURITY DEFINER functions run as
-- their owner and the service role / direct database sessions are not
-- affected, so data fixes stay possible. No existing RPC moves date_time or
-- location; admin_set_match_max_players is the only one that writes
-- max_players and it runs as the owner.
--
-- notes, duration_minutes and results_request_delay_minutes stay editable.
-- Unchanged values pass (the edit form always sends date_time and location).
--
-- The message matches admin_set_match_max_players, so the app maps both to
-- ui.lifecycle.matchNotEditable.
--
-- Idempotent: safe to run twice.

CREATE OR REPLACE FUNCTION public.trg_matches_guard_closed_edits()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
    IF current_user IN ('anon', 'authenticated')
       AND OLD.status IN ('finished', 'cancelled')
       AND (NEW.date_time IS DISTINCT FROM OLD.date_time
            OR NEW.location IS DISTINCT FROM OLD.location
            OR NEW.max_players IS DISTINCT FROM OLD.max_players) THEN
        RAISE EXCEPTION 'No se puede modificar este partido'
            USING ERRCODE = '55000', DETAIL = format('Estado: %s', OLD.status);
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_matches_guard_closed_edits() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS matches_guard_closed_edits ON public.matches;
CREATE TRIGGER matches_guard_closed_edits
    BEFORE UPDATE OF date_time, location, max_players ON public.matches
    FOR EACH ROW EXECUTE FUNCTION public.trg_matches_guard_closed_edits();
