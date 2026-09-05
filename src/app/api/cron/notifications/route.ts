// T5 notifications: drains notification_outbox. Registered in vercel.json as
// a daily cron; guarded by CRON_SECRET so it can't be triggered by anyone else.
import { NextRequest, NextResponse } from 'next/server'
import { drainOutbox } from '@/lib/notifications/dispatch'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
