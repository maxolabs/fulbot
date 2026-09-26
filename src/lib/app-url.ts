/**
 * The public base URL, without a trailing slash: NEXT_PUBLIC_APP_URL, else
 * the Vercel production domain, else null. next.config.mjs applies the same
 * rules at build time and inlines the result as NEXT_PUBLIC_APP_URL.
 */
export function resolveAppUrl(env: {
  NEXT_PUBLIC_APP_URL?: string
  VERCEL_PROJECT_PRODUCTION_URL?: string
}): string | null {
  const explicit = env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
  return null
}

/**
 * The public base URL of the app, without a trailing slash. Links that leave
 * the app (WhatsApp texts, invite links, share sheets) are built from it.
 *
 * NEXT_PUBLIC_APP_URL is inlined at build time, so this works in client and
 * server code alike. next.config.mjs fills it from VERCEL_PROJECT_PRODUCTION_URL
 * when it is not set, and fails a CI or Vercel build when neither exists. The
 * localhost fallback is only reached in local development.
 */
export function getAppBaseUrl(): string {
  return (
    resolveAppUrl({
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    }) ?? 'http://localhost:3000'
  )
}
