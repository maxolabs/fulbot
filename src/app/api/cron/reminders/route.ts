// T5 notifications: emits `match_reminder` for matches starting within each
// group's configured notification_settings.reminder_hours_before window.
// Registered in vercel.json as a daily cron; guarded by CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MatchReminderPayload } from '@/lib/notifications/types'
import type { Json } from '@/types/database'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const supabase = createAdminClient()

  try {
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
      const windowEnd = new Date(now.getTime() + hours * 60 * 60 * 1000)

      const { data: group } = await supabase
        .from('groups')
        .select('name, timezone')
        .eq('id', settings.group_id)
        .single()

      const { data: matches, error: matchesError } = await supabase
        .from('matches')
        .select('id, group_id, date_time, location')
        .eq('group_id', settings.group_id)
        .in('status', ['teams_created', 'full', 'signup_open'])
        .gte('date_time', now.toISOString())
        .lte('date_time', windowEnd.toISOString())

      if (matchesError) {
        console.error('Error fetching matches for reminders:', matchesError)
        continue
      }

      for (const match of matches ?? []) {
        const { data: existing, error: existingError } = await supabase
          .from('notifications')
          .select('id')
          .eq('match_id', match.id)
          .eq('type', 'match_reminder')
          .limit(1)

        if (existingError) {
          console.error('Error checking existing match_reminder:', existingError)
          continue
        }

        if (existing && existing.length > 0) {
          skipped++
          continue
        }

        const time = new Intl.DateTimeFormat('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: group?.timezone || 'America/Argentina/Buenos_Aires',
        }).format(new Date(match.date_time))

        const payload: MatchReminderPayload = {
          match_id: match.id,
          group_name: group?.name ?? '',
          time,
          location: match.location,
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

    return NextResponse.json({ success: true, emitted, skipped })
  } catch (error) {
    console.error('Error running reminders cron:', error)
    return NextResponse.json({ error: 'Error al procesar recordatorios' }, { status: 500 })
  }
}
