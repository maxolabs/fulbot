-- T3 recurring matches (see docs/rework-plan.md §2.4).
--
-- Adds recurring_patterns (one row per weekly match rule, e.g. "every Monday
-- 21:00, signups open Sunday 12:00") and the SQL function that lazily
-- materializes the next `matches` row for each active pattern once its
-- signup-open moment has passed. Triggered by (a) GET /api/cron/recurring
-- (daily, guarded by CRON_SECRET) and (b) the group page server component on
-- every render, so the match shows up even if the cron drifts (Vercel Hobby
-- allows only one daily cron with up to ±59 min drift).

-- ============================================
-- SCHEMA: recurring_patterns
-- ============================================

CREATE TABLE IF NOT EXISTS public.recurring_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Sunday
    match_time TIME NOT NULL,
    location TEXT,
    max_players SMALLINT NOT NULL DEFAULT 14,
    signup_opens_weekday SMALLINT NOT NULL CHECK (signup_opens_weekday BETWEEN 0 AND 6),
    signup_opens_time TIME NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_patterns_group_id ON public.recurring_patterns(group_id);
CREATE INDEX IF NOT EXISTS idx_recurring_patterns_active ON public.recurring_patterns(is_active) WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS update_recurring_patterns_updated_at ON public.recurring_patterns;
CREATE TRIGGER update_recurring_patterns_updated_at BEFORE UPDATE ON public.recurring_patterns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- matches.recurring_pattern_id already exists as a bare UUID column (from
-- 00001_initial_schema.sql); add the FK now that the referenced table exists.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'matches_recurring_pattern_id_fkey'
    ) THEN
        ALTER TABLE public.matches
            ADD CONSTRAINT matches_recurring_pattern_id_fkey
            FOREIGN KEY (recurring_pattern_id)
            REFERENCES public.recurring_patterns(id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_matches_recurring_pattern_id ON public.matches(recurring_pattern_id);

-- Defensive backstop against double-inserting the same occurrence under
-- concurrent calls (cron + a lazy group-page load racing each other); the
-- function's own EXISTS check is the primary idempotency guard.
CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_recurring_pattern_occurrence
    ON public.matches(recurring_pattern_id, date_time)
    WHERE recurring_pattern_id IS NOT NULL;

-- ============================================
-- RLS: members read, admins manage
-- ============================================

ALTER TABLE public.recurring_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read recurring patterns" ON public.recurring_patterns;
CREATE POLICY "Members can read recurring patterns"
    ON public.recurring_patterns FOR SELECT
    USING (is_group_member(group_id));

DROP POLICY IF EXISTS "Admins can manage recurring patterns" ON public.recurring_patterns;
CREATE POLICY "Admins can manage recurring patterns"
    ON public.recurring_patterns FOR ALL
    USING (is_group_admin(group_id))
    WITH CHECK (is_group_admin(group_id));

-- ============================================
-- FUNCTION: generate_recurring_matches
-- ============================================
-- For each active pattern (optionally scoped to p_group_id), computes the
-- next occurrence (weekday + match_time, in the pattern's own timezone)
-- strictly after now() - 2 hours (so a match currently in progress still
-- counts as "the next one"), and the occurrence's signup-open moment
-- (signup_opens_weekday + signup_opens_time in the same week as the match,
-- or the previous week if that would land after the match itself). When the
-- signup-open moment has already passed and no match row exists yet for that
-- exact (pattern, date_time) pair, inserts one with status 'signup_open'.
-- Idempotent: safe to call repeatedly (cron + lazy group-page calls).
--
-- Authorization: with p_group_id given, the caller must be a member of that
-- group (the lazy group-page call runs as the visiting user). With
-- p_group_id NULL (the cron sweep across all groups), the caller must be the
-- service role.
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
        -- "Now" as a wall-clock reading in the pattern's own timezone.
        v_local_now := now() AT TIME ZONE pattern.timezone;
        v_today_dow := EXTRACT(DOW FROM v_local_now)::INTEGER;
        v_days_diff := ((pattern.weekday - v_today_dow) + 7) % 7;
        v_candidate_local_date := (v_local_now::DATE) + v_days_diff;
        v_candidate_local := v_candidate_local_date + pattern.match_time;
        v_candidate_instant := v_candidate_local AT TIME ZONE pattern.timezone;

        -- If this week's occurrence is already more than 2 hours in the
        -- past, roll forward to next week's.
        IF v_candidate_instant <= (now() - INTERVAL '2 hours') THEN
            v_candidate_local_date := v_candidate_local_date + 7;
            v_candidate_local := v_candidate_local_date + pattern.match_time;
            v_candidate_instant := v_candidate_local AT TIME ZONE pattern.timezone;
        END IF;

        -- Signup-open moment: same Sun-Sat week as the match occurrence,
        -- unless that lands after the match, in which case use the
        -- previous week's.
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

        IF v_signup_instant <= now() AND NOT EXISTS (
            SELECT 1 FROM public.matches
            WHERE recurring_pattern_id = pattern.id AND date_time = v_candidate_instant
        ) THEN
            BEGIN
                INSERT INTO public.matches (
                    group_id, date_time, location, status, max_players, recurring_pattern_id
                )
                VALUES (
                    pattern.group_id, v_candidate_instant, pattern.location, 'signup_open',
                    pattern.max_players, pattern.id
                )
                RETURNING id INTO v_match_id;

                v_created_count := v_created_count + 1;

                -- The match_created notification (§2.6) is emitted by the TS
                -- caller (src/lib/notifications/match-created.ts), not here:
                -- its canonical MatchCreatedPayload needs match_id,
                -- group_name and signup_url (built from NEXT_PUBLIC_APP_URL),
                -- none of which this function can produce correctly in SQL.
                -- Both callers of this RPC (GET /api/cron/recurring and the
                -- group-page lazy call) invoke that helper right after this
                -- RPC returns; it is idempotent (keyed on the absence of an
                -- existing match_created notification for the match), so it
                -- is safe regardless of how many times this function runs.
            EXCEPTION WHEN unique_violation THEN
                -- Another concurrent call already created this occurrence.
                NULL;
            END;
        END IF;
    END LOOP;

    RETURN v_created_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION generate_recurring_matches(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION generate_recurring_matches(UUID) TO authenticated, service_role;
