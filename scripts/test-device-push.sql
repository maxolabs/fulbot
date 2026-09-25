-- Run against a disposable database with all migrations applied. No network sends.
-- psql -v ON_ERROR_STOP=1 -f scripts/test-device-push.sql
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
DECLARE
    u1 UUID := uuid_generate_v4(); u2 UUID := uuid_generate_v4(); u3 UUID := uuid_generate_v4();
    p1 UUID; p2 UUID; p3 UUID;
    g UUID := uuid_generate_v4(); m UUID := uuid_generate_v4(); n UUID;
    claimed JSONB; total INTEGER;
BEGIN
    INSERT INTO auth.users(id, email) VALUES (u1, 'push1@example.test'), (u2, 'push2@example.test'), (u3, 'push3@example.test');
    SELECT id INTO p1 FROM public.player_profiles WHERE user_id = u1;
    SELECT id INTO p2 FROM public.player_profiles WHERE user_id = u2;
    SELECT id INTO p3 FROM public.player_profiles WHERE user_id = u3;
    INSERT INTO public.groups(id, name, slug) VALUES (g, 'Push test', 'push-' || g);
    INSERT INTO public.group_memberships(group_id, player_id, role, is_active)
        VALUES (g, p1, 'admin', true), (g, p2, 'member', true), (g, p3, 'member', false);
    UPDATE public.users SET notification_prefs = '{"match_created":false}' WHERE id = u2;
    INSERT INTO public.push_subscriptions(user_id, endpoint, p256dh, auth)
        VALUES (u1, 'https://fcm.googleapis.com/' || u1, 'test', 'test'),
               (u2, 'https://fcm.googleapis.com/' || u2, 'test', 'test'),
               (u3, 'https://fcm.googleapis.com/' || u3, 'test', 'test');

    INSERT INTO public.matches(id, group_id, date_time, status) VALUES (m, g, now() + interval '3 days', 'draft');
    IF EXISTS (SELECT 1 FROM public.notifications WHERE match_id = m) THEN RAISE EXCEPTION 'Draft announced'; END IF;
    UPDATE public.matches SET status = 'signup_open' WHERE id = m;
    SELECT id INTO n FROM public.notifications WHERE match_id = m AND type = 'match_created';
    IF n IS NULL THEN RAISE EXCEPTION 'Opening did not emit'; END IF;
    SELECT count(*) INTO total FROM public.push_deliveries WHERE notification_id = n;
    IF total <> 1 THEN RAISE EXCEPTION 'Muted/inactive members received opening: %', total; END IF;
    PERFORM public.emit_notification(g, m, 'match_created', '{}');
    UPDATE public.matches SET status = 'signup_closed' WHERE id = m;
    UPDATE public.matches SET status = 'signup_open' WHERE id = m;
    SELECT count(*) INTO total FROM public.notifications WHERE match_id = m AND type = 'match_created';
    IF total <> 1 THEN RAISE EXCEPTION 'Opening duplicated'; END IF;

    SELECT x INTO claimed FROM public.claim_push_deliveries(100) x WHERE x->>'notification_id' = n::TEXT;
    IF claimed->>'allowed' <> 'true' THEN RAISE EXCEPTION 'Eligible member not allowed'; END IF;
    IF EXISTS (SELECT 1 FROM public.claim_push_deliveries(100) x WHERE x->>'notification_id' = n::TEXT) THEN
        RAISE EXCEPTION 'Live lease claimed twice';
    END IF;
    UPDATE public.push_deliveries SET available_at = now() - interval '1 minute' WHERE notification_id = n;
    UPDATE public.group_memberships SET is_active = false WHERE group_id = g AND player_id = p1;
    SELECT x INTO claimed FROM public.claim_push_deliveries(100) x WHERE x->>'notification_id' = n::TEXT;
    IF claimed->>'allowed' <> 'false' THEN RAISE EXCEPTION 'Removed member allowed on retry'; END IF;
    UPDATE public.push_deliveries SET status = 'sent' WHERE notification_id = n;
    UPDATE public.group_memberships SET is_active = true WHERE group_id = g AND player_id = p1;

    INSERT INTO public.notifications(group_id, match_id, type, payload)
        VALUES (g, m, 'results_reminder', jsonb_build_object('pending_player_ids', jsonb_build_array(p2))) RETURNING id INTO n;
    SELECT count(*) INTO total FROM public.push_deliveries d JOIN public.push_subscriptions s ON s.id = d.subscription_id
        WHERE d.notification_id = n AND s.user_id = u2;
    IF total <> 1 OR (SELECT count(*) FROM public.push_deliveries WHERE notification_id = n) <> 1 THEN
        RAISE EXCEPTION 'Results reminder not scoped to pending reporters';
    END IF;
    UPDATE public.users SET notification_prefs = '{"results_reminder":false}' WHERE id = u2;
    SELECT x INTO claimed FROM public.claim_push_deliveries(100) x WHERE x->>'notification_id' = n::TEXT;
    IF claimed->>'allowed' <> 'false' THEN RAISE EXCEPTION 'Preference ignored at delivery time'; END IF;

    INSERT INTO public.notifications(group_id, match_id, type, recipient_player_id)
        VALUES (g, m, 'waitlist_promoted', p1) RETURNING id INTO n;
    IF (SELECT count(*) FROM public.push_deliveries WHERE notification_id = n) <> 1 THEN RAISE EXCEPTION 'Waitlist not targeted'; END IF;
    INSERT INTO public.notification_reads(notification_id, player_id) VALUES (n, p1);
    SELECT x INTO claimed FROM public.claim_push_deliveries(100) x WHERE x->>'notification_id' = n::TEXT;
    IF claimed->>'allowed' <> 'false' THEN RAISE EXCEPTION 'Read event sent'; END IF;

    INSERT INTO public.notifications(group_id, match_id, type) VALUES (g, m, 'waitlist_promoted') RETURNING id INTO n;
    IF EXISTS (SELECT 1 FROM public.push_deliveries WHERE notification_id = n) THEN RAISE EXCEPTION 'Guest promotion broadcast'; END IF;
    INSERT INTO public.notifications(group_id, type) VALUES (g, 'member_score_dropped') RETURNING id INTO n;
    IF EXISTS (SELECT 1 FROM public.push_deliveries WHERE notification_id = n) THEN RAISE EXCEPTION 'Sensitive score on lock screen'; END IF;

    -- Test RLS as an authenticated user, not as the database owner.
    PERFORM set_config('request.jwt.claim.sub', u1::TEXT, true);
    SET LOCAL ROLE authenticated;
    IF (SELECT count(*) FROM public.push_subscriptions) <> 1 THEN RAISE EXCEPTION 'Subscription RLS leak'; END IF;
    IF EXISTS (SELECT 1 FROM public.push_deliveries) THEN RAISE EXCEPTION 'Queue RLS leak'; END IF;
    BEGIN
        INSERT INTO public.push_subscriptions(user_id, endpoint, p256dh, auth)
            VALUES (u2, 'https://fcm.googleapis.com/forged', 'test', 'test');
        RAISE EXCEPTION 'Can create another user subscription';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        INSERT INTO public.push_subscriptions(user_id, endpoint, p256dh, auth)
            VALUES (u1, 'https://fcm.googleapis.com/direct', 'test', 'test');
        RAISE EXCEPTION 'Can bypass the subscription route';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM public.emit_notification(g, m, 'match_created', '{}');
        RAISE EXCEPTION 'Member can emit arbitrary notifications';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM public.claim_push_deliveries(1);
        RAISE EXCEPTION 'Authenticated user can claim deliveries';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
    RAISE NOTICE 'Device push audience, preferences, leases, deduplication, and RLS checks passed';
END;
$$;
ROLLBACK;
