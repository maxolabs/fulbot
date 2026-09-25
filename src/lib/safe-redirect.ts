// Post-auth redirect targets (?redirect= on /login and /register, ?next= on
// /api/auth/callback) come from the URL, so anyone can craft them. Only
// same-origin relative paths are allowed: a single leading slash, no
// protocol-relative `//host`, no backslashes (browsers read `/\host` as
// `//host`), no schemes, no control characters, including when
// percent-encoded. Anything else falls back.
//
// No 'use client' and no Node APIs: used by the middleware (edge), route
// handlers and client forms.

export const DEFAULT_REDIRECT = '/groups'

const PROBE_ORIGIN = 'http://fulbot.invalid'

function isUnsafe(value: string): boolean {
  if (!value.startsWith('/')) return true
  if (value.startsWith('//')) return true
  if (value.includes('\\')) return true
  // Control characters (the URL parser strips tabs and newlines, which can
  // turn `/\t/host` into `//host`).
  if (/[\u0000-\u001f\u007f]/.test(value)) return true
  return false
}

export function safeRedirect(
  value: string | null | undefined,
  fallback: string = DEFAULT_REDIRECT
): string {
  if (!value) return fallback
  if (isUnsafe(value)) return fallback

  // Check the percent-decoded form too (e.g. `/%2F%2Fhost`, `/%5Chost`).
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return fallback
  }
  if (isUnsafe(decoded)) return fallback

  // Final check with the URL parser: the target must stay on our origin.
  try {
    const url = new URL(value, PROBE_ORIGIN)
    if (url.origin !== PROBE_ORIGIN) return fallback
  } catch {
    return fallback
  }

  return value
}
