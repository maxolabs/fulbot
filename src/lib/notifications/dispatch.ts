// T5 notifications: drains notification_outbox, sending each pending row over
// its channel (only 'whatsapp_webhook' exists today) and recording the
// outcome. Called from every scheduler tick (tick.ts: ticker, /api/cron/tick,
// the daily cron, page loads) and GET /api/cron/notifications. See
// docs/rework-plan.md §2.6.

import { createAdminClient } from '@/lib/supabase/admin'
import { renderNotificationText } from './templates'
import { sendWhatsappWebhook } from './channels/whatsapp-webhook'
import type { NotificationEvent, NotificationType } from './types'
import type { Database } from '@/types/database'
import { DEFAULT_TIMEZONE } from '@/lib/utils/datetime'

const MAX_ATTEMPTS = 5
// Each send may take up to 10s; keep a batch well inside the 10-minute stale
// claim window of claim_notification_outbox (00026).
const BATCH_SIZE = 20

// Retry delay after a failed send: 2, 4, 8, 16 minutes (capped at an hour).
// claim_notification_outbox (00030) only claims rows whose available_at has
// passed, and marks rows 'skipped' once they are stale (older than 24 hours,
// or a pre-match message for a match that already started, finished or was
// cancelled), so a flaky webhook never delivers yesterday's reminder.
export function outboxRetryDelayMs(attempts: number): number {
  return Math.min(60, 2 ** Math.max(1, attempts)) * 60 * 1000
}

type OutboxUpdate = Database['public']['Tables']['notification_outbox']['Update']

export interface DrainOutboxResult {
  processed: number
  sent: number
  failed: number
}

interface ClaimedOutboxRow {
  id: string
  lease_id: string
  group_id: string
  type: NotificationType
  payload: unknown
  channel: string
  // Already includes this attempt: the claim counts it.
  attempts: number
  webhook_url: string | null
  timezone: string | null
}

// Rows are claimed atomically (FOR UPDATE SKIP LOCKED, status 'sending'), so
// the ticker, the daily cron and page-load ticks can drain at the same time
// without sending a row twice. Every write back is fenced by lease_id: a row
// whose claim went stale and was re-claimed elsewhere is left alone.
export async function drainOutbox(): Promise<DrainOutboxResult> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('claim_notification_outbox', { p_limit: BATCH_SIZE })

  if (error) {
    throw new Error(`No se pudo leer la cola de notificaciones: ${error.message}`)
  }

  const rows = (data ?? []) as unknown as ClaimedOutboxRow[]
  if (rows.length === 0) {
    return { processed: 0, sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0

  const settle = async (row: ClaimedOutboxRow, update: OutboxUpdate) => {
    await supabase
      .from('notification_outbox')
      .update({ ...update, claimed_at: null, lease_id: null })
      .eq('id', row.id)
      .eq('lease_id', row.lease_id)
  }

  for (const row of rows) {
    const webhookUrl = row.webhook_url

    if (!webhookUrl || webhookUrl.trim() === '') {
      await settle(row, { status: 'failed', last_error: 'El grupo no tiene whatsapp_webhook_url configurada' })
      failed++
      continue
    }

    try {
      const event = { type: row.type, payload: row.payload } as unknown as NotificationEvent
      const text = renderNotificationText(event, row.timezone || DEFAULT_TIMEZONE)

      await sendWhatsappWebhook(webhookUrl, {
        text,
        type: event.type,
        payload: row.payload,
      })

      await settle(row, { status: 'sent', sent_at: new Date().toISOString(), last_error: null })
      sent++
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido'
      const exhausted = row.attempts >= MAX_ATTEMPTS
      await settle(row, {
        status: exhausted ? 'failed' : 'pending',
        last_error: message,
        ...(exhausted ? {} : { available_at: new Date(Date.now() + outboxRetryDelayMs(row.attempts)).toISOString() }),
      })
      failed++
    }
  }

  return { processed: rows.length, sent, failed }
}
