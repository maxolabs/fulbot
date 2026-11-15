// T5 notifications: outbound WhatsApp channel. Posts a plain JSON payload to
// the group's configured whatsapp_webhook_url (a Twilio/Zapier/whatever
// bridge the group owner wires up -- this app has no direct WhatsApp
// integration). See docs/rework-plan.md §2.6.
//
// The URL is admin input fetched from the server, so it is treated as hostile
// (review E#22, SSRF): https only, no credentials, no local host names or
// private IP literals (checkWebhookUrl), and the connection itself resolves
// DNS through safeLookup, which refuses unless every address is public. The
// check happens inside the socket's own lookup, so a DNS answer can't change
// between the check and the connect. Redirects are never followed and the
// whole request is capped at 10s.

import { request } from 'https'
import { lookup as dnsLookup, type LookupAddress } from 'dns'
import type { LookupFunction } from 'net'
import type { NotificationType } from '../types'
import { checkWebhookUrl, isPublicIpAddress } from '../webhook-url'

const TIMEOUT_MS = 10_000

export interface WhatsappWebhookMessage {
  text: string
  type: NotificationType
  payload: unknown
}

const BLOCKED_ADDRESS = 'El webhook apunta a una dirección de red no permitida'

const safeLookup = ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err)
    if (addresses.length === 0 || addresses.some((a) => !isPublicIpAddress(a.address))) {
      return callback(new Error(BLOCKED_ADDRESS))
    }
    if (options?.all) return callback(null, addresses)
    return callback(null, addresses[0].address, addresses[0].family)
  })
}) as unknown as LookupFunction

export async function sendWhatsappWebhook(
  webhookUrl: string,
  message: WhatsappWebhookMessage
): Promise<void> {
  const problem = checkWebhookUrl(webhookUrl)
  if (problem) {
    throw new Error(
      problem === 'https'
        ? 'El webhook tiene que usar https'
        : problem === 'invalid'
          ? 'La URL del webhook no es válida'
          : BLOCKED_ADDRESS
    )
  }

  const body = JSON.stringify(message)

  await new Promise<void>((resolve, reject) => {
    const req = request(
      webhookUrl.trim(),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
      },
      (response) => {
        response.resume()
        const status = response.statusCode ?? 0
        if (status >= 300 && status < 400) {
          reject(new Error(`El webhook respondió con una redirección (${status}); no se siguen redirecciones`))
        } else if (status < 200 || status >= 300) {
          reject(new Error(`El webhook respondió con status ${status}`))
        } else {
          resolve()
        }
      }
    )
    const deadline = setTimeout(() => req.destroy(new Error('El webhook no respondió a tiempo (10s)')), TIMEOUT_MS)
    req.on('timeout', () => req.destroy(new Error('El webhook no respondió a tiempo (10s)')))
    req.on('error', reject)
    req.on('close', () => clearTimeout(deadline))
    req.end(body)
  })
}
