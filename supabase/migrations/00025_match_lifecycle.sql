-- Match lifecycle fixes from the Sep 24 recheck (docs/review/recheck-2026-09-24.md,
-- area C):
--   1. admin_add_guest_signup only flips signup_open -> full (C #1).
--   2. admin_set_match_max_players: raising the cap promotes the waitlist and
--      reconciles full / signup_open; lowering below the confirmed count is
--      rejected (C #3).
--   3. cancel_my_signup / cancel_guest_signup renumber the waitlist like
--      admin_remove_signup does (C #4).
--   4. get_public_group_by_invite's next match includes signup_closed and
--      teams_created, same as the dashboard layout (C #5 / A-D1).
--   5. recurring_match_occurrences: the generator remembers which weekly
--      occurrence it already created, so a moved match is not duplicated and a
--      deleted one does not come back (C #6).
--   6. recurring_patterns.timezone is validated against pg_timezone_names, and
--      one failing pattern no longer aborts the whole sweep (C #15).
--   7. match_signups joins the supabase_realtime publication (C #11).
--   8. public_guest_signup: name trim + length cap and a per-match hourly cap
--      on anonymous guest signups (C anon guest RPCs).

-- ============================================
-- 1. ADMIN GUEST ADD (00017 body)
-- ============================================
-- Only a match that is actively open flips to 'full'; draft, signup_closed and
-- teams_created keep their status.

CREATE OR REPLACE FUNCTION admin_add_guest_signup(
    p_match_id UUID,
    p_display_name TEXT,
    p_notes TEXT DEFAULT NULL,
    p_estimated_rating NUMERIC DEFAULT NULL,
    p_preferred_positions TEXT[] DEFAULT NULL
)
RETURNS public.match_signups AS $$
DECLARE
    v_match public.matches;
    v_guest_id UUID;
    v_confirmed_count INTEGER;
    v_status signup_status;
    v_waitlist_position SMALLINT;
    v_signup public.match_signups;
    v_notes TEXT;
    v_rating NUMERIC(3,2);
    v_positions TEXT[];
BEGIN
    IF p_display_name IS NULL OR btrim(p_display_name) = '' THEN
        RAISE EXCEPTION 'El nombre no puede estar vacío';
    END IF;

    IF p_estimated_rating IS NOT NULL AND (p_estimated_rating < 1 OR p_estimated_rating > 5) THEN
        RAISE EXCEPTION 'El nivel debe estar entre 1 y 5';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    IF NOT is_group_admin_or_captain(v_match.group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para agregar invitados';
    END IF;

    IF v_match.status IN ('finished', 'cancelled') THEN
        RAISE EXCEPTION 'No se pueden agregar invitados a este partido';
    END IF;

    v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');
    v_rating := COALESCE(p_estimated_rating, 3.00);

    -- Drop empty entries; fall back to the column default when nothing is left.
    SELECT ARRAY_AGG(upper(btrim(pos)))
    INTO v_positions
    FROM unnest(COALESCE(p_preferred_positions, ARRAY[]::TEXT[])) AS pos
    WHERE btrim(pos) <> '';

    IF v_positions IS NULL OR cardinality(v_positions) = 0 THEN
        v_positions := ARRAY['CM'];
    END IF;

    INSERT INTO public.guest_players (
        display_name, notes, estimated_rating, preferred_positions, group_id, created_by_user_id
    )
    VALUES (
        btrim(p_display_name), v_notes, v_rating, v_positions, v_match.group_id, auth.uid()
    )
    RETURNING id INTO v_guest_id;

    SELECT COUNT(*) INTO v_confirmed_count
    FROM public.match_signups
    WHERE match_id = p_match_id AND status = 'confirmed';

    IF v_confirmed_count < v_match.max_players THEN
        v_status := 'confirmed';
        v_waitlist_position := NULL;
    ELSE
        v_status := 'waitlist';
        SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_waitlist_position
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'waitlist';
    END IF;

    INSERT INTO public.match_signups (
        match_id, guest_player_id, status, notes, waitlist_position
    )
    VALUES (
        p_match_id, v_guest_id, v_status, v_notes, v_waitlist_position
    )
    RETURNING * INTO v_signup;

    IF v_status = 'confirmed' AND v_confirmed_count + 1 >= v_match.max_players
       AND v_match.status = 'signup_open' THEN
        UPDATE public.matches SET status = 'full' WHERE id = p_match_id;
    END IF;

    RETURN v_signup;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION admin_add_guest_signup(UUID, TEXT, TEXT, NUMERIC, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_add_guest_signup(UUID, TEXT, TEXT, NUMERIC, TEXT[]) TO authenticated;

-- ============================================
-- 2. CHANGING THE PLAYER CAP
-- ============================================
-- Same permission as the matches UPDATE policy (admin or captain). Raising the
-- cap pulls people off the waitlist through the policy-aware
-- promote_from_waitlist (00021) until the match is full or nobody eligible is
-- left; that function also reconciles full <-> signup_open. Lowering below the
-- confirmed count is rejected (nobody is bumped to the waitlist silently).
-- teams_created / draft matches only get the new number: promoting there would
-- change a published lineup, or confirm people before signups open.

CREATE OR REPLACE FUNCTION admin_set_match_max_players(
    p_match_id UUID,
    p_max_players INTEGER
)
RETURNS public.matches AS $$
DECLARE
    v_match public.matches;
    v_confirmed_count INTEGER;
    v_promoted UUID;
BEGIN
    IF p_max_players IS NULL OR p_max_players < 2 OR p_max_players > 60 THEN
        RAISE EXCEPTION 'Cantidad de jugadores inválida';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    IF NOT is_group_admin_or_captain(v_match.group_id) THEN
        RAISE EXCEPTION 'No tenés permiso para esta acción';
    END IF;

    IF v_match.status IN ('finished', 'cancelled') THEN
        RAISE EXCEPTION 'No se puede modificar este partido';
    END IF;

    SELECT COUNT(*) INTO v_confirmed_count
    FROM public.match_signups
    WHERE match_id = p_match_id AND status = 'confirmed';

    IF p_max_players < v_confirmed_count THEN
        RAISE EXCEPTION 'max_players_below_confirmed'
            USING DETAIL = format('%s confirmados', v_confirmed_count);
    END IF;

    IF p_max_players <> v_match.max_players THEN
        UPDATE public.matches SET max_players = p_max_players WHERE id = p_match_id;

        IF v_match.status IN ('signup_open', 'full', 'signup_closed') THEN
            LOOP
                v_promoted := promote_from_waitlist(p_match_id);
                EXIT WHEN v_promoted IS NULL;
            END LOOP;
        END IF;
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    RETURN v_match;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION admin_set_match_max_players(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_set_match_max_players(UUID, INTEGER) TO authenticated;

-- ============================================
-- 3. CANCEL PATHS RENUMBER THE WAITLIST
-- ============================================
-- promote_from_waitlist only renumbers when it promotes someone, so leaving
-- from the waitlist (or leaving a confirmed spot when nobody is eligible)
-- used to leave a gap. Same renumbering as admin_remove_signup.

-- cancel_my_signup: 00021 body plus the renumbering.
CREATE OR REPLACE FUNCTION cancel_my_signup(p_match_id UUID)
RETURNS void AS $$
DECLARE
    v_player_id UUID;
    v_signup public.match_signups;
BEGIN
    v_player_id := get_current_player_id();
    IF v_player_id IS NULL THEN
        RAISE EXCEPTION 'Perfil de jugador no encontrado';
    END IF;

    SELECT * INTO v_signup
    FROM public.match_signups
    WHERE match_id = p_match_id AND player_id = v_player_id
    AND status IN ('confirmed', 'waitlist')
    FOR UPDATE;

    IF v_signup IS NULL THEN
        RAISE EXCEPTION 'No estás inscripto en este partido';
    END IF;

    UPDATE public.match_signups
    SET status = 'cancelled', cancel_time = NOW()
    WHERE id = v_signup.id;

    PERFORM emit_cancel_event(p_match_id, v_player_id);

    PERFORM promote_from_waitlist(p_match_id);

    WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY waitlist_position ASC NULLS LAST, signup_time ASC) AS new_pos
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'waitlist'
    )
    UPDATE public.match_signups ms
    SET waitlist_position = numbered.new_pos
    FROM numbered
    WHERE ms.id = numbered.id AND ms.waitlist_position IS DISTINCT FROM numbered.new_pos;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION cancel_my_signup(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cancel_my_signup(UUID) TO authenticated, service_role;

-- cancel_guest_signup: 00007 body plus the renumbering.
CREATE OR REPLACE FUNCTION cancel_guest_signup(
    p_match_id UUID,
    p_token UUID
)
RETURNS void AS $$
DECLARE
    v_match public.matches;
    v_guest_id UUID;
    v_signup public.match_signups;
BEGIN
    IF p_token IS NULL THEN
        RAISE EXCEPTION 'Token inválido';
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'Partido no encontrado';
    END IF;

    SELECT id INTO v_guest_id
    FROM public.guest_players
    WHERE self_signup_token = p_token AND group_id = v_match.group_id;

    IF v_guest_id IS NULL THEN
        RAISE EXCEPTION 'Inscripción no encontrada';
    END IF;

    SELECT * INTO v_signup
    FROM public.match_signups
    WHERE match_id = p_match_id AND guest_player_id = v_guest_id
    AND status IN ('confirmed', 'waitlist')
    FOR UPDATE;

    IF v_signup IS NULL THEN
        RAISE EXCEPTION 'Inscripción no encontrada';
    END IF;

    UPDATE public.match_signups
    SET status = 'cancelled', cancel_time = NOW()
    WHERE id = v_signup.id;

    PERFORM promote_from_waitlist(p_match_id);

    WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY waitlist_position ASC NULLS LAST, signup_time ASC) AS new_pos
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'waitlist'
    )
    UPDATE public.match_signups ms
    SET waitlist_position = numbered.new_pos
    FROM numbered
    WHERE ms.id = numbered.id AND ms.waitlist_position IS DISTINCT FROM numbered.new_pos;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION cancel_guest_signup(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_guest_signup(UUID, UUID) TO anon, authenticated;

-- ============================================
-- 4. ANONYMOUS GUEST SIGNUP LIMITS (00007 body)
-- ============================================
-- The name is trimmed and capped at 60 characters, and a match accepts at most
-- 10 anonymous (token) guest signups per hour, so a script cannot fill the
-- roster or the waitlist with junk. The status flip only happens from
-- signup_open, so an already-full match is not rewritten.

CREATE OR REPLACE FUNCTION public_guest_signup(
    p_match_id UUID,
    p_display_name TEXT,
    p_token UUID
)
RETURNS JSONB AS $$
DECLARE
    v_match public.matches;
    v_guest_id UUID;
    v_confirmed_count INTEGER;
    v_status signup_status;
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
        v_waitlist_position := NULL;
    ELSE
        v_status := 'waitlist';
        SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_waitlist_position
        FROM public.match_signups
        WHERE match_id = p_match_id AND status = 'waitlist';
    END IF;

    -- Upsert: the same guest may have a prior 'cancelled' row for this match.
    INSERT INTO public.match_signups (match_id, guest_player_id, status, waitlist_position, signup_time, cancel_time)
    VALUES (p_match_id, v_guest_id, v_status, v_waitlist_position, NOW(), NULL)
    ON CONFLICT ON CONSTRAINT unique_guest_signup
    DO UPDATE SET
        status = EXCLUDED.status,
        waitlist_position = EXCLUDED.waitlist_position,
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
        'waitlist_position', v_waitlist_position
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public_guest_signup(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_guest_signup(UUID, TEXT, UUID) TO anon, authenticated;

-- ============================================
-- 5. INVITE PAGE NEXT MATCH (00024 body)
-- ============================================
-- Same upcoming statuses as the dashboard layout (UPCOMING_STATUSES). Keeps
-- 00024's viewer_membership field and search_path.

CREATE OR REPLACE FUNCTION get_public_group_by_invite(p_invite_code TEXT)
RETURNS JSONB AS $$
DECLARE
    v_group public.groups;
    v_result JSONB;
BEGIN
    SELECT * INTO v_group FROM public.groups WHERE invite_code = p_invite_code;
    IF v_group IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT jsonb_build_object(
        'id', v_group.id,
        'name', v_group.name,
        'slug', v_group.slug,
        'description', v_group.description,
        'default_match_day', v_group.default_match_day,
        'default_match_time', v_group.default_match_time,
        'timezone', v_group.timezone,
        'member_count', (
            SELECT COUNT(*) FROM public.group_memberships gm
            WHERE gm.group_id = v_group.id AND gm.is_active = TRUE
        ),
        'viewer_membership', (
            SELECT CASE WHEN gm.is_active THEN 'active' ELSE 'inactive' END
            FROM public.group_memberships gm
            JOIN public.player_profiles pp ON pp.id = gm.player_id
            WHERE gm.group_id = v_group.id AND auth.uid() IS NOT NULL AND pp.user_id = auth.uid()
            LIMIT 1
        ),
        'next_match', (
            SELECT jsonb_build_object(
                'id', m.id,
                'date_time', m.date_time,
                'location', m.location,
                'status', m.status,
                'max_players', m.max_players,
                'confirmed_count', (
                    SELECT COUNT(*) FROM public.match_signups ms
                    WHERE ms.match_id = m.id AND ms.status = 'confirmed'
                )
            )
            FROM public.matches m
            WHERE m.group_id = v_group.id
              AND m.status IN ('signup_open', 'full', 'signup_closed', 'teams_created')
              AND m.date_time > NOW() - INTERVAL '2 hours'
            ORDER BY m.date_time ASC
            LIMIT 1
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION get_public_group_by_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_group_by_invite(TEXT) TO anon, authenticated, service_role;

-- ============================================
-- 6. RECURRING PATTERN TIMEZONE VALIDATION
-- ============================================
-- A CHECK constraint cannot look at pg_timezone_names, so a trigger does it on
-- insert and whenever the zone changes. Existing rows are left alone; a bad one
-- only makes its own pattern fail in the generator (see below).

CREATE OR REPLACE FUNCTION trg_recurring_patterns_validate_timezone()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF NEW.timezone IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.timezone) THEN
        RAISE EXCEPTION 'invalid_timezone'
            USING ERRCODE = '22023', DETAIL = format('Zona horaria inválida: %s', NEW.timezone);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recurring_patterns_validate_timezone ON public.recurring_patterns;
CREATE TRIGGER recurring_patterns_validate_timezone
    BEFORE INSERT OR UPDATE OF timezone ON public.recurring_patterns
    FOR EACH ROW EXECUTE FUNCTION trg_recurring_patterns_validate_timezone();

REVOKE ALL ON FUNCTION trg_recurring_patterns_validate_timezone() FROM PUBLIC, anon, authenticated;

-- ============================================
-- 7. RECURRING OCCURRENCES
-- ============================================
-- One row per (pattern, local match date) the generator has materialized. It
-- outlives the match (match_id goes NULL on delete) so a deleted occurrence is
-- not recreated, and it is keyed by the pattern's local date instead of the
-- exact instant, so moving the generated match does not produce a duplicate.

CREATE TABLE IF NOT EXISTS public.recurring_match_occurrences (
    pattern_id UUID NOT NULL REFERENCES public.recurring_patterns(id) ON DELETE CASCADE,
    occurrence_date DATE NOT NULL,
    match_id UUID REFERENCES public.matches(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (pattern_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS idx_recurring_match_occurrences_match_id
    ON public.recurring_match_occurrences(match_id);

ALTER TABLE public.recurring_match_occurrences ENABLE ROW LEVEL SECURITY;

-- Written only by generate_recurring_matches (SECURITY DEFINER); members read.
DROP POLICY IF EXISTS "Members can read recurring occurrences" ON public.recurring_match_occurrences;
CREATE POLICY "Members can read recurring occurrences"
    ON public.recurring_match_occurrences FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.recurring_patterns rp
            WHERE rp.id = pattern_id AND is_group_member(rp.group_id)
        )
    );

-- Backfill from the matches already generated. The local date of the current
-- date_time is the best available key (a match moved before this migration is
-- keyed by where it is now). Patterns with an invalid zone are skipped.
INSERT INTO public.recurring_match_occurrences (pattern_id, occurrence_date, match_id)
SELECT DISTINCT ON (m.recurring_pattern_id, (m.date_time AT TIME ZONE rp.timezone)::DATE)
    m.recurring_pattern_id, (m.date_time AT TIME ZONE rp.timezone)::DATE, m.id
FROM public.matches m
JOIN public.recurring_patterns rp ON rp.id = m.recurring_pattern_id
WHERE rp.timezone IN (SELECT name FROM pg_catalog.pg_timezone_names)
ORDER BY m.recurring_pattern_id, (m.date_time AT TIME ZONE rp.timezone)::DATE, m.created_at
ON CONFLICT (pattern_id, occurrence_date) DO NOTHING;

-- generate_recurring_matches: 00019 body. New: the occurrence row is claimed
-- first (ON CONFLICT DO NOTHING, so concurrent sweeps cannot both win) and an
-- occurrence that was ever generated is skipped even if its match was moved or
-- deleted; each pattern runs in its own exception block, so a bad timezone or
-- any other error in one group is logged and the sweep continues.
CREATE OR REPLACE FUNCTION generate_recurring_matches(p_group_id UUID DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
    pattern RECORD;
    v_created_count INTEGER := 0;
    v_local_now TIMESTAMP;
    v_today_dow INTEGER;
    v_days_diff INTEGER;
    v_candidate_local_date DATE;
    v_candidate_local TIMESTAMP;
    v_candidate_instant TIMESTAMPTZ;
    v_match_dow INTEGER;
    v_week_start_date DATE;
    v_signup_local_date DATE;
    v_signup_local TIMESTAMP;
    v_signup_instant TIMESTAMPTZ;
    v_match_id UUID;
    v_duration INTEGER;
    v_delay INTEGER;
    v_claimed BOOLEAN;
BEGIN
    IF p_group_id IS NOT NULL THEN
        IF NOT is_group_member(p_group_id) THEN
            RAISE EXCEPTION 'No sos miembro de este grupo';
        END IF;
    ELSE
        IF COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role', '') != 'service_role' THEN
            RAISE EXCEPTION 'Esta operación requiere el rol de servicio';
        END IF;
    END IF;

    FOR pattern IN
        SELECT * FROM public.recurring_patterns
        WHERE is_active = TRUE
        AND (p_group_id IS NULL OR group_id = p_group_id)
    LOOP
        BEGIN
            v_local_now := now() AT TIME ZONE pattern.timezone;
            v_today_dow := EXTRACT(DOW FROM v_local_now)::INTEGER;
            v_days_diff := ((pattern.weekday - v_today_dow) + 7) % 7;
            v_candidate_local_date := (v_local_now::DATE) + v_days_diff;
            v_candidate_local := v_candidate_local_date + pattern.match_time;
            v_candidate_instant := v_candidate_local AT TIME ZONE pattern.timezone;

            IF v_candidate_instant <= (now() - INTERVAL '2 hours') THEN
                v_candidate_local_date := v_candidate_local_date + 7;
                v_candidate_local := v_candidate_local_date + pattern.match_time;
                v_candidate_instant := v_candidate_local AT TIME ZONE pattern.timezone;
            END IF;

            v_match_dow := EXTRACT(DOW FROM v_candidate_local_date)::INTEGER;
            v_week_start_date := v_candidate_local_date - v_match_dow;
            v_signup_local_date := v_week_start_date + pattern.signup_opens_weekday::INTEGER;
            v_signup_local := v_signup_local_date + pattern.signup_opens_time;
            v_signup_instant := v_signup_local AT TIME ZONE pattern.timezone;

            IF v_signup_instant > v_candidate_instant THEN
                v_signup_local_date := v_signup_local_date - 7;
                v_signup_local := v_signup_local_date + pattern.signup_opens_time;
                v_signup_instant := v_signup_local AT TIME ZONE pattern.timezone;
            END IF;

            IF v_signup_instant <= now()
               AND NOT EXISTS (
                   SELECT 1 FROM public.recurring_match_occurrences
                   WHERE pattern_id = pattern.id AND occurrence_date = v_candidate_local_date
               )
               AND NOT EXISTS (
                   SELECT 1 FROM public.matches
                   WHERE recurring_pattern_id = pattern.id AND date_time = v_candidate_instant
               ) THEN
                SELECT COALESCE(ns.default_duration_minutes, 60), COALESCE(ns.default_results_request_delay_minutes, 60)
                INTO v_duration, v_delay
                FROM public.notification_settings ns WHERE ns.group_id = pattern.group_id;
                v_duration := COALESCE(v_duration, 60);
                v_delay := COALESCE(v_delay, 60);

                BEGIN
                    INSERT INTO public.recurring_match_occurrences (pattern_id, occurrence_date)
                    VALUES (pattern.id, v_candidate_local_date)
                    ON CONFLICT (pattern_id, occurrence_date) DO NOTHING
                    RETURNING TRUE INTO v_claimed;

                    IF COALESCE(v_claimed, FALSE) THEN
                        INSERT INTO public.matches (
                            group_id, date_time, location, status, max_players, recurring_pattern_id,
                            duration_minutes, results_request_delay_minutes
                        )
                        VALUES (
                            pattern.group_id, v_candidate_instant, pattern.location, 'signup_open',
                            pattern.max_players, pattern.id, v_duration, v_delay
                        )
                        RETURNING id INTO v_match_id;

                        UPDATE public.recurring_match_occurrences
                        SET match_id = v_match_id
                        WHERE pattern_id = pattern.id AND occurrence_date = v_candidate_local_date;

                        v_created_count := v_created_count + 1;
                    END IF;
                EXCEPTION WHEN unique_violation THEN
                    NULL;
                END;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'generate_recurring_matches: pattern % (group %) failed: %',
                pattern.id, pattern.group_id, SQLERRM;
        END;
        v_claimed := NULL;
    END LOOP;

    RETURN v_created_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION generate_recurring_matches(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION generate_recurring_matches(UUID) TO authenticated, service_role;

-- ============================================
-- 8. REALTIME
-- ============================================
-- The match page subscribes to match_signups (realtime-wrapper.tsx). Guarded:
-- a database without the publication (plain Postgres) or where the table is
-- already published is left as is.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'match_signups'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.match_signups;
    END IF;
END $$;
