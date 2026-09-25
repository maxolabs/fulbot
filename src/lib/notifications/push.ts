import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildPushPayload, isAllowedPushEndpoint, type PushEvent } from './push-payload'

interface PushDelivery extends PushEvent {
  id: string
  lease_id: string
  attempts: number
  subscription_id: string
  endpoint: string
  p256dh: string
  auth: string
  allowed: boolean
}

export function pushConfiguration() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return null
  // A malformed key or subject would otherwise fail every send and retry.
  try { webpush.setVapidDetails(subject, publicKey, privateKey) } catch { return null }
  return { publicKey, privateKey, subject }
}

export async function drainPushOutbox() {
  const vapidDetails = pushConfiguration()
  if (!vapidDetails) return { configured: false, sent: 0, failed: 0, skipped: 0 }
  const db = createAdminClient()
  const { data, error } = await db.rpc('claim_push_deliveries', { p_limit: 30 })
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as PushDelivery[]
  const result = { configured: true, sent: 0, failed: 0, skipped: 0 }

  // Small parallel batches bound provider latency and serverless execution time.
  for (let start = 0; start < rows.length; start += 5) {
    await Promise.all(rows.slice(start, start + 5).map(async (row) => {
      let status: 'sent' | 'skipped' | 'pending' | 'failed' = 'skipped'
      let lastError: string | null = null
      if (row.allowed && isAllowedPushEndpoint(row.endpoint)) {
        try {
          await webpush.sendNotification(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            JSON.stringify(buildPushPayload(row)),
            { vapidDetails, TTL: 3600, timeout: 8000, urgency: 'normal', topic: row.notification_id.replaceAll('-', '') }
          )
          status = 'sent'
          result.sent++
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode
          if (code === 404 || code === 410) {
            const { error: deleteError } = await db.from('push_subscriptions').delete().eq('id', row.subscription_id)
            if (deleteError) throw new Error(deleteError.message)
            result.skipped++
            return
          }
          // Do not persist provider responses: these may contain subscription secrets.
          lastError = code ? `Push service HTTP ${code}` : 'Push delivery failed'
          status = row.attempts >= 5 || (code && code >= 400 && code < 500 && code !== 429) ? 'failed' : 'pending'
          result.failed++
        }
      } else {
        result.skipped++
      }
      const { error: updateError } = await db.from('push_deliveries').update({
        status, last_error: lastError,
        available_at: new Date(Date.now() + Math.min(3600, 60 * 2 ** row.attempts) * 1000).toISOString(),
      }).eq('id', row.id).eq('lease_id', row.lease_id)
      if (updateError) throw new Error(updateError.message)
    }))
  }
  return result
}
