// T5 notifications: outbound WhatsApp channel. Posts a plain JSON payload to
// the group's configured whatsapp_webhook_url (a Twilio/Zapier/whatever
// bridge the group owner wires up -- this app has no direct WhatsApp
// integration). See docs/rework-plan.md §2.6.

import type { NotificationType } from '../types'

const TIMEOUT_MS = 10_000

export interface WhatsappWebhookMessage {
  text: string
  type: NotificationType
  payload: unknown
}

export async function sendWhatsappWebhook(
  webhookUrl: string,
  message: WhatsappWebhookMessage
): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`El webhook respondió con status ${response.status}`)
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('El webhook no respondió a tiempo (10s)')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}
