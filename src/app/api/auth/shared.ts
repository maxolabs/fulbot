// Shared by /api/auth/callback (PKCE ?code=) and /api/auth/confirm
// (?token_hash=, works on any device or browser). Not a route: only route.ts
// files are routed.
import { NextResponse } from 'next/server'
import type { createClient } from '@/lib/supabase/server'
import { DEFAULT_REDIRECT, safeRedirect } from '@/lib/safe-redirect'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/** The origin to redirect to (the forwarded host behind a proxy in production). */
export function redirectOrigin(request: Request): string {
  const { origin } = new URL(request.url)
  const forwardedHost = request.headers.get('x-forwarded-host')
  if (process.env.NODE_ENV !== 'development' && forwardedHost) {
    return `https://${forwardedHost}`
  }
  return origin
}

/**
 * The post-auth target from `next`. The email templates pass
 * `next={{ .RedirectTo }}`, which is the absolute emailRedirectTo /
 * redirectTo URL (…/api/auth/callback?next=%2Finvite%2Fabc) or the Site URL
 * when that was not allow-listed. Absolute URLs only contribute their path:
 * a callback/confirm URL is unwrapped to its own `next`. Always same-origin.
 */
export function resolveNext(raw: string | null): string {
  if (!raw) return DEFAULT_REDIRECT
  if (raw.startsWith('/')) return safeRedirect(raw)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return DEFAULT_REDIRECT
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_REDIRECT
  if (url.pathname === '/api/auth/callback' || url.pathname === '/api/auth/confirm') {
    return safeRedirect(url.searchParams.get('next'))
  }
  return safeRedirect(url.pathname + url.search)
}

/**
 * Where a failed link sends the user: /login with the reason and the original
 * target, so an invite link still ends up on the invite after signing in. A
 * reset link's target is /update-password?redirect=X; login only needs X.
 */
export function failureUrl(origin: string, next: string, reason: string | null): string {
  const url = new URL('/login', origin)
  url.searchParams.set('error', 'auth_failed')
  if (reason) url.searchParams.set('reason', reason)
  let target = next
  if (target.startsWith('/update-password')) {
    target = safeRedirect(new URL(target, origin).searchParams.get('redirect'))
  }
  if (target !== DEFAULT_REDIRECT) url.searchParams.set('redirect', target)
  return url.toString()
}

/**
 * Sync the fulbot_lang cookie with the account's language (A-I1): the public
 * pages and <html lang> read it.
 */
export async function syncLanguageCookie(
  response: NextResponse,
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string | undefined
): Promise<void> {
  if (!userId) return
  const { data: profile } = await supabase
    .from('users')
    .select('preferred_language')
    .eq('id', userId)
    .single()
  if (profile?.preferred_language) {
    response.cookies.set('fulbot_lang', profile.preferred_language, {
      path: '/',
      maxAge: ONE_YEAR_SECONDS,
      sameSite: 'lax',
    })
  }
}
