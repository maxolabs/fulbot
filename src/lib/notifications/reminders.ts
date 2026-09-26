// T5 notifications: emits `match_reminder` for matches starting within each
// group's configured notification_settings.reminder_hours_before window. See
// docs/rework-plan.md §2.6. Extracted from the standalone
// GET /api/cron/reminders route so the consolidated GET /api/cron/daily route
// (see vercel.json / §2.4 caveat) can call the same logic without duplicating
// it.
//
// One group-wide row per match (one WhatsApp message to the group). In the app
// and on devices it only reaches the players confirmed for that match:
// push_audience_matches (00026) checks match_signups for 'match_reminder'.
//
// Dedupe is per match *date*: a match that was rescheduled after its reminder
// went out gets a new one for the new time (emit_notification applies the
// same rule under an advisory lock, 00030).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import type { MatchReminderPayload } from './types'
import { DEFAULT_TIMEZONE, formatMatchTime } from '@/lib/utils/datetime'

export interface RemindersResult {
  emitted: number
  skipped: number
}

export async function emitMatchReminders(
  supabase: SupabaseClient<Database>
): Promise<RemindersResult> {
  const { data: settingsRows, error: settingsError } = await supabase
    .from('notification_settings')
    .select('group_id, reminder_hours_before')

  if (settingsError) {
    throw new Error(settingsError.message)
  }

  const now = new Date()
  let emitted = 0
  let skipped = 0

  for (const settings of settingsRows ?? []) {
    const hours = settings.reminder_hours_before ?? 3
    // 0 is the explicit "no reminder" setting (the form validates 0..48).
    if (!Number.isFinite(hours) || hours <= 0) continue
    const windowEnd = new Date(now.getTime() + hours * 60 * 60 * 1000)

    const { data: group } = await supabase
      .from('groups')
      .select('name, timezone')
      .eq('id', settings.group_id)
      .single()

    const { data: matches, error: matchesError } = await supabase
      .from('matches')
      .select('id, group_id, date_time, location, status')
      .eq('group_id', settings.group_id)
      .in('status', ['teams_created', 'full', 'signup_open', 'signup_closed'])
      .gte('date_time', now.toISOString())
      .lte('date_time', windowEnd.toISOString())

    if (matchesError) {
      console.error('Error fetching matches for reminders:', matchesError)
      continue
    }

    for (const match of matches ?? []) {
      const { data: existing, error: existingError } = await supabase
        .from('notifications')
        .select('payload')
        .eq('match_id', match.id)
        .eq('type', 'match_reminder')

      if (existingError) {
        console.error('Error checking existing match_reminder:', existingError)
        continue
      }

      // Rows written before 00030 have no date_time; emit_notification decides
      // those (they count until the match is rescheduled).
      const matchStart = Date.parse(match.date_time)
      const alreadySent = (existing ?? []).some((row) => {
        const sentFor = (row.payload as { date_time?: unknown } | null)?.date_time
        return typeof sentFor === 'string' && Date.parse(sentFor) === matchStart
      })
      if (alreadySent) {
        skipped++
        continue
      }

      const time = formatMatchTime(match.date_time, group?.timezone || DEFAULT_TIMEZONE)

      const payload: MatchReminderPayload = {
        match_id: match.id,
        group_name: group?.name ?? '',
        time,
        location: match.location,
        date_time: match.date_time,
        has_teams: match.status === 'teams_created',
      }

      const { error: rpcError } = await supabase.rpc('emit_notification', {
        p_group_id: match.group_id,
        p_match_id: match.id,
        p_type: 'match_reminder',
        p_payload: payload as unknown as Json,
      })

      if (rpcError) {
        console.error('Error emitting match_reminder:', rpcError)
        continue
      }

      emitted++
    }
  }

  return { emitted, skipped }
}
