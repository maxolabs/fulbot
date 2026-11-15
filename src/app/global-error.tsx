'use client'

import { ErrorScreen } from '@/app/(auth)/error-screen'
import { fontVariables } from './fonts'
import './globals.css'

// Last-resort boundary: replaces the root layout when it (or anything the
// route boundaries do not cover) throws, so it renders its own <html> and
// <body>. The root layout is gone, so this reads the same cookies it does:
// fulbot_lang for the language and fulbot_theme ('light' | 'dark' | 'system',
// dark when absent) for the palette, and puts the app's font variables on
// <html>. ErrorScreen draws the dark chalkboard frame (PublicFrame), like
// not-found and the route error pages, so the screen itself always looks the
// same; the theme class only matters for anything rendered outside that frame.
//
// Rendered on the client the class is right from the first render. If it is
// ever server-rendered there are no cookies to read here, so the inline script
// resolves the theme before paint, like the root layout's 'system' script;
// suppressHydrationWarning keeps its class.
//
// Stylesheet: Next 14 does not load global-error's CSS when the root layout
// fails during the first server render (it sends a bare error document and
// the client renders this component with no <link>; Next 15 fixed it). The
// app's stylesheet hrefs (globals.css, which also carries the @font-face
// rules and the font variables) are in the page's flight data, so link them
// here. Where they are already loaded (an error after navigation) the browser
// reuses them.

type ThemePreference = 'light' | 'dark' | 'system'

const THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)fulbot_theme=(light|dark|system)(?:;|$)/);var t=m?m[1]:'dark';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var c=document.documentElement.classList;if(d){c.add('dark')}else{c.remove('dark')}}catch(e){}})();`

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

const STYLESHEET_HREF = /\/_next\/static\/css\/[\w-]+\.css/g

/** The app's stylesheets, from the flight data Next streams into the page. */
function appStylesheets(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const chunks = (window as unknown as { __next_f?: unknown[] }).__next_f
    const found = JSON.stringify(chunks ?? []).match(STYLESHEET_HREF) ?? []
    return Array.from(new Set(found))
  } catch {
    return []
  }
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
      <head>
        {appStylesheets().map((href) => (
          <link key={href} rel="stylesheet" href={href} precedence="default" />
        ))}
      </head>
      <body className="font-sans">
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <ErrorScreen error={error} reset={reset} />
      </body>
    </html>
  )
}
