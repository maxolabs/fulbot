-- FUTBOT Row Level Security Policies

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_mvp_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rule_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_badges ENABLE ROW LEVEL SECURITY;

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Get current user's player profile id
CREATE OR REPLACE FUNCTION get_current_player_id()
RETURNS UUID AS $$
BEGIN
    RETURN (
        SELECT id FROM public.player_profiles
        WHERE user_id = auth.uid()
        LIMIT 1
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Check if user is a member of a group
CREATE OR REPLACE FUNCTION is_group_member(group_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.group_memberships gm
        JOIN public.player_profiles pp ON gm.player_id = pp.id
        WHERE gm.group_id = group_uuid
        AND pp.user_id = auth.uid()
        AND gm.is_active = TRUE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Check if user is group admin
CREATE OR REPLACE FUNCTION is_group_admin(group_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.group_memberships gm
        JOIN public.player_profiles pp ON gm.player_id = pp.id
        WHERE gm.group_id = group_uuid
        AND pp.user_id = auth.uid()
        AND gm.role = 'admin'
        AND gm.is_active = TRUE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Check if user is group admin or captain
CREATE OR REPLACE FUNCTION is_group_admin_or_captain(group_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.group_memberships gm
        JOIN public.player_profiles pp ON gm.player_id = pp.id
        WHERE gm.group_id = group_uuid
        AND pp.user_id = auth.uid()
        AND gm.role IN ('admin', 'captain')
        AND gm.is_active = TRUE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================
-- USERS POLICIES
-- ============================================

CREATE POLICY "Users can read their own data"
    ON public.users FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update their own data"
    ON public.users FOR UPDATE
    USING (auth.uid() = id);

-- ============================================
-- PLAYER PROFILES POLICIES
-- ============================================

-- Users can read profiles of players in their groups
CREATE POLICY "Users can read player profiles in their groups"
    ON public.player_profiles FOR SELECT
    USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.group_memberships gm1
            JOIN public.group_memberships gm2 ON gm1.group_id = gm2.group_id
            JOIN public.player_profiles pp ON gm2.player_id = pp.id
            WHERE gm1.player_id = player_profiles.id
            AND pp.user_id = auth.uid()
            AND gm1.is_active = TRUE
            AND gm2.is_active = TRUE
        )
    );

CREATE POLICY "Users can update their own profile"
    ON public.player_profiles FOR UPDATE
    USING (user_id = auth.uid());

-- ============================================
-- GROUPS POLICIES
-- ============================================

-- Members can read their groups
CREATE POLICY "Members can read their groups"
    ON public.groups FOR SELECT
    USING (is_group_member(id));

-- Anyone can read group by invite code (for joining)
CREATE POLICY "Anyone can read group by invite code"
    ON public.groups FOR SELECT
    USING (TRUE);

-- Authenticated users can create groups
CREATE POLICY "Authenticated users can create groups"
    ON public.groups FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- Admins can update their groups
CREATE POLICY "Admins can update their groups"
    ON public.groups FOR UPDATE
    USING (is_group_admin(id));

-- ============================================
-- GROUP MEMBERSHIPS POLICIES
-- ============================================

CREATE POLICY "Members can read memberships in their groups"
    ON public.group_memberships FOR SELECT
    USING (is_group_member(group_id));

CREATE POLICY "Admins can insert memberships"
    ON public.group_memberships FOR INSERT
    WITH CHECK (is_group_admin(group_id) OR
        -- Allow self-join via invite
        (SELECT pp.id FROM public.player_profiles pp WHERE pp.user_id = auth.uid()) = player_id
    );

CREATE POLICY "Admins can update memberships"
    ON public.group_memberships FOR UPDATE
    USING (is_group_admin(group_id));

CREATE POLICY "Admins can delete memberships"
    ON public.group_memberships FOR DELETE
    USING (is_group_admin(group_id));

-- ============================================
-- MATCHES POLICIES
-- ============================================

CREATE POLICY "Members can read matches in their groups"
    ON public.matches FOR SELECT
    USING (is_group_member(group_id));

CREATE POLICY "Admins can create matches"
    ON public.matches FOR INSERT
    WITH CHECK (is_group_admin(group_id));

CREATE POLICY "Admins and captains can update matches"
    ON public.matches FOR UPDATE
    USING (is_group_admin_or_captain(group_id));

CREATE POLICY "Admins can delete matches"
    ON public.matches FOR DELETE
    USING (is_group_admin(group_id));

-- ============================================
-- MATCH SIGNUPS POLICIES
-- ============================================

CREATE POLICY "Members can read signups"
    ON public.match_signups FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_id AND is_group_member(m.group_id)
        )
    );

CREATE POLICY "Members can create their own signups"
    ON public.match_signups FOR INSERT
    WITH CHECK (
        player_id = get_current_player_id() AND
        EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_id AND is_group_member(m.group_id)
        )
    );

CREATE POLICY "Members can update their own signups"
    ON public.match_signups FOR UPDATE
    USING (player_id = get_current_player_id());

CREATE POLICY "Admins can manage all signups"
    ON public.match_signups FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_id AND is_group_admin(m.group_id)
        )
    );

-- ============================================
-- TEAMS POLICIES
-- ============================================

CREATE POLICY "Members can read teams"
    ON public.teams FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_id AND is_group_member(m.group_id)
        )
    );

CREATE POLICY "Admins and captains can manage teams"
    ON public.teams FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_id AND is_group_admin_or_captain(m.group_id)
        )
    );

-- ============================================
-- TEAM ASSIGNMENTS POLICIES
-- ============================================

CREATE POLICY "Members can read assignments"
    ON public.team_assignments FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.teams t
            JOIN public.matches m ON m.id = t.match_id
            WHERE t.id = team_id AND is_group_member(m.group_id)
        )
    );

CREATE POLICY "Admins and captains can manage assignments"
    ON public.team_assignments FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.teams t
            JOIN public.matches m ON m.id = t.match_id
            WHERE t.id = team_id AND is_group_admin_or_captain(m.group_id)
        )
    );

-- ============================================
-- RATINGS POLICIES
-- ============================================

CREATE POLICY "Members can read ratings"
    ON public.match_ratings FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_id AND is_group_member(m.group_id)
        )
    );

CREATE POLICY "Players can create ratings for matches they played"
    ON public.match_ratings FOR INSERT
    WITH CHECK (
        voter_player_id = get_current_player_id() AND
        EXISTS (
            SELECT 1 FROM public.match_signups ms
            WHERE ms.match_id = match_ratings.match_id
            AND ms.player_id = get_current_player_id()
            AND ms.status = 'confirmed'
        )
    );

-- ============================================
-- MVP VOTES POLICIES
-- ============================================

CREATE POLICY "Members can read MVP votes"
    ON public.match_mvp_votes FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_id AND is_group_member(m.group_id)
        )
    );

CREATE POLICY "Players can vote MVP"
    ON public.match_mvp_votes FOR INSERT
    WITH CHECK (
        voter_player_id = get_current_player_id() AND
        EXISTS (
            SELECT 1 FROM public.match_signups ms
            WHERE ms.match_id = match_mvp_votes.match_id
            AND ms.player_id = get_current_player_id()
            AND ms.status = 'confirmed'
        )
    );

-- ============================================
-- RULE SETS POLICIES
-- ============================================

CREATE POLICY "Members can read rules"
    ON public.rule_sets FOR SELECT
    USING (
        (group_id IS NOT NULL AND is_group_member(group_id)) OR
        (match_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_id AND is_group_member(m.group_id)
        ))
    );

CREATE POLICY "Admins can manage rules"
    ON public.rule_sets FOR ALL
    USING (
        (group_id IS NOT NULL AND is_group_admin(group_id)) OR
        (match_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_id AND is_group_admin(m.group_id)
        ))
    );

-- ============================================
-- GUEST PLAYERS POLICIES
-- ============================================

CREATE POLICY "Members can read guests"
    ON public.guest_players FOR SELECT
    USING (is_group_member(group_id));

CREATE POLICY "Admins can manage guests"
    ON public.guest_players FOR ALL
    USING (is_group_admin(group_id));

-- ============================================
-- NOTIFICATION SETTINGS POLICIES
-- ============================================

CREATE POLICY "Members can read notification settings"
    ON public.notification_settings FOR SELECT
    USING (is_group_member(group_id));

CREATE POLICY "Admins can manage notification settings"
    ON public.notification_settings FOR ALL
    USING (is_group_admin(group_id));

-- ============================================
-- PLAYER BADGES POLICIES
-- ============================================

CREATE POLICY "Anyone can read badges"
    ON public.player_badges FOR SELECT
    USING (TRUE);

CREATE POLICY "System can insert badges"
    ON public.player_badges FOR INSERT
    WITH CHECK (TRUE);
