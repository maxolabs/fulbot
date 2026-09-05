// T5 notifications: emits `match_reminder` for matches starting within each
// group's configured notification_settings.reminder_hours_before window.
// Guarded by CRON_SECRET. Not registered in vercel.json directly -- Vercel
// Hobby only allows one daily cron, so this sweep runs as one step of the
// consolidated GET /api/cron/daily route (see docs/rework-plan.md §2.4/§2.6).
// This route is kept standalone for manual/local triggering and as the
// single source of truth other tracks or a future plan upgrade can point a
// dedicated cron at.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { emitMatchReminders } from '@/lib/notifications/reminders'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const supabase = createAdminClient()

  try {
    const result = await emitMatchReminders(supabase)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('Error running reminders cron:', error)
    return NextResponse.json({ error: 'Error al procesar recordatorios' }, { status: 500 })
  }
}
