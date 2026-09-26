-- Notifications: match changes, lineup changes, reminder dedupe and outbox
-- robustness (docs/review/recheck-2026-09-24.md; fix track notifications-i18n).
--
--   * match_updated (PM-6/MATCH-3): an announced match whose date, time or
--     location changes notifies the players who were signed up (confirmed and
--     waitlist, frozen in payload.player_ids), in the app, on devices and in the
--     group's WhatsApp.
--   * match_reminder dedupe (PM-6): emit_notification used to allow one
--     reminder per match forever, so a rescheduled match never got a new one.
--     A reminder is now a duplicate only when one already exists for the same
--     payload.date_time. Rows written before this migration have no date_time:
--     they count as a duplicate unless a match_updated came after them.
--   * lineup_changed (MATCH-1/TS-1): a confirmed player (or guest) who drops out
--     after the teams were published notifies the group's admins and captains,
--     one in-app row each, with who left and who came in from the waitlist.
--     It is emitted at commit (deferred constraint trigger) so the promotion
--     that happens later in the same transaction is included. It inserts the
--     rows directly (like results_needs_review) because the cancel can come
--     from an anonymous guest, whom emit_notification would reject.
--   * WhatsApp outbox (PM-7): failed sends wait with exponential backoff
--     (available_at), and rows that no longer make sense are marked 'skipped'
--     instead of being sent late: anything older than 24 hours, pre-match
--     messages for a match that is cancelled, finished or already started, and
--     a cancellation notice once the match time has passed.

-- ============================================
-- 1. AUDIENCE AND VISIBILITY
-- ============================================

-- 00026 body plus match_updated (the players signed up when it changed) and
-- lineup_changed (addressed to one admin or captain per row).
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
         WHEN 'match_updated' THEN COALESCE(n.payload->'player_ids' ? player::TEXT, FALSE)
         WHEN 'lineup_changed' THEN n.recipient_player_id = player
         ELSE TRUE
       END;
$$;

-- 00026 body plus match_updated and lineup_changed on lock screens.
CREATE OR REPLACE FUNCTION public.enqueue_device_push()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    -- Keep sensitive rating/admin nudges in the app, off lock screens.
    IF NEW.type NOT IN ('match_created', 'waitlist_promoted', 'teams_created',
        'match_reminder', 'match_cancelled', 'match_updated', 'lineup_changed',
        'results_posted', 'results_request', 'results_reminder') THEN
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
-- 2. MATCH UPDATED
-- ============================================

CREATE OR REPLACE FUNCTION public.notify_match_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_name TEXT;
    v_players JSONB;
BEGIN
    IF NEW.date_time IS NOT DISTINCT FROM OLD.date_time
       AND NEW.location IS NOT DISTINCT FROM OLD.location THEN
        RETURN NEW;
    END IF;
    -- Only matches the group already heard about, and only while they are
    -- still ahead (an edit after kick-off is a correction, not news).
    IF OLD.status NOT IN ('signup_open', 'signup_closed', 'full', 'teams_created')
       OR NEW.status NOT IN ('signup_open', 'signup_closed', 'full', 'teams_created') THEN
        RETURN NEW;
    END IF;
    IF NEW.date_time <= now() THEN RETURN NEW; END IF;

    SELECT name INTO v_name FROM public.groups WHERE id = NEW.group_id;
    SELECT COALESCE(jsonb_agg(ms.player_id), '[]'::jsonb) INTO v_players
    FROM public.match_signups ms
    WHERE ms.match_id = NEW.id AND ms.status IN ('confirmed', 'waitlist') AND ms.player_id IS NOT NULL;

    PERFORM public.emit_notification(NEW.group_id, NEW.id, 'match_updated', jsonb_build_object(
        'match_id', NEW.id, 'group_name', v_name,
        'date_time', NEW.date_time, 'previous_date_time', OLD.date_time,
        'location', NEW.location, 'previous_location', OLD.location,
        'date_changed', NEW.date_time IS DISTINCT FROM OLD.date_time,
        'location_changed', NEW.location IS DISTINCT FROM OLD.location,
        'player_ids', v_players
    ));
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS matches_notify_updated ON public.matches;
CREATE TRIGGER matches_notify_updated AFTER UPDATE OF date_time, location ON public.matches
    FOR EACH ROW EXECUTE FUNCTION public.notify_match_updated();

-- ============================================
-- 3. LINEUP CHANGED
-- ============================================

-- Records, per transaction, which signups of a teams_created match left a
-- confirmed spot and which came in from the waitlist. The setting is
-- transaction-local (set_config(..., true)): {match_id: {left: [...], in: [...]}}.
CREATE OR REPLACE FUNCTION public.trg_match_signups_track_lineup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_state JSONB;
    v_key TEXT;
    v_bucket TEXT;
    v_status public.match_status;
BEGIN
    IF OLD.status = 'confirmed' AND NEW.status = 'cancelled' THEN
        v_bucket := 'left';
    ELSIF OLD.status = 'waitlist' AND NEW.status = 'confirmed' THEN
        v_bucket := 'in';
    ELSE
        RETURN NEW;
    END IF;

    SELECT status INTO v_status FROM public.matches WHERE id = NEW.match_id;
    IF v_status IS DISTINCT FROM 'teams_created' THEN RETURN NEW; END IF;

    v_state := COALESCE(NULLIF(current_setting('fulbot.lineup_changes', true), ''), '{}')::jsonb;
    v_key := NEW.match_id::TEXT;
    v_state := jsonb_set(
        v_state, ARRAY[v_key],
        COALESCE(v_state->v_key, '{"left": [], "in": []}'::jsonb), true);
    v_state := jsonb_set(
        v_state, ARRAY[v_key, v_bucket],
        (v_state->v_key->v_bucket) || to_jsonb(NEW.id::TEXT), true);
    PERFORM set_config('fulbot.lineup_changes', v_state::TEXT, true);
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS match_signups_track_lineup ON public.match_signups;
CREATE TRIGGER match_signups_track_lineup AFTER UPDATE OF status ON public.match_signups
    FOR EACH ROW EXECUTE FUNCTION public.trg_match_signups_track_lineup();

-- Runs at commit for every confirmed -> cancelled row. The first one for a
-- match emits the notification with everything recorded above and clears the
-- match's entry, so several leavers in one transaction give one notification.
CREATE OR REPLACE FUNCTION public.trg_match_signups_notify_lineup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_state JSONB;
    v_entry JSONB;
    v_key TEXT;
    v_match public.matches;
    v_group_name TEXT;
    v_left JSONB;
    v_in JSONB;
    v_actor UUID;
    v_confirmed INTEGER;
BEGIN
    v_state := COALESCE(NULLIF(current_setting('fulbot.lineup_changes', true), ''), '{}')::jsonb;
    v_key := NEW.match_id::TEXT;
    v_entry := v_state->v_key;
    IF v_entry IS NULL THEN RETURN NULL; END IF;
    PERFORM set_config('fulbot.lineup_changes', (v_state - v_key)::TEXT, true);

    SELECT * INTO v_match FROM public.matches WHERE id = NEW.match_id;
    IF v_match IS NULL OR v_match.status <> 'teams_created' OR v_match.date_time <= now() THEN
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
    WHERE ms.id::TEXT IN (SELECT jsonb_array_elements_text(v_entry->'left'))
      AND ms.status = 'cancelled';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', COALESCE(pp.display_name, gp.display_name, '?'),
               'player_id', ms.player_id,
               'guest', ms.guest_player_id IS NOT NULL)), '[]'::jsonb)
    INTO v_in
    FROM public.match_signups ms
    LEFT JOIN public.player_profiles pp ON pp.id = ms.player_id
    LEFT JOIN public.guest_players gp ON gp.id = ms.guest_player_id
    WHERE ms.id::TEXT IN (SELECT jsonb_array_elements_text(v_entry->'in'))
      AND ms.status = 'confirmed';

    IF jsonb_array_length(v_left) = 0 THEN RETURN NULL; END IF;

    SELECT name INTO v_group_name FROM public.groups WHERE id = v_match.group_id;
    SELECT COUNT(*) INTO v_confirmed FROM public.match_signups
    WHERE match_id = v_match.id AND status = 'confirmed';
    -- The admin who removed a player already knows.
    v_actor := get_current_player_id();

    INSERT INTO public.notifications (group_id, match_id, recipient_player_id, type, payload)
    SELECT v_match.group_id, v_match.id, gm.player_id, 'lineup_changed', jsonb_build_object(
        'match_id', v_match.id, 'group_name', v_group_name, 'date_time', v_match.date_time,
        'left', v_left, 'promoted', v_in,
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
DROP TRIGGER IF EXISTS match_signups_notify_lineup ON public.match_signups;
CREATE CONSTRAINT TRIGGER match_signups_notify_lineup AFTER UPDATE OF status ON public.match_signups
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW WHEN (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
    EXECUTE FUNCTION public.trg_match_signups_notify_lineup();

-- ============================================
-- 4. WHATSAPP OUTBOX: BACKOFF AND STALENESS
-- ============================================

ALTER TABLE public.notification_outbox
    ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- status: pending | sending | sent | failed | skipped

DROP INDEX IF EXISTS public.idx_notification_outbox_claimable;
CREATE INDEX IF NOT EXISTS idx_notification_outbox_claimable
    ON public.notification_outbox(available_at) WHERE status IN ('pending', 'sending');

-- 00026 body plus: skip stale rows before claiming, and only claim rows whose
-- backoff has elapsed (dispatch.ts sets available_at after a failed send).
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

    -- A message that arrives late is worse than none.
    UPDATE public.notification_outbox o
    SET status = 'skipped',
        last_error = CASE
            WHEN o.created_at < now() - interval '24 hours' THEN 'Vencido: más de 24 horas en cola'
            WHEN m.status IN ('cancelled', 'finished') THEN 'Vencido: el partido ya no está vigente'
            ELSE 'Vencido: el partido ya empezó'
        END
    FROM public.notification_outbox o2
    LEFT JOIN public.matches m ON m.id = o2.match_id
    WHERE o.id = o2.id
      AND o.status = 'pending'
      AND (
        o.created_at < now() - interval '24 hours'
        OR (o.type IN ('match_created', 'waitlist_promoted', 'teams_created', 'match_reminder', 'match_updated')
            AND m.id IS NOT NULL
            AND (m.status IN ('cancelled', 'finished') OR m.date_time <= now()))
        OR (o.type = 'match_cancelled' AND m.id IS NOT NULL AND m.date_time <= now())
      );

    RETURN QUERY
    WITH due AS (
        SELECT o.id FROM public.notification_outbox o
        WHERE o.status = 'pending' AND o.attempts < 5 AND o.channel = 'whatsapp_webhook'
          AND o.available_at <= now()
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
-- 5. EMIT_NOTIFICATION: REMINDER DEDUPE PER DATE (00026 body)
-- ============================================

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

    -- Authorization (00022/00026): the caller must be a member of the target
    -- group, the service role, or a direct database session with no JWT claims.
    v_claims := COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    IF COALESCE(v_claims->>'role', '') <> 'service_role'
       AND v_claims ? 'role'
       AND NOT is_group_member(p_group_id) THEN
        RAISE EXCEPTION 'No sos miembro de este grupo';
    END IF;

    -- The ticker, daily cron and page loads may race. Serialize events which
    -- should only happen once per match; repeated results/team events remain valid.
    IF p_type = 'match_created' AND p_match_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(p_match_id::TEXT || p_type, 0));
        IF EXISTS (SELECT 1 FROM public.notifications WHERE match_id = p_match_id AND type = p_type) THEN
            RETURN;
        END IF;
    END IF;

    -- One reminder per match date: a rescheduled match gets a new one. Rows
    -- from before 00030 carry no date_time and count until the match changes.
    IF p_type = 'match_reminder' AND p_match_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(p_match_id::TEXT || p_type, 0));
        IF EXISTS (
            SELECT 1 FROM public.notifications r
            WHERE r.match_id = p_match_id AND r.type = 'match_reminder'
              AND (
                (r.payload ? 'date_time' AND p_payload ? 'date_time'
                 AND (r.payload->>'date_time')::timestamptz = (p_payload->>'date_time')::timestamptz)
                OR (NOT (r.payload ? 'date_time' AND p_payload ? 'date_time')
                    AND NOT EXISTS (
                        SELECT 1 FROM public.notifications u
                        WHERE u.match_id = p_match_id AND u.type = 'match_updated'
                          AND COALESCE((u.payload->>'date_changed')::boolean, TRUE)
                          AND u.created_at > r.created_at))
              )
        ) THEN
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

-- ============================================
-- 6. PRIVILEGES
-- ============================================

REVOKE ALL ON FUNCTION public.notify_match_updated() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_match_signups_track_lineup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_match_signups_notify_lineup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_notification_outbox(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_outbox(INTEGER) TO service_role;
REVOKE ALL ON FUNCTION emit_notification(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION emit_notification(UUID, UUID, TEXT, JSONB) TO service_role;
