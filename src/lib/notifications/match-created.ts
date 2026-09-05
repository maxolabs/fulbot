// T3 recurring matches (see docs/rework-plan.md §2.4, cross-referenced with
// the notifications contract in §2.6): emits the `match_created` event for
// any recurring-generated match that doesn't have one yet.
//
// This lives here -- a TS helper called right after the
// generate_recurring_matches() RPC -- instead of inside that SQL function
// (00010_recurring_matches.sql) because the canonical MatchCreatedPayload
// (src/types/notifications... see src/lib/notifications/types.ts) needs
// match_id, group_name and signup_url (built from NEXT_PUBLIC_APP_URL), none
// of which SQL can produce correctly. This mirrors every other
// emit_notification call site in the codebase (e.g. cron/reminders/route.ts),
// which are all TS route handlers with access to those values.
//
// Idempotent: only emits for matches that don't already have a match_created
// notification, so it's safe to call after every generate_recurring_matches()
// invocation, including the group-page lazy call that runs on every render.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import type { MatchCreatedPayload } from './types'

type PendingMatch = {
  id: string
  group_id: string
  date_time: string
  location: string | null
  max_players: number
  groups: { name: string } | null
}

export async function emitPendingMatchCreatedNotifications(
  supabase: SupabaseClient<Database>,
  groupId?: string
): Promise<number> {
  let query = supabase
    .from('matches')
    .select('id, group_id, date_time, location, max_players, groups (name)')
    .eq('status', 'signup_open')
    .not('recurring_pattern_id', 'is', null)

  if (groupId) {
    query = query.eq('group_id', groupId)
  }

  const { data: matches } = (await query) as { data: PendingMatch[] | null }

  if (!matches || matches.length === 0) {
    return 0
  }

  const { data: existing } = await supabase
    .from('notifications')
    .select('match_id')
    .eq('type', 'match_created')
    .in('match_id', matches.map((m) => m.id))

  const alreadyNotified = new Set((existing ?? []).map((n) => n.match_id))
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  let emitted = 0

  for (const match of matches) {
    if (alreadyNotified.has(match.id)) continue

    const payload: MatchCreatedPayload = {
      match_id: match.id,
      group_name: match.groups?.name ?? '',
      date_time: match.date_time,
      location: match.location,
      max_players: match.max_players,
      signup_url: `${appUrl}/m/${match.id}`,
    }

    const { error } = await supabase.rpc('emit_notification', {
      p_group_id: match.group_id,
      p_match_id: match.id,
      p_type: 'match_created',
      p_payload: payload as unknown as Json,
    })

    if (!error) {
      emitted++
    }
  }

  return emitted
}
