import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { emitPendingMatchCreatedNotifications } from '@/lib/notifications/match-created'

// Daily sweep (see vercel.json) that materializes the next match instance for
// every active recurring pattern, across all groups. Also called lazily,
// scoped to one group, from the group page server component -- this route is
// only the scheduled, all-groups trigger (see docs/rework-plan.md §2.4).
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
