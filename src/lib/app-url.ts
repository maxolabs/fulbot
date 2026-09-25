/**
 * The public base URL of the app, without a trailing slash. Links that leave
 * the app (WhatsApp texts, invite links, share sheets) are built from it.
 * NEXT_PUBLIC_APP_URL is inlined at build time, so this works in client and
 * server code alike; the localhost fallback is for local development only.
 */
export function getAppBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
}
