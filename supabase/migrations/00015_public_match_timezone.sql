-- The public /m/[matchId] page formats match date_time client- and
-- server-side without knowing the group's timezone, so it fell back to the
-- runtime's local timezone (UTC on Vercel, whatever the browser is set to
-- locally) instead of the group's actual timezone. get_public_match()'s JSON
-- had no timezone key for the page to use, so this adds one. Identical body
-- to 00007_signup_flow.sql's get_public_match otherwise.

CREATE OR REPLACE FUNCTION get_public_match(p_match_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'id', m.id,
        'group_name', g.name,
        'group_slug', g.slug,
        'date_time', m.date_time,
        'location', m.location,
        'notes', m.notes,
        'status', m.status,
        'max_players', m.max_players,
        'timezone', g.timezone,
        'confirmed_count', (
            SELECT COUNT(*) FROM public.match_signups ms
            WHERE ms.match_id = m.id AND ms.status = 'confirmed'
        ),
        'waitlist_count', (
            SELECT COUNT(*) FROM public.match_signups ms
            WHERE ms.match_id = m.id AND ms.status = 'waitlist'
        ),
        'confirmed_names', (
            SELECT COALESCE(jsonb_agg(s.name ORDER BY s.signup_time), '[]'::jsonb)
            FROM (
                SELECT COALESCE(pp.display_name, gp.display_name) AS name, ms.signup_time
                FROM public.match_signups ms
                LEFT JOIN public.player_profiles pp ON pp.id = ms.player_id
                LEFT JOIN public.guest_players gp ON gp.id = ms.guest_player_id
                WHERE ms.match_id = m.id AND ms.status = 'confirmed'
            ) s
        ),
        'waitlist_names', (
            SELECT COALESCE(jsonb_agg(s.name ORDER BY s.waitlist_position), '[]'::jsonb)
            FROM (
                SELECT COALESCE(pp.display_name, gp.display_name) AS name, ms.waitlist_position
                FROM public.match_signups ms
                LEFT JOIN public.player_profiles pp ON pp.id = ms.player_id
                LEFT JOIN public.guest_players gp ON gp.id = ms.guest_player_id
                WHERE ms.match_id = m.id AND ms.status = 'waitlist'
            ) s
        )
    ) INTO v_result
    FROM public.matches m
    JOIN public.groups g ON g.id = m.group_id
    WHERE m.id = p_match_id;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

REVOKE ALL ON FUNCTION get_public_match(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_public_match(UUID) TO anon, authenticated, service_role;
