-- Notifications and post-match fixes (docs/review/recheck-2026-09-24.md, area E).
--
--   * One visibility rule for in-app notifications (E#26, A-N6, A-S1):
--     notification_visible_to() combines the device-push audience, the user's
--     notification_prefs, the "rate the new member" self-exclusion and the
--     "already reported" rule for results_reminder. list_my_notifications(),
--     get_unread_notification_count() and mark_all_notifications_read() all use
--     it, so the unread dot always matches what /notifications shows and can be
--     cleared.
--   * match_reminder goes to the confirmed players of the match only (E#28), in
--     the app and on devices.
--   * match_cancelled (E#37): emitted when a match with signups is cancelled
--     before it starts, shown to the players who were confirmed.
--   * WhatsApp outbox drain claims rows atomically (E#31): claim_notification_outbox
--     (FOR UPDATE SKIP LOCKED, status 'sending' + claimed_at/lease_id, stale
--     claims recovered after 10 minutes), so the ticker, the daily cron and page
--     loads never send the same row twice at the same time.
--   * Webhook URL must be https (E#22), reminder hours must be 0..48 (E#29).
--     Both constraints are NOT VALID: they bind every new write without failing
--     on rows saved before; the settings form validates the same rules.
--   * match_created carries spots_left (E#30) so the text says how many places
--     are left, not the capacity.
--   * No-show toggled after the match finished recomputes the player's counters
--     and the match badges (E#6).
--   * The report/rating window runs from finished_at (fallback: start + duration),
--     not from the start time (E#10).
--   * emit_notification accepts direct database sessions (no JWT claims) again,
--     so the seed and SQL jobs can insert signup_open matches.

-- ============================================
-- 1. SETTINGS CONSTRAINTS
-- ============================================

ALTER TABLE public.notification_settings DROP CONSTRAINT IF EXISTS notification_settings_webhook_https_check;
ALTER TABLE public.notification_settings ADD CONSTRAINT notification_settings_webhook_https_check
    CHECK (whatsapp_webhook_url IS NULL OR whatsapp_webhook_url ~* '^https://[^/?#[:space:]]+') NOT VALID;

ALTER TABLE public.notification_settings DROP CONSTRAINT IF EXISTS notification_settings_reminder_hours_check;
ALTER TABLE public.notification_settings ADD CONSTRAINT notification_settings_reminder_hours_check
    CHECK (reminder_hours_before IS NULL OR reminder_hours_before BETWEEN 0 AND 48) NOT VALID;

-- ============================================
-- 2. AUDIENCE AND VISIBILITY
-- ============================================

-- 00022 body plus match_reminder (confirmed players of the match, read live so
-- a player who dropped out stops seeing it) and match_cancelled (the players
-- who were confirmed when it was cancelled, frozen in payload.player_ids).
CREATE OR REPLACE FUNCTION public.push_audience_matches(n public.notifications, player UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT (n.recipient_player_id IS NULL OR n.recipient_player_id = player)
       AND CASE n.type
         WHEN 'waitlist_promoted' THEN n.recipient_player_id = player
         WHEN 'results_request' THEN
           n.payload->'player_ids' IS NULL OR COALESCE(n.payload->'player_ids' ? player::TEXT, FALSE)
         WHEN 'results_reminder' THEN COALESCE(n.payload->'pending_player_ids' ? player::TEXT, FALSE)
         WHEN 'match_reminder' THEN EXISTS (
           SELECT 1 FROM public.match_signups ms
           WHERE ms.match_id = n.match_id AND ms.player_id = player AND ms.status = 'confirmed')
         WHEN 'match_cancelled' THEN COALESCE(n.payload->'player_ids' ? player::TEXT, FALSE)
         ELSE TRUE
       END;
$$;

-- The in-app rule: device-push audience, the user's per-type prefs (a missing
-- key means on), never nudge the new member to rate themselves, and a results
-- reminder disappears once that player has reported.
CREATE OR REPLACE FUNCTION public.notification_visible_to(n public.notifications, p_player UUID, p_prefs JSONB)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT public.push_audience_matches(n, p_player)
       AND (p_prefs->n.type) IS DISTINCT FROM 'false'::jsonb
       AND NOT (n.type = 'rate_new_member' AND n.payload->>'player_id' = p_player::TEXT)
       AND (n.type <> 'results_reminder' OR NOT EXISTS (
            SELECT 1 FROM public.match_reports r
            WHERE r.match_id = n.match_id AND r.reporter_player_id = p_player));
$$;

-- The current player's notifications (active groups only), newest first, with
-- their own read state. Replaces the direct table read on /notifications.
CREATE OR REPLACE FUNCTION public.list_my_notifications(p_limit INTEGER DEFAULT 100)
RETURNS TABLE (
    id UUID,
    group_id UUID,
    match_id UUID,
    recipient_player_id UUID,
    type TEXT,
    payload JSONB,
    created_at TIMESTAMPTZ,
    is_read BOOLEAN
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_player_id UUID;
    v_prefs JSONB;
BEGIN
    v_player_id := get_current_player_id();
    IF v_player_id IS NULL THEN
        RETURN;
    END IF;
    SELECT u.notification_prefs INTO v_prefs FROM public.users u WHERE u.id = auth.uid();

    RETURN QUERY
    SELECT n.id, n.group_id, n.match_id, n.recipient_player_id, n.type, n.payload, n.created_at,
           EXISTS (SELECT 1 FROM public.notification_reads nr
                   WHERE nr.notification_id = n.id AND nr.player_id = v_player_id)
    FROM public.notifications n
    JOIN public.group_memberships gm
        ON gm.group_id = n.group_id AND gm.player_id = v_player_id AND gm.is_active = TRUE
    WHERE public.notification_visible_to(n, v_player_id, COALESCE(v_prefs, '{}'::jsonb))
    ORDER BY n.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
END;
$$;

-- 00012 body with the same visibility rule as the list.
CREATE OR REPLACE FUNCTION get_unread_notification_count()
RETURNS INTEGER AS $$
DECLARE
    v_player_id UUID;
    v_prefs JSONB;
    v_count INTEGER;
BEGIN
    v_player_id := get_current_player_id();
    IF v_player_id IS NULL THEN
        RETURN 0;
    END IF;
    SELECT u.notification_prefs INTO v_prefs FROM public.users u WHERE u.id = auth.uid();

    SELECT COUNT(*) INTO v_count
    FROM public.notifications n
    JOIN public.group_memberships gm
        ON gm.group_id = n.group_id AND gm.player_id = v_player_id AND gm.is_active = TRUE
    WHERE public.notification_visible_to(n, v_player_id, COALESCE(v_prefs, '{}'::jsonb))
      AND NOT EXISTS (
          SELECT 1 FROM public.notification_reads nr
          WHERE nr.notification_id = n.id AND nr.player_id = v_player_id
      );

    RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- "Marcar todo como leído": every visible unread row, not only the ones the
-- page happened to load, so the dot always clears.
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_player_id UUID;
    v_prefs JSONB;
BEGIN
    v_player_id := get_current_player_id();
    IF v_player_id IS NULL THEN
        RAISE EXCEPTION 'Perfil de jugador no encontrado';
    END IF;
    SELECT u.notification_prefs INTO v_prefs FROM public.users u WHERE u.id = auth.uid();

    INSERT INTO public.notification_reads (notification_id, player_id)
    SELECT n.id, v_player_id
    FROM public.notifications n
    JOIN public.group_memberships gm
        ON gm.group_id = n.group_id AND gm.player_id = v_player_id AND gm.is_active = TRUE
    WHERE public.notification_visible_to(n, v_player_id, COALESCE(v_prefs, '{}'::jsonb))
    ON CONFLICT (notification_id, player_id) DO NOTHING;
END;
$$;

-- ============================================
-- 3. MATCH CREATED: SPOTS LEFT
-- ============================================

-- 00022 body plus spots_left (capacity minus confirmed signups when the list opens).
CREATE OR REPLACE FUNCTION public.notify_signup_opened()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_name TEXT;
    v_confirmed INTEGER;
BEGIN
    IF NEW.status <> 'signup_open' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD.signup_opened_at IS NOT NULL THEN RETURN NEW; END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM public.notifications WHERE match_id = NEW.id AND type = 'match_created') THEN
        RETURN NEW;
    END IF;
    SELECT name INTO v_name FROM public.groups WHERE id = NEW.group_id;
    SELECT COUNT(*) INTO v_confirmed FROM public.match_signups
    WHERE match_id = NEW.id AND status = 'confirmed';
    PERFORM public.emit_notification(NEW.group_id, NEW.id, 'match_created', jsonb_build_object(
        'match_id', NEW.id, 'group_name', v_name, 'date_time', NEW.date_time,
        'location', NEW.location, 'max_players', NEW.max_players,
        'spots_left', GREATEST(NEW.max_players - v_confirmed, 0), 'signup_url', '/m/' || NEW.id
    ));
    RETURN NEW;
END;
$$;

-- ============================================
-- 4. MATCH CANCELLED
-- ============================================

CREATE OR REPLACE FUNCTION public.notify_match_cancelled()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_name TEXT;
    v_players JSONB;
BEGIN
    IF NEW.status <> 'cancelled' OR OLD.status = NEW.status THEN RETURN NEW; END IF;
    -- Drafts were never announced and past matches are moot.
    IF OLD.status NOT IN ('signup_open', 'signup_closed', 'full', 'teams_created') THEN RETURN NEW; END IF;
    IF NEW.date_time <= now() THEN RETURN NEW; END IF;

    SELECT name INTO v_name FROM public.groups WHERE id = NEW.group_id;
    SELECT COALESCE(jsonb_agg(ms.player_id), '[]'::jsonb) INTO v_players
    FROM public.match_signups ms
    WHERE ms.match_id = NEW.id AND ms.status = 'confirmed' AND ms.player_id IS NOT NULL;

    PERFORM public.emit_notification(NEW.group_id, NEW.id, 'match_cancelled', jsonb_build_object(
        'match_id', NEW.id, 'group_name', v_name, 'date_time', NEW.date_time,
        'location', NEW.location, 'player_ids', v_players
    ));
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS matches_notify_cancelled ON public.matches;
CREATE TRIGGER matches_notify_cancelled AFTER UPDATE OF status ON public.matches
    FOR EACH ROW EXECUTE FUNCTION public.notify_match_cancelled();

-- 00022 body plus match_cancelled in the lock-screen list.
CREATE OR REPLACE FUNCTION public.enqueue_device_push()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    -- Keep sensitive rating/admin nudges in the app, off lock screens.
    IF NEW.type NOT IN ('match_created', 'waitlist_promoted', 'teams_created',
        'match_reminder', 'match_cancelled', 'results_posted', 'results_request', 'results_reminder') THEN
        RETURN NEW;
    END IF;
    INSERT INTO public.push_deliveries(notification_id, subscription_id)
    SELECT NEW.id, s.id
    FROM public.push_subscriptions s
    JOIN public.users u ON u.id = s.user_id
    JOIN public.player_profiles p ON p.user_id = u.id
    JOIN public.group_memberships gm ON gm.player_id = p.id AND gm.group_id = NEW.group_id AND gm.is_active
    WHERE public.push_audience_matches(NEW, p.id)
      AND (u.notification_prefs->NEW.type) IS DISTINCT FROM 'false'::jsonb
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

-- ============================================
-- 5. WHATSAPP OUTBOX CLAIM
-- ============================================

ALTER TABLE public.notification_outbox
    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS lease_id UUID;
-- status: pending | sending | sent | failed

CREATE INDEX IF NOT EXISTS idx_notification_outbox_claimable
    ON public.notification_outbox(created_at) WHERE status IN ('pending', 'sending');

CREATE OR REPLACE FUNCTION public.claim_notification_outbox(p_limit INTEGER DEFAULT 20)
RETURNS SETOF JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    -- A drain that died after claiming (crash, function timeout) leaves rows in
    -- 'sending'. The attempt was already counted at claim time.
    UPDATE public.notification_outbox
    SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
        last_error = COALESCE(last_error, 'Envío interrumpido'),
        claimed_at = NULL,
        lease_id = NULL
    WHERE status = 'sending' AND claimed_at < now() - interval '10 minutes';

    RETURN QUERY
    WITH due AS (
        SELECT o.id FROM public.notification_outbox o
        WHERE o.status = 'pending' AND o.attempts < 5 AND o.channel = 'whatsapp_webhook'
        ORDER BY o.created_at
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
        FOR UPDATE SKIP LOCKED
    ), claimed AS (
        UPDATE public.notification_outbox o
        SET status = 'sending', claimed_at = now(), lease_id = gen_random_uuid(), attempts = o.attempts + 1
        FROM due WHERE o.id = due.id
        RETURNING o.*
    )
    SELECT jsonb_build_object(
        'id', c.id, 'lease_id', c.lease_id, 'group_id', c.group_id, 'type', c.type,
        'payload', c.payload, 'channel', c.channel, 'attempts', c.attempts,
        'webhook_url', ns.whatsapp_webhook_url, 'timezone', g.timezone
    )
    FROM claimed c
    LEFT JOIN public.notification_settings ns ON ns.group_id = c.group_id
    LEFT JOIN public.groups g ON g.id = c.group_id
    ORDER BY c.created_at;
END;
$$;

-- ============================================
-- 6. NO-SHOW AFTER FINISH
-- ============================================

-- 00021 body plus, on a finished match, the player's counters (matches_played
-- and the rest, via recompute_player_stats) and the match badges.
CREATE OR REPLACE FUNCTION admin_set_signup_status(
    p_signup_id UUID,
    p_status signup_status
)
RETURNS void AS $$
DECLARE
    v_signup public.match_signups;
    v_match public.matches;
    v_was_confirmed BOOLEAN;
BEGIN
    SELECT * INTO v_signup FROM public.match_signups WHERE id = p_signup_id FOR UPDATE;
    IF v_signup IS NULL THEN
        RAISE EXCEPTION 'Inscripción no encontrada';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = v_signup.match_id;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    IF NOT is_group_admin_or_captain(v_match.group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para esta acción';
    END IF;

    v_was_confirmed := v_signup.status = 'confirmed';

    UPDATE public.match_signups
    SET status = p_status,
        cancel_time = CASE WHEN p_status = 'cancelled' THEN NOW() ELSE cancel_time END,
        waitlist_position = CASE WHEN p_status = 'waitlist' THEN waitlist_position ELSE NULL END,
        waitlist_reason = CASE WHEN p_status = 'waitlist' THEN waitlist_reason ELSE NULL END
    WHERE id = p_signup_id;

    -- Only promote while the match is still tracking signups; a no-show on a finished
    -- match must not pull someone off the waitlist.
    IF v_was_confirmed AND p_status != 'confirmed'
       AND v_match.status IN ('signup_open', 'full', 'signup_closed') THEN
        PERFORM promote_from_waitlist(v_match.id);
    END IF;

    IF v_match.status = 'finished' THEN
        PERFORM emit_attendance_events(v_match.id);
        IF v_signup.player_id IS NOT NULL THEN
            PERFORM recompute_player_stats(v_signup.player_id);
        END IF;
        PERFORM award_badges_for_match(v_match.id);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 7. REPORT WINDOW FROM THE END OF THE MATCH
-- ============================================

-- 00020 body, counted from finished_at (fallback: start + duration).
CREATE OR REPLACE FUNCTION match_report_window_open(p_match_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_match public.matches;
    v_days INTEGER;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL OR v_match.status <> 'finished' THEN
        RETURN FALSE;
    END IF;
    SELECT COALESCE(ns.results_window_days, 7) INTO v_days
    FROM public.notification_settings ns WHERE ns.group_id = v_match.group_id;
    RETURN COALESCE(v_match.finished_at, v_match.date_time + (v_match.duration_minutes || ' minutes')::interval)
        > now() - (COALESCE(v_days, 7) || ' days')::interval;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 00021 body; results_window_close now runs at the end of the same window.
CREATE OR REPLACE FUNCTION schedule_match_jobs(p_match_id UUID)
RETURNS void AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 8. PRIVILEGES
-- ============================================

REVOKE ALL ON FUNCTION public.notification_visible_to(public.notifications, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_match_cancelled() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_notification_outbox(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_outbox(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.list_my_notifications(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_notifications(INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;

-- ============================================
-- 9. EMIT_NOTIFICATION FROM A DIRECT DB SESSION (00022 body)
-- ============================================
-- 00022's membership check also rejected callers with no JWT at all, so a
-- signup_open match inserted by the seed (or any SQL job running as postgres)
-- failed in notify_signup_opened with 'No sos miembro de este grupo'. Only the
-- authorization check changes: a session without request.jwt.claims passes.

CREATE OR REPLACE FUNCTION emit_notification(
    p_group_id UUID,
    p_match_id UUID,
    p_type TEXT,
    p_payload JSONB
)
RETURNS void AS $$
DECLARE
    v_settings public.notification_settings;
    v_should_emit BOOLEAN := TRUE;
    v_recipient_player_id UUID;
    v_claims JSONB;
BEGIN
    IF p_group_id IS NULL OR p_type IS NULL THEN
        RETURN;
    END IF;

    -- Authorization: the caller must be a member of the target group, or be
    -- the service role (cron/recurring, cron/reminders and the match-created
    -- helper all emit via the admin/service-role client on behalf of the
    -- whole system, not a single acting member). Without this, any
    -- authenticated user could call this SECURITY DEFINER RPC directly with
    -- an arbitrary p_group_id and forge notifications/webhook sends into a
    -- group they don't belong to. Mirrors the same-shaped check in
    -- generate_recurring_matches (00010_recurring_matches.sql).
    -- A direct database session (seed, migrations, pg_cron) carries no JWT
    -- claims at all and is trusted like the service role. API callers always
    -- have a role claim ('anon', 'authenticated' or 'service_role').
    -- (The setting reads as '' rather than NULL once any earlier transaction in
    -- the session set it locally, hence the NULLIF.)
    v_claims := COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    IF COALESCE(v_claims->>'role', '') <> 'service_role'
       AND v_claims ? 'role'
       AND NOT is_group_member(p_group_id) THEN
        RAISE EXCEPTION 'No sos miembro de este grupo';
    END IF;

    -- The ticker, daily cron and page loads may race. Serialize events which
    -- should only happen once per match; repeated results/team events remain valid.
    IF p_type IN ('match_created', 'match_reminder') AND p_match_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(p_match_id::TEXT || p_type, 0));
        IF EXISTS (SELECT 1 FROM public.notifications WHERE match_id = p_match_id AND type = p_type) THEN
            RETURN;
        END IF;
    END IF;

    SELECT * INTO v_settings FROM public.notification_settings WHERE group_id = p_group_id;

    -- Toggle mapping (§2.6): reminders and results_posted always fire.
    CASE p_type
        WHEN 'waitlist_promoted' THEN
            v_should_emit := COALESCE(v_settings.notify_on_waitlist_promotion, TRUE);
        WHEN 'teams_created' THEN
            v_should_emit := COALESCE(v_settings.notify_on_teams_created, TRUE);
        WHEN 'match_created' THEN
            v_should_emit := COALESCE(v_settings.send_signup_link_on_create, TRUE);
        ELSE
            v_should_emit := TRUE;
    END CASE;

    IF NOT v_should_emit THEN
        RETURN;
    END IF;

    v_recipient_player_id := NULLIF(p_payload->>'recipient_player_id', '')::UUID;

    INSERT INTO public.notifications (group_id, match_id, recipient_player_id, type, payload)
    VALUES (p_group_id, p_match_id, v_recipient_player_id, p_type, COALESCE(p_payload, '{}'::jsonb));

    IF v_settings.whatsapp_webhook_url IS NOT NULL AND btrim(v_settings.whatsapp_webhook_url) <> '' THEN
        INSERT INTO public.notification_outbox (group_id, match_id, type, payload, channel)
        VALUES (p_group_id, p_match_id, p_type, COALESCE(p_payload, '{}'::jsonb), 'whatsapp_webhook');
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
