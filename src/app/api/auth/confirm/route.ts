import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { failureUrl, redirectOrigin, resolveNext, syncLanguageCookie } from '../shared'

// Landing for the email templates in supabase/templates/ (docs/deploy.md):
//   {{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next={{ .RedirectTo }}
// verifyOtp needs no PKCE code verifier, so the link works in any browser,
// the installed PWA or the mail app's web view. A ?code= (default template)
// is accepted too, for when the templates were not pasted yet.

const OTP_TYPES: readonly EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']

function isOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (OTP_TYPES as readonly string[]).includes(value)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const origin = redirectOrigin(request)
  const tokenHash = searchParams.get('token_hash')
  const rawType = searchParams.get('type')
  const code = searchParams.get('code')
  const next = resolveNext(searchParams.get('next'))
  const reason = rawType === 'recovery' || next.startsWith('/update-password')
    ? 'recovery'
    : rawType === 'signup' || rawType === 'email'
      ? 'signup'
      : null

  const supabase = await createClient()

  if (tokenHash && isOtpType(rawType)) {
    const { data, error } = await supabase.auth.verifyOtp({ type: rawType, token_hash: tokenHash })
    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`)
      await syncLanguageCookie(response, supabase, data.user?.id)
      return response
    }
    console.error('auth confirm: verifyOtp failed:', error.code ?? error.message)
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`)
      await syncLanguageCookie(response, supabase, data.user?.id)
      return response
    }
    console.error('auth confirm: code exchange failed:', error.code ?? error.message)
  }

  return NextResponse.redirect(failureUrl(origin, next, reason))
}
