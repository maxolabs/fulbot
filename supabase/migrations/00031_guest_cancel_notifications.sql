-- Guests can free a spot when someone is waiting.
--
-- cancel_guest_signup runs for anonymous guests (role anon) and promotes the
-- first waitlister, which emits waitlist_promoted. emit_notification's
-- membership check rejected every anon caller, so the whole cancel rolled
-- back with 'No sos miembro de este grupo'.
--
-- EXECUTE on emit_notification is granted only to service_role (00030), so an
-- anon caller can only reach it through a SECURITY DEFINER RPC that already
-- authorized the guest by token. The check now skips anon and keeps the
-- membership check for authenticated callers as defense in depth.
--
-- Body is the 00030 version; only the authorization condition changes.

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

    -- Authorization (00022/00026/00031): the caller must be a member of the
    -- target group, the service role, an anonymous guest (only reachable via
    -- token-checked SECURITY DEFINER RPCs), or a direct database session.
    v_claims := COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    IF COALESCE(v_claims->>'role', '') NOT IN ('service_role', 'anon')
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

REVOKE ALL ON FUNCTION emit_notification(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION emit_notification(UUID, UUID, TEXT, JSONB) TO service_role;
