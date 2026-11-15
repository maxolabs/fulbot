import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { failureUrl, redirectOrigin, resolveNext, syncLanguageCookie } from '../shared'

// PKCE landing for Supabase emails (?code=): works only in the browser that
// started the flow, because the code verifier lives in its cookies. The email
// templates in supabase/templates/ link to /api/auth/confirm instead, which
// works on any device; this route stays for the default templates.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const origin = redirectOrigin(request)
  const code = searchParams.get('code')
  // Only same-origin relative paths (A-A2): `next` comes from the email link.
  const next = resolveNext(searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`)
      await syncLanguageCookie(response, supabase, data.user?.id)
      return response
    }
    console.error('auth callback: code exchange failed:', error.code ?? error.message)
  }

  // Back to login with the target kept (an invite link must survive).
  const reason = next.startsWith('/update-password') ? 'recovery' : null
  return NextResponse.redirect(failureUrl(origin, next, reason))
}
