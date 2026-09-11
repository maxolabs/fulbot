import { createClient } from '@/lib/supabase/server'
import type { Database, MemberScoringSettings } from '@/types/database'
import { SignupPolicyNoticeView, type SignupPolicyReason } from './signup-policy-notice-view'

// Tells a member, before they tap "Anotarme", that the group's member scoring
// policy will send them to the waitlist (docs/member-scoring.md §5.1, §5.2,
// §6, §10.4). Mirrors the decision order of signup_for_match() in 00021:
// no-show cooldown first, then the priority window / reserved spots for
// members whose score is below the threshold. Newcomers (NULL score) are
// never affected. Renders nothing when no policy applies, so both the match
// page and the public /m page can drop it in unconditionally.

interface SignupPolicyNoticeProps {
  matchId: string
  groupId: string
  // The viewer's player_profiles.id
  playerId: string
  timeZone: string
}

const HOUR_MS = 60 * 60 * 1000

export async function SignupPolicyNotice({
  matchId,
  groupId,
  playerId,
  timeZone,
}: SignupPolicyNoticeProps) {
  const supabase = await createClient()

  const { data: match } = await supabase
    .from('matches')
    .select('status, date_time, signup_opened_at, max_players')
    .eq('id', matchId)
    .maybeSingle() as {
      data: {
        status: string
        date_time: string
        signup_opened_at: string | null
        max_players: number
      } | null
    }

  if (!match || match.status !== 'signup_open') return null

  const settingsArgs: Database['public']['Functions']['member_scoring_settings']['Args'] = {
    p_group_id: groupId,
  }
  const { data: settings } = await supabase.rpc('member_scoring_settings', settingsArgs) as {
    data: MemberScoringSettings | null
  }

  if (!settings?.enabled) return null

  const { data: membership } = await supabase
    .from('group_memberships')
    .select('member_score, signup_cooldown')
    .eq('group_id', groupId)
    .eq('player_id', playerId)
    .eq('is_active', true)
    .maybeSingle() as { data: { member_score: number | null; signup_cooldown: boolean } | null }

  if (!membership) return null

  const { mode, threshold, window_hours: windowHours, reserved_spots: reservedSpots } = settings.priority
  const score = membership.member_score === null ? null : Number(membership.member_score)
  const now = new Date().getTime()

  let reason: SignupPolicyReason | null = null
  let untilIso: string | null = null

  if (membership.signup_cooldown && settings.no_show_cooldown) {
    reason = 'cooldown'
  } else if (score !== null && score < threshold) {
    if (mode === 'window' && match.signup_opened_at) {
      const windowEnd = new Date(match.signup_opened_at).getTime() + windowHours * HOUR_MS
      if (now < windowEnd) {
        reason = 'priority_window'
        untilIso = new Date(windowEnd).toISOString()
      }
    } else if (mode === 'reserved') {
      const reservedUntil = new Date(match.date_time).getTime() - windowHours * HOUR_MS
      if (now < reservedUntil) {
        // Reserved spots only bite once the open ones are taken.
        const { count } = await supabase
          .from('match_signups')
          .select('id', { count: 'exact', head: true })
          .eq('match_id', matchId)
          .eq('status', 'confirmed')
        if ((count ?? 0) >= match.max_players - reservedSpots) {
          reason = 'reserved'
          untilIso = new Date(reservedUntil).toISOString()
        }
      }
    }
  }

  if (!reason) return null

  return (
    <SignupPolicyNoticeView
      reason={reason}
      untilIso={untilIso}
      timeZone={timeZone}
      threshold={threshold}
      reservedSpots={reservedSpots}
    />
  )
}
