import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api (route handlers create their own Supabase client, which can write
     *   refreshed session cookies itself; cron routes use CRON_SECRET)
     * - _next/static, _next/image (build output, image optimization)
     * - favicon.ico, manifest.json, sw.js, icons/ and image files (public assets)
     * The public /m and /invite pages stay matched: they read the session.
     */
    '/((?!api/|_next/static|_next/image|favicon\\.ico|manifest\\.json|sw\\.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
