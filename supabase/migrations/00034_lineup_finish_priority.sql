-- Wrap-up track T2 (match lifecycle), docs/review/wrapup-2026-11-15.md.
--
--   OD-2  Lineup swap. When a confirmed player (or guest) stops being confirmed
--         on a teams_created match and promote_from_waitlist confirms someone in
--         the same transaction, the promoted player (or guest) takes the
--         leaver's team_assignments row: same team, same position, same order.
--         The lineup then needs no review. When nobody is promoted the leaver's
--         slot is removed and lineup_needs_review is set (00029 behaviour).
--         waitlist_promoted carries the team and position the player got.
--   OD-3  Attendance-only finish. signup_open / full / signup_closed ->
--         finished is allowed in auto_finish_match (after kickoff + duration,
--         with at least one confirmed player) and in admin_set_match_status
--         (admins and captains, after kickoff). Attendance, no-show and member
--         score events still apply; stats and badges are finalized right away.
--         A finished match without teams gets no results jobs, no results
--         notifications, no reports and no MVP votes.
--   OD-8  Guest priority. While a member-scoring priority policy holds (the
--         priority window, or the reserved period once only the reserved
--         spots are left), self-signup guests from /m are waitlisted like
--         below-threshold members (waitlist_reason 'priority_window' /
--         'reserved'). The existing window-close job promotes them.
--   OD-11 Drop-out audience. A confirmed player who drops out notifies the
--         group's admins and captains (lineup_changed, one in-app row each)
--         only after teams_created or inside the late-cancel window
--         (member_scoring_settings.late_cancel_hours, default 6), and never
--         the whole group. The payload says who replaced whom.
--
-- Objects (re)defined here: match_has_teams (new), guest_priority_hold (new),
-- trg_match_signups_sync_lineup (now also tracks the changes), the
-- match_signups_track_lineup trigger and its function (dropped: folded into
-- the sync trigger), trg_match_signups_notify_lineup, promote_from_waitlist,
-- public_guest_signup, auto_finish_match, admin_set_match_status,
-- schedule_match_jobs, run_scheduled_job, submit_match_report and the
-- "Players can vote MVP" policy on match_mvp_votes.
--
-- Error messages stay Spanish (the app maps them):
--   'El partido todavía no empezó'                      -> finishing a match
--                                                         without teams early
--   'Este partido se cerró sin equipos: no hay resultado para reportar'

-- ============================================
-- 1. HELPERS
-- ============================================

-- A finished match without teams is an attendance-only match (OD-3). Teams
-- rows only exist once publish_match_teams ran (save_team_assignments
-- creates them), and publishing always moves the match to teams_created.
CREATE OR REPLACE FUNCTION public.match_has_teams(p_match_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM public.teams t WHERE t.match_id = p_match_id);
$$;

REVOKE ALL ON FUNCTION public.match_has_teams(UUID) FROM PUBLIC, anon;
-- authenticated: used inside the match_mvp_votes INSERT policy below.
GRANT EXECUTE ON FUNCTION public.match_has_teams(UUID) TO authenticated, service_role;

-- Whether the group's priority policy holds a self-signup guest back right
-- now (OD-8). Guests have no member score, so they are treated like members
-- below the threshold in signup_for_match (00029):
--   window   : until signup_opened_at + window_hours, every new guest waits.
--   reserved : until date_time - window_hours, a new guest waits once only
--              the reserved spots are left (confirmed >= max - reserved).
-- Returns NULL when no policy period is running, else
--   {reason, until, holds, reserved_spots}
-- where holds says whether a guest signing up now would be waitlisted for it
-- (a full match waitlists them anyway, with reason 'full').
CREATE OR REPLACE FUNCTION public.guest_priority_hold(p_match_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_match public.matches;
    v_settings JSONB;
    v_mode TEXT;
    v_window_hours NUMERIC;
    v_reserved INTEGER;
    v_until TIMESTAMPTZ;
    v_confirmed INTEGER;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match.id IS NULL OR v_match.status NOT IN ('signup_open', 'full') THEN
        RETURN NULL;
    END IF;

    v_settings := public.member_scoring_settings(v_match.group_id);
    IF NOT COALESCE((v_settings->>'enabled')::boolean, FALSE) THEN
        RETURN NULL;
    END IF;
    v_mode := COALESCE(v_settings->'priority'->>'mode', 'off');
    v_window_hours := COALESCE((v_settings->'priority'->>'window_hours')::numeric, 24);
    v_reserved := COALESCE((v_settings->'priority'->>'reserved_spots')::integer, 4);

    IF v_mode = 'window' AND v_match.signup_opened_at IS NOT NULL THEN
        v_until := v_match.signup_opened_at + (v_window_hours || ' hours')::interval;
        IF now() < v_until THEN
            RETURN jsonb_build_object('reason', 'priority_window', 'until', v_until, 'holds', TRUE,
                                      'reserved_spots', v_reserved);
        END IF;
    ELSIF v_mode = 'reserved' THEN
        v_until := v_match.date_time - (v_window_hours || ' hours')::interval;
        IF now() < v_until THEN
            SELECT COUNT(*) INTO v_confirmed
            FROM public.match_signups
            WHERE match_id = p_match_id AND status = 'confirmed';
            RETURN jsonb_build_object('reason', 'reserved', 'until', v_until,
                                      'holds', v_confirmed >= v_match.max_players - v_reserved,
                                      'reserved_spots', v_reserved);
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.guest_priority_hold(UUID) FROM PUBLIC, anon, authenticated;
-- The public /m page reads it with the service-role client.
GRANT EXECUTE ON FUNCTION public.guest_priority_hold(UUID) TO service_role;

-- ============================================
-- 2. LINEUP: SWAP, REVIEW FLAG AND CHANGE TRACKING (OD-2, OD-11)
-- ============================================

-- One row trigger on match_signups for every path that changes the confirmed
-- list (self-cancel, admin removal, guest cancel, leave group / removal from
-- the group, waitlist promotion, admin-added guests, deletes).
--
-- Transaction-local state in the setting fulbot.lineup_changes
-- (set_config(..., true)), per match id:
--   left      : signup ids that went confirmed -> cancelled (lineup_changed)
--   in        : signup ids that went waitlist -> confirmed (lineup_changed)
--   vacancies : team slots freed on a teams_created match, oldest first,
--               {team_id, position, order_index, source, left}
--   swaps     : {left, in, team_id, position} filled slots (lineup_changed)
--   review_before : lineup_needs_review before the first vacancy, so a swap
--                   that closes every gap restores it instead of clearing a
--                   flag an earlier change had set.
-- The leaver's UPDATE always runs before the promotion (cancel, then
-- promote_from_waitlist), so the vacancy is there when the newcomer arrives.
--
-- SECURITY DEFINER with search_path = public: it is the only writer of
-- team_assignments outside publish_match_teams once the direct-write policies
-- are gone (T3), and it runs for anonymous guests too (cancel_guest_signup).
CREATE OR REPLACE FUNCTION public.trg_match_signups_sync_lineup()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_match_id UUID;
    v_status public.match_status;
    v_review BOOLEAN;
    v_old_status public.signup_status;
    v_new_status public.signup_status;
    v_signup_id UUID;
    v_player_id UUID;
    v_guest_id UUID;
    v_left BOOLEAN := FALSE;
    v_in BOOLEAN := FALSE;
    v_key TEXT;
    v_state JSONB;
    v_entry JSONB;
    v_dirty BOOLEAN := FALSE;
    v_gone JSONB;
    v_vacancy JSONB;
    v_swapped BOOLEAN := FALSE;
    v_mismatch BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_match_id := OLD.match_id;
        v_old_status := OLD.status;
        v_new_status := NULL;
        v_signup_id := OLD.id;
    ELSE
        v_match_id := NEW.match_id;
        v_new_status := NEW.status;
        v_signup_id := NEW.id;
        v_player_id := NEW.player_id;
        v_guest_id := NEW.guest_player_id;
        IF TG_OP = 'UPDATE' THEN
            v_old_status := OLD.status;
        END IF;
    END IF;

    SELECT status, lineup_needs_review INTO v_status, v_review
    FROM public.matches WHERE id = v_match_id;
    IF v_status IS NULL OR v_status NOT IN ('signup_open', 'full', 'signup_closed', 'teams_created') THEN
        RETURN NULL;
    END IF;

    -- A confirmed spot was given up (cancel, no-show, back to the waitlist, delete).
    v_left := COALESCE(v_old_status = 'confirmed', FALSE) AND v_new_status IS DISTINCT FROM 'confirmed';
    -- A promotion.
    v_in := COALESCE(v_old_status = 'waitlist' AND v_new_status = 'confirmed', FALSE);

    IF NOT v_left AND NOT v_in AND v_status <> 'teams_created' THEN
        RETURN NULL;
    END IF;

    v_key := v_match_id::TEXT;
    v_state := COALESCE(NULLIF(current_setting('fulbot.lineup_changes', true), ''), '{}')::jsonb;
    v_entry := '{"left": [], "in": [], "vacancies": [], "swaps": []}'::jsonb || COALESCE(v_state->v_key, '{}'::jsonb);

    IF v_left AND v_new_status = 'cancelled' THEN
        v_entry := jsonb_set(v_entry, '{left}', (v_entry->'left') || to_jsonb(v_signup_id::TEXT));
        v_dirty := TRUE;
    ELSIF v_in THEN
        v_entry := jsonb_set(v_entry, '{in}', (v_entry->'in') || to_jsonb(v_signup_id::TEXT));
        v_dirty := TRUE;
    END IF;

    IF v_status = 'teams_created' THEN
        IF v_left THEN
            -- Free the leaver's slot and remember it for a promotion in this
            -- transaction.
            WITH gone AS (
                DELETE FROM public.team_assignments ta
                USING public.teams t
                WHERE ta.team_id = t.id
                  AND t.match_id = v_match_id
                  AND ((OLD.player_id IS NOT NULL AND ta.player_id = OLD.player_id)
                    OR (OLD.guest_player_id IS NOT NULL AND ta.guest_player_id = OLD.guest_player_id))
                RETURNING ta.team_id, ta.position, ta.order_index, ta.source
            )
            SELECT jsonb_agg(jsonb_build_object(
                       'team_id', g.team_id, 'position', g.position,
                       'order_index', g.order_index, 'source', g.source,
                       'left', v_signup_id))
            INTO v_gone
            FROM gone g;

            IF v_gone IS NOT NULL THEN
                IF NOT (v_entry ? 'review_before') THEN
                    v_entry := v_entry || jsonb_build_object('review_before', COALESCE(v_review, FALSE));
                END IF;
                v_entry := jsonb_set(v_entry, '{vacancies}', (v_entry->'vacancies') || v_gone);
                v_dirty := TRUE;
            END IF;
        ELSIF v_in AND jsonb_array_length(v_entry->'vacancies') > 0
              AND NOT EXISTS (
                  SELECT 1 FROM public.team_assignments ta
                  JOIN public.teams t ON t.id = ta.team_id
                  WHERE t.match_id = v_match_id
                    AND ((v_player_id IS NOT NULL AND ta.player_id = v_player_id)
                      OR (v_guest_id IS NOT NULL AND ta.guest_player_id = v_guest_id))
              ) THEN
            -- The promoted player or guest takes the oldest freed slot.
            v_vacancy := v_entry->'vacancies'->0;
            INSERT INTO public.team_assignments (team_id, player_id, guest_player_id, position, order_index, source)
            SELECT t.id, v_player_id, v_guest_id,
                   v_vacancy->>'position',
                   COALESCE((v_vacancy->>'order_index')::SMALLINT, 0),
                   COALESCE(NULLIF(v_vacancy->>'source', ''), 'manual')::public.assignment_source
            FROM public.teams t
            WHERE t.id = (v_vacancy->>'team_id')::UUID AND t.match_id = v_match_id;

            IF FOUND THEN
                v_swapped := TRUE;
                v_entry := jsonb_set(v_entry, '{swaps}', (v_entry->'swaps') || jsonb_build_array(jsonb_build_object(
                    'left', v_vacancy->>'left', 'in', v_signup_id::TEXT,
                    'team_id', v_vacancy->>'team_id', 'position', v_vacancy->>'position')));
            END IF;
            -- Consumed either way: a slot whose team is gone cannot be filled.
            v_entry := jsonb_set(v_entry, '{vacancies}', (v_entry->'vacancies') - 0);
            v_dirty := TRUE;
        END IF;

        -- Any difference between the confirmed set and the assignments.
        SELECT EXISTS (
            SELECT 1 FROM public.match_signups s
            WHERE s.match_id = v_match_id AND s.status = 'confirmed'
              AND NOT EXISTS (
                  SELECT 1 FROM public.team_assignments ta
                  JOIN public.teams t ON t.id = ta.team_id
                  WHERE t.match_id = v_match_id
                    AND ((s.player_id IS NOT NULL AND ta.player_id = s.player_id)
                      OR (s.guest_player_id IS NOT NULL AND ta.guest_player_id = s.guest_player_id))
              )
        ) OR EXISTS (
            SELECT 1 FROM public.team_assignments ta
            JOIN public.teams t ON t.id = ta.team_id
            WHERE t.match_id = v_match_id
              AND NOT EXISTS (
                  SELECT 1 FROM public.match_signups s
                  WHERE s.match_id = v_match_id AND s.status = 'confirmed'
                    AND ((ta.player_id IS NOT NULL AND s.player_id = ta.player_id)
                      OR (ta.guest_player_id IS NOT NULL AND s.guest_player_id = ta.guest_player_id))
              )
        ) INTO v_mismatch;

        IF v_gone IS NOT NULL OR v_mismatch THEN
            -- A gap in a team, or someone without a slot: the organizer looks.
            UPDATE public.matches SET lineup_needs_review = TRUE
            WHERE id = v_match_id AND NOT lineup_needs_review;
        ELSIF v_swapped
              AND jsonb_array_length(v_entry->'vacancies') = 0
              AND NOT COALESCE((v_entry->>'review_before')::boolean, TRUE) THEN
            -- Every slot freed in this transaction was taken over.
            UPDATE public.matches SET lineup_needs_review = FALSE
            WHERE id = v_match_id AND lineup_needs_review;
        END IF;
    END IF;

    IF v_dirty THEN
        PERFORM set_config('fulbot.lineup_changes', jsonb_set(v_state, ARRAY[v_key], v_entry, true)::TEXT, true);
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_match_signups_sync_lineup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS match_signups_sync_lineup ON public.match_signups;
CREATE TRIGGER match_signups_sync_lineup
    AFTER INSERT OR UPDATE OF status OR DELETE ON public.match_signups
    FOR EACH ROW EXECUTE FUNCTION public.trg_match_signups_sync_lineup();

-- 00030's tracking trigger is folded into the sync trigger above (one writer
-- of fulbot.lineup_changes, so the swap and the tracking cannot disagree).
DROP TRIGGER IF EXISTS match_signups_track_lineup ON public.match_signups;
DROP FUNCTION IF EXISTS public.trg_match_signups_track_lineup();

-- Runs at commit for every confirmed -> cancelled row. The first one for a
-- match emits lineup_changed with everything recorded above and clears the
-- match's entry, so several leavers in one transaction give one notification.
-- Audience (OD-11): the group's active admins and captains, minus whoever
-- acted and anyone who left; never the whole group. Only when the match has
-- its teams, or signups are still open and the drop-out falls inside the
-- late-cancel window. Inserts directly (like results_needs_review) because
-- the cancel can come from an anonymous guest.
CREATE OR REPLACE FUNCTION public.trg_match_signups_notify_lineup()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_state JSONB;
    v_entry JSONB;
    v_key TEXT;
    v_match public.matches;
    v_group_name TEXT;
    v_late_hours NUMERIC;
    v_phase TEXT;
    v_left JSONB;
    v_in JSONB;
    v_swaps JSONB;
    v_actor UUID;
    v_confirmed INTEGER;
BEGIN
    v_state := COALESCE(NULLIF(current_setting('fulbot.lineup_changes', true), ''), '{}')::jsonb;
    v_key := NEW.match_id::TEXT;
    v_entry := v_state->v_key;
    IF v_entry IS NULL THEN RETURN NULL; END IF;
    PERFORM set_config('fulbot.lineup_changes', (v_state - v_key)::TEXT, true);

    SELECT * INTO v_match FROM public.matches WHERE id = NEW.match_id;
    IF v_match.id IS NULL OR v_match.date_time <= now() THEN
        RETURN NULL;
    END IF;

    IF v_match.status = 'teams_created' THEN
        v_phase := 'teams';
    ELSIF v_match.status IN ('signup_open', 'full', 'signup_closed') THEN
        v_late_hours := COALESCE((public.member_scoring_settings(v_match.group_id)->>'late_cancel_hours')::numeric, 6);
        IF now() <= v_match.date_time - (v_late_hours || ' hours')::interval THEN
            RETURN NULL;
        END IF;
        v_phase := 'late';
    ELSE
        RETURN NULL;
    END IF;

    -- Only people who are still out / still in at commit.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', COALESCE(pp.display_name, gp.display_name, '?'),
               'player_id', ms.player_id,
               'guest', ms.guest_player_id IS NOT NULL) ORDER BY ms.cancel_time), '[]'::jsonb)
    INTO v_left
    FROM public.match_signups ms
    LEFT JOIN public.player_profiles pp ON pp.id = ms.player_id
    LEFT JOIN public.guest_players gp ON gp.id = ms.guest_player_id
    WHERE ms.id::TEXT IN (SELECT jsonb_array_elements_text(COALESCE(v_entry->'left', '[]'::jsonb)))
      AND ms.status = 'cancelled';

    IF jsonb_array_length(v_left) = 0 THEN RETURN NULL; END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', COALESCE(pp.display_name, gp.display_name, '?'),
               'player_id', ms.player_id,
               'guest', ms.guest_player_id IS NOT NULL)), '[]'::jsonb)
    INTO v_in
    FROM public.match_signups ms
    LEFT JOIN public.player_profiles pp ON pp.id = ms.player_id
    LEFT JOIN public.guest_players gp ON gp.id = ms.guest_player_id
    WHERE ms.id::TEXT IN (SELECT jsonb_array_elements_text(COALESCE(v_entry->'in', '[]'::jsonb)))
      AND ms.status = 'confirmed';

    -- Who took whose place, for the swaps that still hold at commit.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'left', COALESCE(lp.display_name, lg.display_name, '?'),
               'in', COALESCE(ip.display_name, ig.display_name, '?'),
               'team', t.name,
               'position', sw.position) ORDER BY sw.ord), '[]'::jsonb)
    INTO v_swaps
    FROM jsonb_array_elements(COALESCE(v_entry->'swaps', '[]'::jsonb)) WITH ORDINALITY AS e(sw_json, ord)
    CROSS JOIN LATERAL (
        SELECT (e.sw_json->>'left')::UUID AS left_id, (e.sw_json->>'in')::UUID AS in_id,
               (e.sw_json->>'team_id')::UUID AS team_id, e.sw_json->>'position' AS position, e.ord AS ord
    ) sw
    JOIN public.match_signups ls ON ls.id = sw.left_id AND ls.status <> 'confirmed'
    JOIN public.match_signups ins ON ins.id = sw.in_id AND ins.status = 'confirmed'
    JOIN public.teams t ON t.id = sw.team_id
    LEFT JOIN public.player_profiles lp ON lp.id = ls.player_id
    LEFT JOIN public.guest_players lg ON lg.id = ls.guest_player_id
    LEFT JOIN public.player_profiles ip ON ip.id = ins.player_id
    LEFT JOIN public.guest_players ig ON ig.id = ins.guest_player_id;

    SELECT name INTO v_group_name FROM public.groups WHERE id = v_match.group_id;
    SELECT COUNT(*) INTO v_confirmed FROM public.match_signups
    WHERE match_id = v_match.id AND status = 'confirmed';
    -- The admin or captain who removed a player already knows.
    v_actor := get_current_player_id();

    INSERT INTO public.notifications (group_id, match_id, recipient_player_id, type, payload)
    SELECT v_match.group_id, v_match.id, gm.player_id, 'lineup_changed', jsonb_build_object(
        'match_id', v_match.id, 'group_name', v_group_name, 'date_time', v_match.date_time,
        'phase', v_phase,
        'left', v_left, 'promoted', v_in, 'swaps', v_swaps,
        'needs_review', v_phase = 'teams' AND v_match.lineup_needs_review,
        'spots_left', GREATEST(v_match.max_players - v_confirmed, 0),
        'recipient_player_id', gm.player_id)
    FROM public.group_memberships gm
    WHERE gm.group_id = v_match.group_id AND gm.is_active
      AND gm.role IN ('admin', 'captain')
      AND gm.player_id IS DISTINCT FROM v_actor
      AND NOT (v_left @> jsonb_build_array(jsonb_build_object('player_id', gm.player_id)));
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_match_signups_notify_lineup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS match_signups_notify_lineup ON public.match_signups;
CREATE CONSTRAINT TRIGGER match_signups_notify_lineup AFTER UPDATE OF status ON public.match_signups
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW WHEN (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
    EXECUTE FUNCTION public.trg_match_signups_notify_lineup();

-- promote_from_waitlist: 00029 body. New: search_path pinned, and the
-- waitlist_promoted payload says which team and position the promoted player
-- took over (OD-2; the slot is filled by the sync trigger during the UPDATE).
CREATE OR REPLACE FUNCTION public.promote_from_waitlist(p_match_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_match public.matches;
    v_confirmed_count INTEGER;
    v_promoted_id UUID;
    v_promoted_player_id UUID;
    v_promoted_guest_id UUID;
    v_promoted_name TEXT;
    v_team TEXT;
    v_position TEXT;
    v_settings JSONB;
    v_enabled BOOLEAN;
    v_mode TEXT;
    v_by_score BOOLEAN;
    v_threshold NUMERIC;
    v_window_hours NUMERIC;
    v_reserved INTEGER;
    v_window_open BOOLEAN;
    v_reserved_active BOOLEAN;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RETURN NULL;
    END IF;

    IF v_match.status NOT IN ('signup_open', 'full', 'signup_closed', 'teams_created') THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*) INTO v_confirmed_count
    FROM public.match_signups
    WHERE match_id = p_match_id AND status = 'confirmed';

    v_promoted_id := NULL;

    IF v_confirmed_count < v_match.max_players THEN
        v_settings := member_scoring_settings(v_match.group_id);
        v_enabled := COALESCE((v_settings->>'enabled')::boolean, false);
        v_mode := COALESCE(v_settings->'priority'->>'mode', 'off');
        v_by_score := v_enabled AND v_mode = 'waitlist';
        v_threshold := COALESCE((v_settings->'priority'->>'threshold')::numeric, 3.0);
        v_window_hours := COALESCE((v_settings->'priority'->>'window_hours')::numeric, 24);
        v_reserved := COALESCE((v_settings->'priority'->>'reserved_spots')::integer, 4);

        -- Same decisions as signup_for_match (§5.1).
        v_window_open := v_enabled AND v_mode = 'window'
            AND v_match.signup_opened_at IS NOT NULL
            AND now() < v_match.signup_opened_at + (v_window_hours || ' hours')::interval;
        v_reserved_active := v_enabled AND v_mode = 'reserved'
            AND now() < v_match.date_time - (v_window_hours || ' hours')::interval
            AND v_confirmed_count >= v_match.max_players - v_reserved;

        IF v_by_score THEN
            SELECT ms.id, ms.player_id, ms.guest_player_id
            INTO v_promoted_id, v_promoted_player_id, v_promoted_guest_id
            FROM public.match_signups ms
            LEFT JOIN public.group_memberships gm
                ON gm.group_id = v_match.group_id AND gm.player_id = ms.player_id
            WHERE ms.match_id = p_match_id AND ms.status = 'waitlist'
            ORDER BY COALESCE(gm.member_score, v_threshold) DESC,
                     ms.waitlist_position ASC NULLS LAST, ms.signup_time ASC
            LIMIT 1;
        ELSE
            SELECT id, player_id, guest_player_id
            INTO v_promoted_id, v_promoted_player_id, v_promoted_guest_id
            FROM public.match_signups
            WHERE match_id = p_match_id AND status = 'waitlist'
            AND NOT (v_window_open AND waitlist_reason = 'priority_window')
            AND NOT (v_reserved_active AND waitlist_reason = 'reserved')
            ORDER BY waitlist_position ASC NULLS LAST, signup_time ASC
            LIMIT 1;
        END IF;

        IF v_promoted_id IS NOT NULL THEN
            UPDATE public.match_signups
            SET status = 'confirmed', waitlist_position = NULL, waitlist_reason = NULL
            WHERE id = v_promoted_id;

            v_confirmed_count := v_confirmed_count + 1;

            -- Reorder remaining waitlist
            WITH numbered AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY waitlist_position ASC NULLS LAST, signup_time ASC) AS new_pos
                FROM public.match_signups
                WHERE match_id = p_match_id AND status = 'waitlist'
            )
            UPDATE public.match_signups ms
            SET waitlist_position = numbered.new_pos
            FROM numbered
            WHERE ms.id = numbered.id;

            IF v_promoted_player_id IS NOT NULL THEN
                SELECT display_name INTO v_promoted_name
                FROM public.player_profiles WHERE id = v_promoted_player_id;
            ELSE
                SELECT display_name INTO v_promoted_name
                FROM public.guest_players WHERE id = v_promoted_guest_id;
            END IF;

            -- The slot the sync trigger gave them, if the teams are out.
            IF v_match.status = 'teams_created' THEN
                SELECT t.name::TEXT, ta.position INTO v_team, v_position
                FROM public.team_assignments ta
                JOIN public.teams t ON t.id = ta.team_id
                WHERE t.match_id = p_match_id
                  AND ((v_promoted_player_id IS NOT NULL AND ta.player_id = v_promoted_player_id)
                    OR (v_promoted_guest_id IS NOT NULL AND ta.guest_player_id = v_promoted_guest_id))
                LIMIT 1;
            END IF;

            PERFORM emit_notification(
                v_match.group_id,
                p_match_id,
                'waitlist_promoted',
                jsonb_build_object(
                    'signup_id', v_promoted_id,
                    'player_name', v_promoted_name,
                    'recipient_player_id', v_promoted_player_id,
                    'team', v_team,
                    'position', v_position
                )
            );
        END IF;
    END IF;

    -- Only reconcile status while the match is actively tracking signups, and only
    -- when it actually changes (the UPDATE OF status trigger reschedules jobs).
    IF v_match.status IN ('signup_open', 'full') THEN
        IF v_confirmed_count >= v_match.max_players THEN
            UPDATE public.matches SET status = 'full'
            WHERE id = p_match_id AND status IS DISTINCT FROM 'full';
        ELSE
            UPDATE public.matches SET status = 'signup_open'
            WHERE id = p_match_id AND status IS DISTINCT FROM 'signup_open';
        END IF;
    END IF;

    RETURN v_promoted_id;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_from_waitlist(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_from_waitlist(UUID) TO service_role;

-- ============================================
-- 3. GUEST PRIORITY (OD-8)
-- ============================================

-- public_guest_signup: 00029 body. New: a guest who would be confirmed is
-- waitlisted while guest_priority_hold() holds (waitlist_reason
-- 'priority_window' or 'reserved', promoted by run_priority_window_close_job
-- or by promote_from_waitlist once the period ends); a full match records
-- waitlist_reason 'full' like signup_for_match. The result includes the reason.
CREATE OR REPLACE FUNCTION public.public_guest_signup(
    p_match_id UUID,
    p_display_name TEXT,
    p_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_match public.matches;
    v_guest_id UUID;
    v_confirmed_count INTEGER;
    v_status signup_status;
    v_reason TEXT;
    v_hold JSONB;
    v_waitlist_position SMALLINT;
    v_signup_id UUID;
    v_name TEXT;
    v_recent INTEGER;
BEGIN
    v_name := btrim(COALESCE(p_display_name, ''));
    IF v_name = '' THEN
        RAISE EXCEPTION 'El nombre no puede estar vacío';
    END IF;

    IF char_length(v_name) > 60 THEN
        RAISE EXCEPTION 'El nombre es demasiado largo';
    END IF;

    IF p_token IS NULL THEN
        RAISE EXCEPTION 'Token inválido';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    IF v_match.status NOT IN ('signup_open', 'full') THEN
        RAISE EXCEPTION 'El partido no está aceptando inscripciones';
    END IF;

    IF now() >= v_match.date_time THEN
        RAISE EXCEPTION 'El partido ya empezó';
    END IF;

    SELECT COUNT(*) INTO v_recent
    FROM public.match_signups ms
    JOIN public.guest_players gp ON gp.id = ms.guest_player_id
    WHERE ms.match_id = p_match_id
      AND gp.self_signup_token IS NOT NULL
      AND ms.signup_time > NOW() - INTERVAL '1 hour';

    IF v_recent >= 10 THEN
        RAISE EXCEPTION 'Demasiadas inscripciones de invitados, probá más tarde';
    END IF;

    -- Reuse the guest_players row tied to this token within this group, if any.
    SELECT id INTO v_guest_id
    FROM public.guest_players
    WHERE self_signup_token = p_token AND group_id = v_match.group_id;

    IF v_guest_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.match_signups
            WHERE match_id = p_match_id AND guest_player_id = v_guest_id
            AND status IN ('confirmed', 'waitlist')
        ) THEN
            RAISE EXCEPTION 'Ya estás inscripto en este partido';
        END IF;

        UPDATE public.guest_players SET display_name = v_name
        WHERE id = v_guest_id;
    ELSE
        INSERT INTO public.guest_players (display_name, group_id, self_signup_token)
        VALUES (v_name, v_match.group_id, p_token)
        RETURNING id INTO v_guest_id;
    END IF;

    SELECT COUNT(*) INTO v_confirmed_count
    FROM public.match_signups
    WHERE match_id = p_match_id AND status = 'confirmed';

    IF v_confirmed_count < v_match.max_players THEN
        v_status := 'confirmed';
        v_reason := NULL;
        -- Members first while the priority policy holds (OD-8).
        v_hold := public.guest_priority_hold(p_match_id);
        IF v_hold IS NOT NULL AND COALESCE((v_hold->>'holds')::boolean, FALSE) THEN
            v_status := 'waitlist';
            v_reason := v_hold->>'reason';
        END IF;
    ELSE
        v_status := 'waitlist';
        v_reason := 'full';
    END IF;

    IF v_status = 'waitlist' THEN
        SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_waitlist_position
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'waitlist';
    ELSE
        v_waitlist_position := NULL;
    END IF;

    -- Upsert: the same guest may have a prior 'cancelled' row for this match.
    INSERT INTO public.match_signups (match_id, guest_player_id, status, waitlist_position, waitlist_reason, signup_time, cancel_time)
    VALUES (p_match_id, v_guest_id, v_status, v_waitlist_position, v_reason, NOW(), NULL)
    ON CONFLICT ON CONSTRAINT unique_guest_signup
    DO UPDATE SET
        status = EXCLUDED.status,
        waitlist_position = EXCLUDED.waitlist_position,
        waitlist_reason = EXCLUDED.waitlist_reason,
        signup_time = NOW(),
        cancel_time = NULL
    RETURNING id INTO v_signup_id;

    IF v_status = 'confirmed' AND v_confirmed_count + 1 >= v_match.max_players
       AND v_match.status = 'signup_open' THEN
        UPDATE public.matches SET status = 'full' WHERE id = p_match_id;
    END IF;

    RETURN jsonb_build_object(
        'signup_id', v_signup_id,
        'status', v_status,
        'waitlist_position', v_waitlist_position,
        'waitlist_reason', v_reason
    );
END;
$$;

REVOKE ALL ON FUNCTION public.public_guest_signup(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_guest_signup(UUID, TEXT, UUID) TO anon, authenticated;

-- ============================================
-- 4. ATTENDANCE-ONLY FINISH (OD-3)
-- ============================================

-- auto_finish_match: 00021 body. New: a match still in signup_open / full /
-- signup_closed also finishes once kickoff + duration has passed, as long as
-- someone was confirmed (an empty list stays for the organizer to cancel).
-- Without teams the result is final at once: stats and badges are computed
-- from attendance and no results flow follows (schedule_match_jobs).
CREATE OR REPLACE FUNCTION public.auto_finish_match(p_match_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_match public.matches;
BEGIN
    IF NOT is_service_role() THEN
        RAISE EXCEPTION 'Esta operación requiere el rol de servicio';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL OR v_match.status NOT IN ('signup_open', 'full', 'signup_closed', 'teams_created') THEN
        RETURN FALSE;
    END IF;
    IF now() < v_match.date_time + (v_match.duration_minutes || ' minutes')::interval THEN
        RETURN FALSE;
    END IF;
    IF v_match.status <> 'teams_created' AND NOT EXISTS (
        SELECT 1 FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'confirmed'
    ) THEN
        RETURN FALSE;
    END IF;

    UPDATE public.matches SET status = 'finished' WHERE id = p_match_id;
    PERFORM emit_attendance_events(p_match_id);
    IF NOT public.match_has_teams(p_match_id) THEN
        PERFORM finalize_match_results(p_match_id);
    END IF;
    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_finish_match(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_finish_match(UUID) TO service_role;

-- admin_set_match_status: 00021 body. New: signup_open / full / signup_closed
-- -> finished for admins and captains once the match has started (the
-- attendance-only finish); search_path pinned.
CREATE OR REPLACE FUNCTION public.admin_set_match_status(p_match_id UUID, p_status public.match_status)
RETURNS public.matches
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_match public.matches;
    v_valid BOOLEAN := FALSE;
    v_final_status match_status;
    v_confirmed_count INTEGER;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    IF NOT is_group_admin_or_captain(v_match.group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para esta acción';
    END IF;

    IF p_status = v_match.status THEN
        RETURN v_match;
    END IF;

    -- Transitions (docs/rework-plan.md §1, OD-3):
    -- draft -> signup_open <-> signup_closed; signup_open <-> full (automatic
    -- on count); any of signup_open/full/signup_closed -> teams_created;
    -- teams_created -> finished; signup_open/full/signup_closed -> finished
    -- after kickoff (attendance only); any non-finished -> cancelled.
    CASE v_match.status
        WHEN 'draft' THEN
            v_valid := p_status IN ('signup_open', 'cancelled');
        WHEN 'signup_open' THEN
            v_valid := p_status IN ('signup_closed', 'full', 'teams_created', 'finished', 'cancelled');
        WHEN 'full' THEN
            v_valid := p_status IN ('signup_closed', 'signup_open', 'teams_created', 'finished', 'cancelled');
        WHEN 'signup_closed' THEN
            v_valid := p_status IN ('signup_open', 'teams_created', 'finished', 'cancelled');
        WHEN 'teams_created' THEN
            v_valid := p_status IN ('finished', 'cancelled');
        ELSE
            v_valid := FALSE;
    END CASE;

    IF NOT v_valid THEN
        RAISE EXCEPTION 'Transición de estado inválida: % -> %', v_match.status, p_status;
    END IF;

    IF p_status = 'finished' AND v_match.status <> 'teams_created' AND now() < v_match.date_time THEN
        RAISE EXCEPTION 'El partido todavía no empezó';
    END IF;

    v_final_status := p_status;

    -- Reopening always targets signup_open in the UI, but if the match is
    -- already at capacity the real status is 'full'.
    IF p_status = 'signup_open' THEN
        SELECT COUNT(*) INTO v_confirmed_count
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'confirmed';

        IF v_confirmed_count >= v_match.max_players THEN
            v_final_status := 'full';
        END IF;
    END IF;

    UPDATE public.matches SET status = v_final_status WHERE id = p_match_id
    RETURNING * INTO v_match;

    IF v_final_status = 'finished' THEN
        PERFORM emit_attendance_events(p_match_id);
        IF NOT public.match_has_teams(p_match_id) THEN
            PERFORM finalize_match_results(p_match_id);
            SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
        END IF;
    ELSIF v_final_status = 'cancelled' THEN
        PERFORM recompute_member_score(v_match.group_id, x.player_id)
        FROM (
            SELECT DISTINCT e.player_id FROM public.member_events e
            WHERE e.match_id = p_match_id AND e.type IN ('early_cancel', 'late_cancel')
        ) x;
    END IF;

    RETURN v_match;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_match_status(UUID, public.match_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_match_status(UUID, public.match_status) TO authenticated, service_role;

-- schedule_match_jobs: 00026 body. New: a finished match without teams gets
-- no results_request / results_reminder / results_window_close jobs.
CREATE OR REPLACE FUNCTION public.schedule_match_jobs(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_match public.matches;
    v_settings public.notification_settings;
    v_request_at TIMESTAMPTZ;
    v_window_days INTEGER;
    v_reminder_hours INTEGER;
    v_scoring JSONB;
    v_mode TEXT;
    v_window_hours NUMERIC;
    v_window_at TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL THEN
        RETURN;
    END IF;

    UPDATE public.scheduled_jobs
    SET status = 'cancelled'
    WHERE match_id = p_match_id AND status = 'pending';

    SELECT * INTO v_settings FROM public.notification_settings WHERE group_id = v_match.group_id;
    v_window_days := COALESCE(v_settings.results_window_days, 7);
    v_reminder_hours := COALESCE(v_settings.results_reminder_hours, 24);

    IF v_match.status IN ('signup_open', 'signup_closed', 'full', 'teams_created') THEN
        INSERT INTO public.scheduled_jobs (group_id, match_id, job_type, run_at)
        VALUES (v_match.group_id, p_match_id, 'auto_finish',
                v_match.date_time + (v_match.duration_minutes || ' minutes')::interval);

        IF v_match.status IN ('signup_open', 'full') THEN
            v_scoring := member_scoring_settings(v_match.group_id);
            v_mode := COALESCE(v_scoring->'priority'->>'mode', 'off');
            v_window_hours := COALESCE((v_scoring->'priority'->>'window_hours')::numeric, 24);
            IF COALESCE((v_scoring->>'enabled')::boolean, false) AND v_mode IN ('window', 'reserved') THEN
                v_window_at := CASE v_mode
                    WHEN 'window' THEN v_match.signup_opened_at + (v_window_hours || ' hours')::interval
                    ELSE v_match.date_time - (v_window_hours || ' hours')::interval
                END;
                IF v_window_at IS NOT NULL AND v_window_at > now() THEN
                    INSERT INTO public.scheduled_jobs (group_id, match_id, job_type, run_at)
                    VALUES (v_match.group_id, p_match_id, 'priority_window_close', v_window_at);
                END IF;
            END IF;
        END IF;
        RETURN;
    END IF;

    -- Attendance only (OD-3): nothing to report, remind or close.
    IF v_match.status = 'finished' AND NOT public.match_has_teams(p_match_id) THEN
        RETURN;
    END IF;

    IF v_match.status = 'finished' AND v_match.result_status <> 'locked' THEN
        v_request_at := COALESCE(v_match.finished_at, now())
            + (v_match.results_request_delay_minutes || ' minutes')::interval;

        INSERT INTO public.scheduled_jobs (group_id, match_id, job_type, run_at, payload)
        VALUES (v_match.group_id, p_match_id, 'results_request', v_request_at,
                jsonb_build_object('app_url', COALESCE(current_setting('app.settings.app_url', true), '')));

        IF v_reminder_hours > 0 THEN
            INSERT INTO public.scheduled_jobs (group_id, match_id, job_type, run_at, payload)
            VALUES (v_match.group_id, p_match_id, 'results_reminder',
                    v_request_at + (v_reminder_hours || ' hours')::interval,
                    jsonb_build_object('app_url', COALESCE(current_setting('app.settings.app_url', true), '')));
        END IF;

        INSERT INTO public.scheduled_jobs (group_id, match_id, job_type, run_at)
        VALUES (v_match.group_id, p_match_id, 'results_window_close',
                COALESCE(v_match.finished_at, v_match.date_time + (v_match.duration_minutes || ' minutes')::interval)
                    + (v_window_days || ' days')::interval);
    END IF;
    -- cancelled / draft / locked: nothing to schedule.
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_match_jobs(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_match_jobs(UUID) TO authenticated, service_role;

-- run_scheduled_job: 00021 body. New: results jobs of a match without teams
-- (queued before this migration, or before a status change) are closed as
-- done without running, so no results_request / results_reminder /
-- results_needs_review goes out for an attendance-only match.
CREATE OR REPLACE FUNCTION public.run_scheduled_job(p_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_job public.scheduled_jobs;
    v_ok BOOLEAN := FALSE;
    v_error TEXT;
BEGIN
    IF NOT is_service_role() THEN
        RAISE EXCEPTION 'Esta operación requiere el rol de servicio';
    END IF;

    SELECT * INTO v_job FROM public.scheduled_jobs WHERE id = p_job_id FOR UPDATE;
    IF v_job IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'job not found');
    END IF;
    IF v_job.status IN ('done', 'cancelled') THEN
        RETURN jsonb_build_object('job_type', v_job.job_type, 'match_id', v_job.match_id,
                                  'ok', true, 'skipped', v_job.status);
    END IF;

    IF v_job.job_type IN ('results_request', 'results_reminder', 'results_window_close')
       AND NOT public.match_has_teams(v_job.match_id) THEN
        UPDATE public.scheduled_jobs
        SET status = 'done', last_error = NULL, locked_at = NULL
        WHERE id = p_job_id;
        RETURN jsonb_build_object('job_type', v_job.job_type, 'match_id', v_job.match_id,
                                  'ok', true, 'acted', false, 'skipped', 'attendance_only');
    END IF;

    BEGIN
        CASE v_job.job_type
            WHEN 'auto_finish' THEN
                v_ok := auto_finish_match(v_job.match_id);
            WHEN 'results_request' THEN
                v_ok := run_results_request_job(v_job.match_id, v_job.payload);
            WHEN 'results_reminder' THEN
                v_ok := run_results_reminder_job(v_job.match_id, v_job.payload);
            WHEN 'results_window_close' THEN
                v_ok := run_results_window_close_job(v_job.match_id);
            WHEN 'priority_window_close' THEN
                v_ok := run_priority_window_close_job(v_job.match_id);
            ELSE
                RAISE EXCEPTION 'Tipo de job desconocido: %', v_job.job_type;
        END CASE;

        UPDATE public.scheduled_jobs
        SET status = 'done', last_error = NULL, locked_at = NULL
        WHERE id = p_job_id;

        RETURN jsonb_build_object('job_type', v_job.job_type, 'match_id', v_job.match_id,
                                  'ok', true, 'acted', v_ok);
    EXCEPTION WHEN OTHERS THEN
        v_error := SQLERRM;
    END;

    -- The handler's work was rolled back with the exception block; record it.
    IF v_job.attempts >= 5 THEN
        UPDATE public.scheduled_jobs
        SET status = 'failed', last_error = v_error, locked_at = NULL
        WHERE id = p_job_id;
    ELSE
        UPDATE public.scheduled_jobs
        SET status = 'pending', last_error = v_error, locked_at = NULL,
            run_at = now() + (GREATEST(v_job.attempts, 1) * 2 || ' minutes')::interval
        WHERE id = p_job_id;
    END IF;

    RETURN jsonb_build_object('job_type', v_job.job_type, 'match_id', v_job.match_id,
                              'ok', false, 'error', v_error);
END;
$$;

REVOKE ALL ON FUNCTION public.run_scheduled_job(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_scheduled_job(UUID) TO service_role;

-- submit_match_report: 00021 body. New: an attendance-only match has no
-- result to report (and no MVP vote, which rides on the report).
CREATE OR REPLACE FUNCTION public.submit_match_report(
    p_match_id UUID,
    p_dark_score INTEGER,
    p_light_score INTEGER,
    p_dark_goals_complete BOOLEAN,
    p_light_goals_complete BOOLEAN,
    p_mvp_candidate_id UUID,
    p_stats JSONB
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_match public.matches;
    v_player_id UUID;
    v_report_id UUID;
    v_stat JSONB;
    v_team_id UUID;
    v_pid UUID;
    v_gid UUID;
    v_goals INTEGER;
    v_assists INTEGER;
    v_stat_rows INTEGER := 0;
    v_after_lock BOOLEAN;
BEGIN
    v_player_id := get_current_player_id();
    IF v_player_id IS NULL THEN
        RAISE EXCEPTION 'No tenés perfil de jugador';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;
    IF v_match.status <> 'finished' THEN
        RAISE EXCEPTION 'El partido todavía no terminó';
    END IF;
    IF NOT public.match_has_teams(p_match_id) THEN
        RAISE EXCEPTION 'Este partido se cerró sin equipos: no hay resultado para reportar';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.match_signups ms
        WHERE ms.match_id = p_match_id AND ms.player_id = v_player_id AND ms.status = 'confirmed'
    ) THEN
        RAISE EXCEPTION 'No jugaste este partido';
    END IF;
    IF NOT match_report_window_open(p_match_id) THEN
        RAISE EXCEPTION 'La ventana para reportar cerró';
    END IF;
    IF p_mvp_candidate_id IS NOT NULL THEN
        IF p_mvp_candidate_id = v_player_id THEN
            RAISE EXCEPTION 'No podés votarte a vos mismo';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.match_signups ms
            WHERE ms.match_id = p_match_id AND ms.player_id = p_mvp_candidate_id AND ms.status = 'confirmed'
        ) THEN
            RAISE EXCEPTION 'El MVP tiene que haber jugado este partido';
        END IF;
    END IF;
    IF (p_dark_score IS NOT NULL AND p_dark_score NOT BETWEEN 0 AND 99)
       OR (p_light_score IS NOT NULL AND p_light_score NOT BETWEEN 0 AND 99) THEN
        RAISE EXCEPTION 'Resultado inválido';
    END IF;

    v_after_lock := (v_match.result_status = 'locked');

    INSERT INTO public.match_reports (
        match_id, reporter_player_id, dark_score, light_score,
        dark_goals_complete, light_goals_complete, mvp_candidate_id, submitted_after_lock
    )
    VALUES (
        p_match_id, v_player_id, p_dark_score, p_light_score,
        COALESCE(p_dark_goals_complete, FALSE), COALESCE(p_light_goals_complete, FALSE),
        p_mvp_candidate_id, v_after_lock
    )
    ON CONFLICT (match_id, reporter_player_id) DO UPDATE SET
        dark_score = EXCLUDED.dark_score,
        light_score = EXCLUDED.light_score,
        dark_goals_complete = EXCLUDED.dark_goals_complete,
        light_goals_complete = EXCLUDED.light_goals_complete,
        mvp_candidate_id = EXCLUDED.mvp_candidate_id,
        submitted_after_lock = EXCLUDED.submitted_after_lock
    RETURNING id INTO v_report_id;

    DELETE FROM public.match_report_stats WHERE report_id = v_report_id;

    IF p_stats IS NOT NULL AND jsonb_typeof(p_stats) = 'array' THEN
        FOR v_stat IN SELECT * FROM jsonb_array_elements(p_stats) LOOP
            v_team_id := NULLIF(v_stat->>'team_id', '')::UUID;
            v_pid := NULLIF(v_stat->>'player_id', '')::UUID;
            v_gid := NULLIF(v_stat->>'guest_player_id', '')::UUID;
            v_goals := GREATEST(0, COALESCE((v_stat->>'goals')::INTEGER, 0));
            v_assists := GREATEST(0, COALESCE((v_stat->>'assists')::INTEGER, 0));

            IF v_goals = 0 AND v_assists = 0 THEN
                CONTINUE;
            END IF;
            IF v_team_id IS NULL OR NOT EXISTS (
                SELECT 1 FROM public.teams t WHERE t.id = v_team_id AND t.match_id = p_match_id
            ) THEN
                RAISE EXCEPTION 'Equipo inválido en el reporte';
            END IF;
            IF (v_pid IS NULL) = (v_gid IS NULL) THEN
                RAISE EXCEPTION 'Jugador inválido en el reporte';
            END IF;

            INSERT INTO public.match_report_stats (report_id, team_id, player_id, guest_player_id, goals, assists)
            VALUES (v_report_id, v_team_id, v_pid, v_gid, LEAST(v_goals, 99), LEAST(v_assists, 99))
            ON CONFLICT (report_id, team_id, COALESCE(player_id, guest_player_id)) DO UPDATE SET
                goals = LEAST(99, match_report_stats.goals + EXCLUDED.goals),
                assists = LEAST(99, match_report_stats.assists + EXCLUDED.assists);
            v_stat_rows := v_stat_rows + 1;
        END LOOP;
    END IF;

    IF p_dark_score IS NULL AND p_light_score IS NULL AND p_mvp_candidate_id IS NULL AND v_stat_rows = 0 THEN
        DELETE FROM public.match_reports WHERE id = v_report_id;
        RAISE EXCEPTION 'El reporte está vacío';
    END IF;

    -- MVP vote sync (the votes trigger recomputes the MVP, inert while locked).
    DELETE FROM public.match_mvp_votes WHERE match_id = p_match_id AND voter_player_id = v_player_id;
    IF p_mvp_candidate_id IS NOT NULL THEN
        INSERT INTO public.match_mvp_votes (match_id, voter_player_id, candidate_player_id)
        VALUES (p_match_id, v_player_id, p_mvp_candidate_id);
    END IF;

    -- Member score: a usable report counts as participation (§3.1).
    IF NOT v_after_lock THEN
        PERFORM insert_member_event(v_match.group_id, v_player_id, p_match_id, NULL, 'reported_result', 'system');
    ELSE
        DELETE FROM public.member_events
        WHERE group_id = v_match.group_id AND player_id = v_player_id
        AND match_id = p_match_id AND type = 'reported_result';
    END IF;
    PERFORM recompute_member_score(v_match.group_id, v_player_id);

    IF NOT v_after_lock THEN
        PERFORM recompute_match_consensus(p_match_id);
    END IF;

    RETURN v_report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_match_report(UUID, INTEGER, INTEGER, BOOLEAN, BOOLEAN, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_match_report(UUID, INTEGER, INTEGER, BOOLEAN, BOOLEAN, UUID, JSONB) TO authenticated, service_role;

-- Direct MVP votes (00020 policy, unused by the app since votes ride on the
-- report) follow the same rule: no MVP for an attendance-only match.
DROP POLICY IF EXISTS "Players can vote MVP" ON public.match_mvp_votes;
CREATE POLICY "Players can vote MVP"
    ON public.match_mvp_votes FOR INSERT
    WITH CHECK (
        voter_player_id = get_current_player_id()
        AND candidate_player_id <> get_current_player_id()
        AND match_report_window_open(match_id)
        AND public.match_has_teams(match_id)
        AND EXISTS (
            SELECT 1 FROM public.match_signups ms
            WHERE ms.match_id = match_mvp_votes.match_id
              AND ms.player_id = get_current_player_id()
              AND ms.status = 'confirmed'
        )
    );
