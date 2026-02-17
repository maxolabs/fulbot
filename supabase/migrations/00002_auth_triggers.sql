-- FUTBOT Auth Triggers
-- Auto-create user record and player profile when auth user signs up

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    new_player_id UUID;
BEGIN
    -- Create user record
    INSERT INTO public.users (id, email, name, preferred_language)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        COALESCE((NEW.raw_user_meta_data->>'preferred_language')::user_language, 'es')
    );

    -- Also create a player profile for the user
    INSERT INTO public.player_profiles (user_id, display_name)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
    )
    RETURNING id INTO new_player_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users insert
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to handle user deletion cleanup (optional, cascade should handle most)
CREATE OR REPLACE FUNCTION public.handle_user_deleted()
RETURNS TRIGGER AS $$
BEGIN
    -- Additional cleanup if needed beyond CASCADE
    -- Currently CASCADE handles everything
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
