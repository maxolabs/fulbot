// T5 notifications: drains notification_outbox. Guarded by CRON_SECRET so it
// can't be triggered by anyone else. Not registered in vercel.json directly
// -- Vercel Hobby only allows one daily cron, so this runs as one step of the
// consolidated GET /api/cron/daily route (see docs/rework-plan.md §2.4/§2.6).
// Kept standalone for manual/local invocation.
import { NextRequest, NextResponse } from 'next/server'
import { drainOutbox } from '@/lib/notifications/dispatch'

// Next 14 serves GET fetches from its Data Cache in a route handler that only
// exports GET, and supabase-js reads are GET fetches: without these, a query
// with a constant URL would return its first answer forever.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const result = await drainOutbox()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('Error draining notification outbox:', error)
    return NextResponse.json(
      { error: 'Error al procesar la cola de notificaciones' },
      { status: 500 }
    )
  }
}
