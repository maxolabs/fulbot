-- T5 notifications: in-app notifications + WhatsApp outbox (see docs/rework-plan.md §2.6).
--
-- Adds:
--   - notifications: one row per in-app event, either group-wide
--     (recipient_player_id NULL) or targeted at a single player.
--   - notification_reads: per-(notification, player) read-state join table.
--     Group-wide notifications (match_created, teams_created, results_posted)
--     are one row shared by every member, so read state cannot live on that
--     row itself -- otherwise the first member to hit "Marcar todo como
--     leído" would mark it read for the whole group. Targeted notifications
--     use the same table for consistency, so callers never need to branch.
--   - notification_outbox: queued external deliveries (WhatsApp webhook today),
--     drained by GET /api/cron/notifications.
--   - emit_notification(): the single SECURITY DEFINER entry point every
--     event goes through; requires the caller to be a member of p_group_id
--     (or the service role, for cron/system callers); honors
--     notification_settings toggles and enqueues an outbox row when the
--     group has a whatsapp_webhook_url configured.
--   - promote_from_waitlist() is CREATE OR REPLACEd (same signature as
--     00007_signup_flow.sql) to also emit 'waitlist_promoted'.
--   - mark_notifications_read() / get_unread_notification_count() for the
--     bell icon and /notifications page, backed by notification_reads.

-- ============================================
-- TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    match_id UUID REFERENCES public.matches(id) ON DELETE CASCADE,
    recipient_player_id UUID REFERENCES public.player_profiles(id) ON DELETE CASCADE, -- NULL = whole group
    type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_group_id ON public.notifications(group_id);
CREATE INDEX IF NOT EXISTS idx_notifications_match_id ON public.notifications(match_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_player_id ON public.notifications(recipient_player_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

-- Per-(notification, player) read state -- see file header. A row's presence
-- means that player has read that notification; absence means unread. This
-- is what makes "unread" per-user even for group-wide rows (recipient_player_id
-- IS NULL) shared by every member.
CREATE TABLE IF NOT EXISTS public.notification_reads (
    notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (notification_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_reads_player_id ON public.notification_reads(player_id);

CREATE TABLE IF NOT EXISTS public.notification_outbox (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    match_id UUID REFERENCES public.matches(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    channel TEXT NOT NULL DEFAULT 'whatsapp_webhook',
    status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_status ON public.notification_outbox(status);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_group_id ON public.notification_outbox(group_id);

-- ============================================
-- RLS
-- ============================================

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

-- Members read notifications for their groups: group-wide rows (recipient
-- NULL) plus rows targeted at their own player id. No INSERT/UPDATE policy on
-- purpose -- every row is written by emit_notification (SECURITY DEFINER),
-- never directly by a client. Read state lives in notification_reads, not on
-- this table, so there is no "mark read" policy here either.
DROP POLICY IF EXISTS "Members can read their group's notifications" ON public.notifications;
CREATE POLICY "Members can read their group's notifications"
    ON public.notifications FOR SELECT
    USING (
        is_group_member(group_id)
        AND (recipient_player_id IS NULL OR recipient_player_id = get_current_player_id())
    );

-- Drop the old direct-UPDATE read policy from when read state lived on
-- notifications.read_at -- writes now go through notification_reads only.
DROP POLICY IF EXISTS "Members can mark their own notifications read" ON public.notifications;

-- Players can see and write only their own read markers. mark_notifications_read
-- (SECURITY DEFINER) is the normal write path, but these policies also let a
-- player read their own read state directly if ever needed.
DROP POLICY IF EXISTS "Players manage their own notification reads" ON public.notification_reads;
CREATE POLICY "Players manage their own notification reads"
    ON public.notification_reads FOR ALL
    USING (player_id = get_current_player_id())
    WITH CHECK (player_id = get_current_player_id());

-- notification_outbox has no policies at all: it is only ever touched by
-- emit_notification (SECURITY DEFINER) and the cron route's admin client
-- (service_role bypasses RLS), never by an authenticated/anon client.

-- ============================================
-- emit_notification: single entry point for every notification event
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- promote_from_waitlist: same signature as 00007_signup_flow.sql, now also
-- emits 'waitlist_promoted' for the promoted player (recipient set only when
-- the promoted signup belongs to a registered player, not a guest).
-- ============================================

CREATE OR REPLACE FUNCTION promote_from_waitlist(p_match_id UUID)
RETURNS UUID AS $$
DECLARE
    v_match public.matches;
    v_confirmed_count INTEGER;
    v_promoted_id UUID;
    v_promoted_player_id UUID;
    v_promoted_guest_id UUID;
    v_promoted_name TEXT;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*) INTO v_confirmed_count
    FROM public.match_signups
    WHERE match_id = p_match_id AND status = 'confirmed';

    v_promoted_id := NULL;

    IF v_confirmed_count < v_match.max_players THEN
        SELECT id, player_id, guest_player_id
        INTO v_promoted_id, v_promoted_player_id, v_promoted_guest_id
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'waitlist'
        ORDER BY waitlist_position ASC NULLS LAST, signup_time ASC
        LIMIT 1;

        IF v_promoted_id IS NOT NULL THEN
            UPDATE public.match_signups
            SET status = 'confirmed', waitlist_position = NULL
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

            PERFORM emit_notification(
                v_match.group_id,
                p_match_id,
                'waitlist_promoted',
                jsonb_build_object(
                    'signup_id', v_promoted_id,
                    'player_name', v_promoted_name,
                    'recipient_player_id', v_promoted_player_id
                )
            );
        END IF;
    END IF;

    -- Only reconcile status while the match is actively tracking signups
    IF v_match.status IN ('signup_open', 'full') THEN
        IF v_confirmed_count >= v_match.max_players THEN
            UPDATE public.matches SET status = 'full' WHERE id = p_match_id;
        ELSE
            UPDATE public.matches SET status = 'signup_open' WHERE id = p_match_id;
        END IF;
    END IF;

    RETURN v_promoted_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- mark_notifications_read / get_unread_notification_count (current player)
-- ============================================

CREATE OR REPLACE FUNCTION mark_notifications_read(p_ids UUID[])
RETURNS void AS $$
DECLARE
    v_player_id UUID;
BEGIN
    v_player_id := get_current_player_id();
    IF v_player_id IS NULL THEN
        RAISE EXCEPTION 'Perfil de jugador no encontrado';
    END IF;

    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RETURN;
    END IF;

    -- Per-player read marker (see notification_reads above) -- never touches
    -- notifications itself, so marking read never affects other members'
    -- unread state for the same group-wide row.
    INSERT INTO public.notification_reads (notification_id, player_id)
    SELECT n.id, v_player_id
    FROM public.notifications n
    WHERE n.id = ANY(p_ids)
      AND is_group_member(n.group_id)
      AND (n.recipient_player_id IS NULL OR n.recipient_player_id = v_player_id)
    ON CONFLICT (notification_id, player_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_unread_notification_count()
RETURNS INTEGER AS $$
DECLARE
    v_player_id UUID;
    v_count INTEGER;
BEGIN
    v_player_id := get_current_player_id();
    IF v_player_id IS NULL THEN
        RETURN 0;
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM public.notifications n
    JOIN public.group_memberships gm
        ON gm.group_id = n.group_id AND gm.player_id = v_player_id AND gm.is_active = TRUE
    WHERE (n.recipient_player_id IS NULL OR n.recipient_player_id = v_player_id)
      AND NOT EXISTS (
          SELECT 1 FROM public.notification_reads nr
          WHERE nr.notification_id = n.id AND nr.player_id = v_player_id
      );

    RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================
-- PRIVILEGES
-- ============================================

REVOKE ALL ON FUNCTION emit_notification(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION emit_notification(UUID, UUID, TEXT, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION mark_notifications_read(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_notifications_read(UUID[]) TO authenticated;

REVOKE ALL ON FUNCTION get_unread_notification_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_unread_notification_count() TO authenticated;
