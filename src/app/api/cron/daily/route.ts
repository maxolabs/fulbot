// Consolidated daily cron entry point.
//
// Vercel Hobby only allows a single daily cron job (±59 min drift) -- see
// docs/rework-plan.md §2.4/§2.6. Registering /api/cron/recurring,
// /api/cron/notifications and /api/cron/reminders separately (3 daily crons)
// would exceed that limit, so this route is the only one wired up in
// vercel.json and runs, in order, everything those three used to do on their
// own schedule:
//   1. generate_recurring_matches + emit match_created for whatever it (or a
//      racing group-page lazy call) just created (§2.4).
//   2. drain notification_outbox (WhatsApp webhook deliveries) (§2.6).
//   3. sweep for match_reminder (§2.6).
// Each step is independent: a failure in one is logged and reported in the
// response but never blocks the next step. The three individual routes still
// exist (each still guarded by CRON_SECRET) for manual/local invocation and
// as the single source of truth this route calls into -- they are simply not
// registered in vercel.json anymore.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { emitPendingMatchCreatedNotifications } from '@/lib/notifications/match-created'
import { drainOutbox } from '@/lib/notifications/dispatch'
import { emitMatchReminders } from '@/lib/notifications/reminders'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Error desconocido'
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const result: {
    recurring?: { created: number; notified: number } | { error: string }
    outbox?: Awaited<ReturnType<typeof drainOutbox>> | { error: string }
    reminders?: Awaited<ReturnType<typeof emitMatchReminders>> | { error: string }
  } = {}

  try {
    const { data, error } = await supabase.rpc('generate_recurring_matches', {})
    if (error) throw new Error(error.message)
    const notified = await emitPendingMatchCreatedNotifications(supabase)
    result.recurring = { created: data ?? 0, notified }
  } catch (error) {
    console.error('Error running recurring-matches sweep:', error)
    result.recurring = { error: errorMessage(error) }
  }

  try {
    result.outbox = await drainOutbox()
  } catch (error) {
    console.error('Error draining notification outbox:', error)
    result.outbox = { error: errorMessage(error) }
  }

  try {
    result.reminders = await emitMatchReminders(supabase)
  } catch (error) {
    console.error('Error running reminders sweep:', error)
    result.reminders = { error: errorMessage(error) }
  }

  return NextResponse.json({ success: true, ...result })
}
