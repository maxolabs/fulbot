-- Public view of a group through its invite code, including the next open match, so the
-- invite page can offer "sign up as a guest" to visitors without an account.

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
              AND m.status IN ('signup_open', 'full')
              AND m.date_time > NOW() - INTERVAL '2 hours'
            ORDER BY m.date_time ASC
            LIMIT 1
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION get_public_group_by_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_group_by_invite(TEXT) TO anon, authenticated, service_role;
