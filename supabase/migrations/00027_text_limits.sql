-- Text limits on user-entered names and texts (PLAT-11 / ONB-14).
--
-- The forms cap these fields (maxLength) but the API and RLS accept any
-- length and blank names, so a crafted request could store a 10 KB name that
-- breaks every roster, the WhatsApp texts and the lineup image.
--
--   1. Existing rows are trimmed and clamped first, so the constraints can be
--      added VALID (blank required names get a fallback).
--   2. CHECK constraints, matching the limits the forms already use:
--        player_profiles.display_name   trimmed, 1..50
--        player_profiles.nickname       <= 20
--        groups.name                    trimmed, 1..50
--        groups.description             <= 200
--        matches.location               <= 200   (the match and recurring forms
--        recurring_patterns.location    <= 200    allow 200; generated matches
--                                                  copy the pattern's location)
--        matches.notes                  <= 500
--   3. handle_new_user() trims and clamps the sign-up name, so a blank or
--      oversized `name` in the sign-up metadata cannot make the new
--      display_name violate the constraint and fail the whole sign-up.
--
-- Idempotent: safe to run twice.

-- ============================================
-- 1. CLEAN EXISTING ROWS
-- ============================================

UPDATE public.player_profiles
SET display_name = COALESCE(NULLIF(left(btrim(display_name), 50), ''), 'Jugador')
WHERE display_name IS DISTINCT FROM COALESCE(NULLIF(left(btrim(display_name), 50), ''), 'Jugador');

UPDATE public.player_profiles
SET nickname = NULLIF(left(btrim(nickname), 20), '')
WHERE nickname IS NOT NULL
  AND nickname IS DISTINCT FROM NULLIF(left(btrim(nickname), 20), '');

UPDATE public.groups
SET name = COALESCE(NULLIF(left(btrim(name), 50), ''), left(slug, 50))
WHERE name IS DISTINCT FROM COALESCE(NULLIF(left(btrim(name), 50), ''), left(slug, 50));

UPDATE public.groups
SET description = NULLIF(left(btrim(description), 200), '')
WHERE description IS NOT NULL
  AND description IS DISTINCT FROM NULLIF(left(btrim(description), 200), '');

UPDATE public.matches
SET location = left(location, 200)
WHERE char_length(location) > 200;

UPDATE public.matches
SET notes = left(notes, 500)
WHERE char_length(notes) > 500;

UPDATE public.recurring_patterns
SET location = left(location, 200)
WHERE char_length(location) > 200;

-- ============================================
-- 2. CONSTRAINTS
-- ============================================

ALTER TABLE public.player_profiles DROP CONSTRAINT IF EXISTS player_profiles_display_name_length;
ALTER TABLE public.player_profiles ADD CONSTRAINT player_profiles_display_name_length
    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 50);

ALTER TABLE public.player_profiles DROP CONSTRAINT IF EXISTS player_profiles_nickname_length;
ALTER TABLE public.player_profiles ADD CONSTRAINT player_profiles_nickname_length
    CHECK (nickname IS NULL OR char_length(nickname) <= 20);

ALTER TABLE public.groups DROP CONSTRAINT IF EXISTS groups_name_length;
ALTER TABLE public.groups ADD CONSTRAINT groups_name_length
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 50);

ALTER TABLE public.groups DROP CONSTRAINT IF EXISTS groups_description_length;
ALTER TABLE public.groups ADD CONSTRAINT groups_description_length
    CHECK (description IS NULL OR char_length(description) <= 200);

ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_location_length;
ALTER TABLE public.matches ADD CONSTRAINT matches_location_length
    CHECK (location IS NULL OR char_length(location) <= 200);

ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_notes_length;
ALTER TABLE public.matches ADD CONSTRAINT matches_notes_length
    CHECK (notes IS NULL OR char_length(notes) <= 500);

ALTER TABLE public.recurring_patterns DROP CONSTRAINT IF EXISTS recurring_patterns_location_length;
ALTER TABLE public.recurring_patterns ADD CONSTRAINT recurring_patterns_location_length
    CHECK (location IS NULL OR char_length(location) <= 200);

-- ============================================
-- 3. SIGN-UP TRIGGER
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    new_player_id UUID;
    v_name TEXT;
BEGIN
    -- Trimmed, at most 50 characters; the email's local part (then 'Jugador')
    -- when the metadata has no usable name.
    v_name := COALESCE(
        NULLIF(left(btrim(NEW.raw_user_meta_data->>'name'), 50), ''),
        NULLIF(left(btrim(split_part(NEW.email, '@', 1)), 50), ''),
        'Jugador'
    );

    -- Create user record
    INSERT INTO public.users (id, email, name, preferred_language)
    VALUES (
        NEW.id,
        NEW.email,
        v_name,
        COALESCE((NEW.raw_user_meta_data->>'preferred_language')::user_language, 'es')
    );

    -- Also create a player profile for the user
    INSERT INTO public.player_profiles (user_id, display_name)
    VALUES (NEW.id, v_name)
    RETURNING id INTO new_player_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- CREATE OR REPLACE keeps the grants, but restate 00013's revoke in case
-- this runs on a database where the function was recreated by hand.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
