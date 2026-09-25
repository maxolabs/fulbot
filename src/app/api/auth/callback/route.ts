import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { safeRedirect } from '@/lib/safe-redirect'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Only same-origin relative paths (A-A2): `next` comes from the email link.
  const next = safeRedirect(searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const forwardedHost = request.headers.get('x-forwarded-host')
      const isLocalEnv = process.env.NODE_ENV === 'development'

      let response: NextResponse
      if (isLocalEnv) {
        response = NextResponse.redirect(`${origin}${next}`)
      } else if (forwardedHost) {
        response = NextResponse.redirect(`https://${forwardedHost}${next}`)
      } else {
        response = NextResponse.redirect(`${origin}${next}`)
      }

      // Sync the fulbot_lang cookie with the account's language (A-I1).
      const userId = data.user?.id
      if (userId) {
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

      return response
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
