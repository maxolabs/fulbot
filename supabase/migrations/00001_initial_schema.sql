-- FUTBOT Initial Schema
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- ENUM TYPES
-- ============================================

CREATE TYPE user_language AS ENUM ('es', 'en');
CREATE TYPE footedness AS ENUM ('left', 'right', 'both');
CREATE TYPE fitness_status AS ENUM ('ok', 'limited', 'injured');
CREATE TYPE group_role AS ENUM ('admin', 'captain', 'member');
CREATE TYPE match_status AS ENUM ('draft', 'signup_open', 'full', 'teams_created', 'finished', 'cancelled');
CREATE TYPE signup_status AS ENUM ('confirmed', 'waitlist', 'cancelled', 'did_not_show');
CREATE TYPE team_name AS ENUM ('dark', 'light');
CREATE TYPE assignment_source AS ENUM ('ai', 'manual');
CREATE TYPE rule_type AS ENUM ('avoid_pair', 'force_pair', 'min_defenders', 'min_goalkeepers', 'balance_rating');

-- ============================================
-- 1. USERS (extends Supabase auth.users)
-- ============================================

CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT,
    preferred_language user_language DEFAULT 'es',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. PLAYER PROFILES
-- ============================================

CREATE TABLE public.player_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    display_name TEXT NOT NULL,
    nickname TEXT,
    preferred_positions TEXT[] DEFAULT ARRAY['CM'],
    main_position TEXT DEFAULT 'CM',
    footedness footedness DEFAULT 'right',
    goalkeeper_willingness SMALLINT DEFAULT 0 CHECK (goalkeeper_willingness BETWEEN 0 AND 3),
    reliability_score DECIMAL(3,2) DEFAULT 1.00 CHECK (reliability_score BETWEEN 0 AND 1),
    fitness_status fitness_status DEFAULT 'ok',
    overall_rating DECIMAL(3,2) DEFAULT 3.00 CHECK (overall_rating BETWEEN 1 AND 5),

    -- Stats
    matches_played INTEGER DEFAULT 0,
    goals INTEGER DEFAULT 0,
    assists INTEGER DEFAULT 0,
    mvp_count INTEGER DEFAULT 0,
    clean_sheets INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_player_profiles_user_id ON public.player_profiles(user_id);

-- ============================================
-- 3. GROUPS
-- ============================================

CREATE TABLE public.groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    default_match_day SMALLINT CHECK (default_match_day BETWEEN 0 AND 6), -- 0=Sunday, 1=Monday
    default_match_time TIME,
    default_max_players SMALLINT DEFAULT 14,
    timezone TEXT DEFAULT 'America/Argentina/Buenos_Aires',
    created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    settings JSONB DEFAULT '{}',
    invite_code TEXT UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_groups_slug ON public.groups(slug);
CREATE INDEX idx_groups_invite_code ON public.groups(invite_code);

-- ============================================
-- 4. GROUP MEMBERSHIPS
-- ============================================

CREATE TABLE public.group_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
    role group_role DEFAULT 'member',
    is_active BOOLEAN DEFAULT TRUE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(group_id, player_id)
);

CREATE INDEX idx_group_memberships_group_id ON public.group_memberships(group_id);
CREATE INDEX idx_group_memberships_player_id ON public.group_memberships(player_id);

-- ============================================
-- 5. MATCHES
-- ============================================

CREATE TABLE public.matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    date_time TIMESTAMPTZ NOT NULL,
    location TEXT,
    status match_status DEFAULT 'draft',
    max_players SMALLINT DEFAULT 14,
    recurring_pattern_id UUID,
    ai_input_snapshot JSONB,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_matches_group_id ON public.matches(group_id);
CREATE INDEX idx_matches_date_time ON public.matches(date_time);
CREATE INDEX idx_matches_status ON public.matches(status);

-- ============================================
-- 6. GUEST PLAYERS
-- ============================================

CREATE TABLE public.guest_players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    display_name TEXT NOT NULL,
    notes TEXT,
    estimated_rating DECIMAL(3,2) DEFAULT 3.00 CHECK (estimated_rating BETWEEN 1 AND 5),
    preferred_positions TEXT[] DEFAULT ARRAY['CM'],
    created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_guest_players_group_id ON public.guest_players(group_id);

-- ============================================
-- 7. MATCH SIGNUPS
-- ============================================

CREATE TABLE public.match_signups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    player_id UUID REFERENCES public.player_profiles(id) ON DELETE CASCADE,
    guest_player_id UUID REFERENCES public.guest_players(id) ON DELETE CASCADE,
    status signup_status DEFAULT 'confirmed',
    signup_time TIMESTAMPTZ DEFAULT NOW(),
    cancel_time TIMESTAMPTZ,
    position_preference TEXT,
    notes TEXT,
    waitlist_position SMALLINT,

    -- Ensure either player_id or guest_player_id is set
    CONSTRAINT signup_player_check CHECK (
        (player_id IS NOT NULL AND guest_player_id IS NULL) OR
        (player_id IS NULL AND guest_player_id IS NOT NULL)
    ),
    -- Prevent duplicate signups
    CONSTRAINT unique_player_signup UNIQUE (match_id, player_id),
    CONSTRAINT unique_guest_signup UNIQUE (match_id, guest_player_id)
);

CREATE INDEX idx_match_signups_match_id ON public.match_signups(match_id);
CREATE INDEX idx_match_signups_player_id ON public.match_signups(player_id);
CREATE INDEX idx_match_signups_status ON public.match_signups(status);

-- ============================================
-- 8. TEAMS
-- ============================================

CREATE TABLE public.teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    name team_name NOT NULL,
    color_hex TEXT DEFAULT '#000000',
    created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(match_id, name)
);

CREATE INDEX idx_teams_match_id ON public.teams(match_id);

-- ============================================
-- 9. TEAM ASSIGNMENTS
-- ============================================

CREATE TABLE public.team_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    player_id UUID REFERENCES public.player_profiles(id) ON DELETE CASCADE,
    guest_player_id UUID REFERENCES public.guest_players(id) ON DELETE CASCADE,
    position TEXT NOT NULL,
    order_index SMALLINT DEFAULT 0,
    source assignment_source DEFAULT 'ai',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure either player_id or guest_player_id is set
    CONSTRAINT assignment_player_check CHECK (
        (player_id IS NOT NULL AND guest_player_id IS NULL) OR
        (player_id IS NULL AND guest_player_id IS NOT NULL)
    )
);

CREATE INDEX idx_team_assignments_team_id ON public.team_assignments(team_id);
CREATE INDEX idx_team_assignments_player_id ON public.team_assignments(player_id);

-- ============================================
-- 10. MATCH RATINGS
-- ============================================

CREATE TABLE public.match_ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    voter_player_id UUID NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
    rated_player_id UUID NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- One rating per voter-rated pair per match
    UNIQUE(match_id, voter_player_id, rated_player_id)
);

CREATE INDEX idx_match_ratings_match_id ON public.match_ratings(match_id);
CREATE INDEX idx_match_ratings_rated_player ON public.match_ratings(rated_player_id);

-- ============================================
-- 11. MATCH MVP VOTES
-- ============================================

CREATE TABLE public.match_mvp_votes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    voter_player_id UUID NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
    candidate_player_id UUID NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- One MVP vote per voter per match
    UNIQUE(match_id, voter_player_id)
);

CREATE INDEX idx_match_mvp_votes_match_id ON public.match_mvp_votes(match_id);

-- ============================================
-- 12. RULE SETS
-- ============================================

CREATE TABLE public.rule_sets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
    match_id UUID REFERENCES public.matches(id) ON DELETE CASCADE,
    rule_type rule_type NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Must belong to either group or match
    CONSTRAINT rule_scope_check CHECK (
        (group_id IS NOT NULL AND match_id IS NULL) OR
        (group_id IS NULL AND match_id IS NOT NULL)
    )
);

CREATE INDEX idx_rule_sets_group_id ON public.rule_sets(group_id);
CREATE INDEX idx_rule_sets_match_id ON public.rule_sets(match_id);

-- ============================================
-- 13. NOTIFICATION SETTINGS
-- ============================================

CREATE TABLE public.notification_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE UNIQUE,
    send_signup_link_on_create BOOLEAN DEFAULT TRUE,
    reminder_hours_before INTEGER DEFAULT 3,
    notify_on_waitlist_promotion BOOLEAN DEFAULT TRUE,
    notify_on_teams_created BOOLEAN DEFAULT TRUE,
    whatsapp_webhook_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 14. PLAYER BADGES
-- ============================================

CREATE TABLE public.player_badges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
    badge_type TEXT NOT NULL,
    earned_at TIMESTAMPTZ DEFAULT NOW(),
    match_id UUID REFERENCES public.matches(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}',

    UNIQUE(player_id, badge_type, match_id)
);

CREATE INDEX idx_player_badges_player_id ON public.player_badges(player_id);

-- ============================================
-- UPDATE TIMESTAMP TRIGGER
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update triggers to tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_player_profiles_updated_at BEFORE UPDATE ON public.player_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_groups_updated_at BEFORE UPDATE ON public.groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_matches_updated_at BEFORE UPDATE ON public.matches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_team_assignments_updated_at BEFORE UPDATE ON public.team_assignments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_notification_settings_updated_at BEFORE UPDATE ON public.notification_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
