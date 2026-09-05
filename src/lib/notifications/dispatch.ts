// T5 notifications: drains notification_outbox, sending each pending row over
// its channel (only 'whatsapp_webhook' exists today) and recording the
// outcome. Called from GET /api/cron/notifications. See docs/rework-plan.md §2.6.

import { createAdminClient } from '@/lib/supabase/admin'
import { renderNotificationText } from './templates'
import { sendWhatsappWebhook } from './channels/whatsapp-webhook'
import type { NotificationEvent, NotificationType } from './types'

const MAX_ATTEMPTS = 5
const BATCH_SIZE = 50

export interface DrainOutboxResult {
  processed: number
  sent: number
  failed: number
}

export async function drainOutbox(): Promise<DrainOutboxResult> {
  const supabase = createAdminClient()

  const { data: rows, error } = await supabase
    .from('notification_outbox')
    .select('id, group_id, type, payload, channel, attempts')
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (error) {
    throw new Error(`No se pudo leer la cola de notificaciones: ${error.message}`)
  }

  if (!rows || rows.length === 0) {
    return { processed: 0, sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0

  for (const row of rows) {
    if (row.channel !== 'whatsapp_webhook') {
      // No other channel implemented yet -- leave it pending rather than
      // silently marking it failed.
      continue
    }

    const { data: settings } = await supabase
      .from('notification_settings')
      .select('whatsapp_webhook_url')
      .eq('group_id', row.group_id)
      .single()

    const webhookUrl = settings?.whatsapp_webhook_url

    if (!webhookUrl || webhookUrl.trim() === '') {
      await supabase
        .from('notification_outbox')
        .update({
          status: 'failed',
          attempts: row.attempts + 1,
          last_error: 'El grupo no tiene whatsapp_webhook_url configurada',
        })
        .eq('id', row.id)
      failed++
      continue
    }

    try {
      const event = { type: row.type as NotificationType, payload: row.payload } as unknown as NotificationEvent
      const text = renderNotificationText(event)

      await sendWhatsappWebhook(webhookUrl, {
        text,
        type: event.type,
        payload: row.payload,
      })

      await supabase
        .from('notification_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString(), attempts: row.attempts + 1 })
        .eq('id', row.id)
      sent++
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido'
      const attempts = row.attempts + 1
      await supabase
        .from('notification_outbox')
        .update({
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          attempts,
          last_error: message,
        })
        .eq('id', row.id)
      failed++
    }
  }

  return { processed: rows.length, sent, failed }
}
