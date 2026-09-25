-- Opt-in Web Push, independent of the optional WhatsApp bridge.
CREATE TABLE public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE CHECK (length(endpoint) <= 2048),
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
-- Clients can read and remove their own rows; inserts go through
-- /api/push/subscription (validated endpoint and keys, per-user cap).
CREATE POLICY "Read own device subscriptions" ON public.push_subscriptions
    FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Remove own device subscriptions" ON public.push_subscriptions
    FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE INDEX push_subscriptions_user ON public.push_subscriptions(user_id);

CREATE TABLE public.push_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_id UUID,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (notification_id, subscription_id)
);
ALTER TABLE public.push_deliveries ENABLE ROW LEVEL SECURITY;
-- No client policies: only the service role can drain this queue.
CREATE INDEX push_deliveries_pending ON public.push_deliveries(available_at)
    WHERE status IN ('pending', 'sending');
CREATE INDEX push_deliveries_subscription ON public.push_deliveries(subscription_id);

CREATE FUNCTION public.push_audience_matches(n public.notifications, player UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT (n.recipient_player_id IS NULL OR n.recipient_player_id = player)
       AND CASE n.type
         WHEN 'waitlist_promoted' THEN n.recipient_player_id = player
         WHEN 'results_request' THEN
           n.payload->'player_ids' IS NULL OR COALESCE(n.payload->'player_ids' ? player::TEXT, FALSE)
         WHEN 'results_reminder' THEN COALESCE(n.payload->'pending_player_ids' ? player::TEXT, FALSE)
         ELSE TRUE
       END;
$$;

CREATE FUNCTION public.enqueue_device_push()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    -- Keep sensitive rating/admin nudges in the app, off lock screens.
    IF NEW.type NOT IN ('match_created', 'waitlist_promoted', 'teams_created',
        'match_reminder', 'results_posted', 'results_request', 'results_reminder') THEN
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
CREATE TRIGGER notifications_enqueue_device_push AFTER INSERT ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_device_push();

-- Claim with a lease, so overlapping traffic and cron ticks cannot send a row
-- simultaneously. Eligibility is checked again here, not just at enqueue time.
CREATE FUNCTION public.claim_push_deliveries(p_limit INTEGER DEFAULT 30)
RETURNS SETOF JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.push_deliveries SET status = 'failed', last_error = 'Delivery expired'
    WHERE status IN ('pending', 'sending') AND available_at <= now()
      AND (attempts >= 5 OR created_at < now() - interval '24 hours');
    -- Settled rows are only useful for debugging; keep a week.
    DELETE FROM public.push_deliveries
    WHERE status IN ('sent', 'skipped', 'failed') AND created_at < now() - interval '7 days';

    RETURN QUERY
    WITH due AS (
        SELECT id FROM public.push_deliveries
        WHERE status IN ('pending', 'sending') AND available_at <= now() AND attempts < 5
        ORDER BY available_at LIMIT LEAST(GREATEST(p_limit, 1), 100)
        FOR UPDATE SKIP LOCKED
    ), claimed AS (
        UPDATE public.push_deliveries d SET status = 'sending', attempts = attempts + 1,
            lease_id = gen_random_uuid(), available_at = now() + interval '5 minutes'
        FROM due WHERE d.id = due.id RETURNING d.*
    )
    SELECT jsonb_build_object(
        'id', d.id, 'lease_id', d.lease_id, 'attempts', d.attempts,
        'subscription_id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
        'notification_id', n.id, 'type', n.type, 'payload', n.payload,
        'match_id', n.match_id, 'group_slug', g.slug, 'group_name', g.name,
        'timezone', g.timezone, 'language', u.preferred_language,
        'allowed', public.push_audience_matches(n, p.id)
            AND (u.notification_prefs->n.type) IS DISTINCT FROM 'false'::jsonb
            AND EXISTS (SELECT 1 FROM public.group_memberships gm
                WHERE gm.player_id = p.id AND gm.group_id = n.group_id AND gm.is_active)
            AND NOT EXISTS (SELECT 1 FROM public.notification_reads nr
                WHERE nr.player_id = p.id AND nr.notification_id = n.id)
            -- The pending list is frozen when the reminder is created; skip
            -- players who reported since.
            AND (n.type <> 'results_reminder' OR NOT EXISTS (SELECT 1 FROM public.match_reports r
                WHERE r.match_id = n.match_id AND r.reporter_player_id = p.id))
            AND (n.type NOT IN ('match_created', 'match_reminder', 'teams_created', 'waitlist_promoted')
                OR EXISTS (SELECT 1 FROM public.matches m WHERE m.id = n.match_id
                    AND m.status NOT IN ('cancelled', 'finished') AND m.date_time > now()))
    )
    FROM claimed d
    JOIN public.push_subscriptions s ON s.id = d.subscription_id
    JOIN public.users u ON u.id = s.user_id
    JOIN public.player_profiles p ON p.user_id = u.id
    JOIN public.notifications n ON n.id = d.notification_id
    JOIN public.groups g ON g.id = n.group_id;
END;
$$;

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
    IF COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role', '') <> 'service_role'
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
-- Notifications now reach lock screens, so members may no longer emit
-- arbitrary events directly; triggers and the service role still can.
REVOKE EXECUTE ON FUNCTION public.emit_notification(UUID, UUID, TEXT, JSONB) FROM authenticated;

-- Announce the first opening, including manually opened drafts. The existing
-- recurring helper sees this row and does not emit it again.
CREATE FUNCTION public.notify_signup_opened()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name TEXT;
BEGIN
    IF NEW.status <> 'signup_open' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD.signup_opened_at IS NOT NULL THEN RETURN NEW; END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM public.notifications WHERE match_id = NEW.id AND type = 'match_created') THEN
        RETURN NEW;
    END IF;
    SELECT name INTO v_name FROM public.groups WHERE id = NEW.group_id;
    PERFORM public.emit_notification(NEW.group_id, NEW.id, 'match_created', jsonb_build_object(
        'match_id', NEW.id, 'group_name', v_name, 'date_time', NEW.date_time,
        'location', NEW.location, 'max_players', NEW.max_players, 'signup_url', '/m/' || NEW.id
    ));
    RETURN NEW;
END;
$$;
CREATE TRIGGER matches_notify_signup_opened AFTER INSERT OR UPDATE OF status ON public.matches
    FOR EACH ROW EXECUTE FUNCTION public.notify_signup_opened();

REVOKE ALL ON FUNCTION public.push_audience_matches(public.notifications, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_device_push() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_signup_opened() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_push_deliveries(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_deliveries(INTEGER) TO service_role;
