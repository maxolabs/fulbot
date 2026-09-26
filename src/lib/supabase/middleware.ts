import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { GROUP_COOKIE, GROUP_COOKIE_MAX_AGE, groupSlugFromPathname } from '@/lib/group-cookie'
import { safeRedirect } from '@/lib/safe-redirect'
import { getSupabasePublicEnv } from '@/lib/env'

export async function updateSession(request: NextRequest) {
  // Current-group memory (docs/ui-rework/02-shell.md §3): remember the slug
  // of every /groups/[slug] visit. Only the response is touched (the cookie
  // is set right before returning): mutating request.cookies here breaks
  // the Supabase session cookies for the rest of the request.
  const groupSlug = groupSlugFromPathname(request.nextUrl.pathname)

  const supabaseEnv = getSupabasePublicEnv()

  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    supabaseEnv.url,
    supabaseEnv.anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Define protected and auth routes
  // /update-password needs the session the reset link opened.
  const protectedPaths = ['/groups', '/profile', '/settings', '/notifications', '/update-password']
  const authPaths = ['/login', '/register', '/forgot-password']

  const isProtectedPath = protectedPaths.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  )

  const isAuthPath = authPaths.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  )

  // Redirects must carry any session cookies getUser() just refreshed,
  // otherwise the browser keeps the stale (already rotated) refresh token.
  const redirectWithSession = (url: URL) => {
    const response = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
    return response
  }

  // Redirect unauthenticated users from protected routes, keeping the query
  // string in the redirect target (A-M2).
  if (isProtectedPath && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('redirect', request.nextUrl.pathname + request.nextUrl.search)
    return redirectWithSession(url)
  }

  // Redirect authenticated users from auth routes and the landing page (A-L1)
  if ((isAuthPath || request.nextUrl.pathname === '/') && user) {
    const redirectTo = safeRedirect(request.nextUrl.searchParams.get('redirect'))
    return redirectWithSession(new URL(redirectTo, request.url))
  }

  // Set right before returning: setAll may have re-created supabaseResponse.
  if (groupSlug) {
    supabaseResponse.cookies.set(GROUP_COOKIE, groupSlug, {
      maxAge: GROUP_COOKIE_MAX_AGE,
      sameSite: 'lax',
      path: '/',
      httpOnly: false,
    })
  }

  return supabaseResponse
}
