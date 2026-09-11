// Scheduler tick (docs/match-results-consensus.md §11.2). Claims and runs every
// due `scheduled_jobs` row, then drains the notification outbox. Safe to call
// as often as you like; guarded by CRON_SECRET. Called by scripts/ticker.ts,
// by /api/cron/daily (as a floor when no ticker is running) and by the
// opportunistic tick fired from the dashboard layout.
import { NextRequest, NextResponse } from 'next/server'
import { runTick } from '@/lib/notifications/tick'

export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  return Boolean(process.env.CRON_SECRET) && authHeader === `Bearer ${process.env.CRON_SECRET}`
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const result = await runTick()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    // Never let a missing RPC or a DB hiccup surface as an unhandled crash:
    // the ticker logs the message and simply tries again next interval.
    const message = error instanceof Error ? error.message : 'Error desconocido'
    console.error('Error running scheduler tick:', error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
