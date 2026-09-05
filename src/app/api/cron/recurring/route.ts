import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { emitPendingMatchCreatedNotifications } from '@/lib/notifications/match-created'

// Sweep that materializes the next match instance for every active
// recurring pattern, across all groups. Also called lazily, scoped to one
// group, from the group page server component. Not registered in
// vercel.json directly -- Vercel Hobby only allows one daily cron, so this
// runs as one step of the consolidated GET /api/cron/daily route (see
// docs/rework-plan.md §2.4/§2.6). Kept standalone for manual/local invocation.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('generate_recurring_matches', {})

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Emit match_created (§2.6) for whatever this sweep (or a racing lazy
  // group-page call) just created; see src/lib/notifications/match-created.ts.
  const notified = await emitPendingMatchCreatedNotifications(supabase)

  return NextResponse.json({ created: data ?? 0, notified })
}
