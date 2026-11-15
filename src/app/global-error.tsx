'use client'

import { ErrorScreen } from '@/app/(auth)/error-screen'
import { fontVariables } from './fonts'
import './globals.css'

// Last-resort boundary: replaces the root layout when it (or anything the
// route boundaries do not cover) throws, so it renders its own <html> and
// <body>. The root layout is gone, so this reads the same cookies it does:
// fulbot_lang for the language and fulbot_theme ('light' | 'dark' | 'system',
// dark when absent) for the palette, and puts the app's font variables on
// <html>.
//
// Rendered on the client (an error after navigation) the class is right from
// the first render. Rendered on the server there are no cookies to read here,
// so the inline script resolves the theme before paint, like the root
// layout's 'system' script; suppressHydrationWarning keeps its class.

type ThemePreference = 'light' | 'dark' | 'system'

const THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)fulbot_theme=(light|dark|system)(?:;|$)/);var t=m?m[1]:'dark';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var c=document.documentElement.classList;if(d){c.add('dark')}else{c.remove('dark')}}catch(e){}})();`

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function cookieLanguage(): 'es' | 'en' {
  return readCookie('fulbot_lang') === 'en' ? 'en' : 'es'
}

function prefersDark(): boolean {
  const raw = readCookie('fulbot_theme')
  const theme: ThemePreference = raw === 'light' || raw === 'system' ? raw : 'dark'
  if (theme !== 'system') return theme === 'dark'
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return true
  }
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const className = prefersDark() ? `${fontVariables} dark` : fontVariables
  return (
    <html lang={cookieLanguage()} className={className} suppressHydrationWarning>
      <body className="font-sans">
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <ErrorScreen error={error} reset={reset} />
      </body>
    </html>
  )
}
