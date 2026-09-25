import type { Metadata, Viewport } from 'next'
import { Syne, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import { cookies } from 'next/headers'
import './globals.css'

type ThemePreference = 'light' | 'dark' | 'system'

// Inline, blocking script that resolves 'system' theme to the OS preference
// before first paint (no library, no flash of the wrong theme).
const SYSTEM_THEME_SCRIPT = `(function(){try{var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var c=document.documentElement.classList;if(d){c.add('dark')}else{c.remove('dark')}}catch(e){}})();`

// Pizarra type (docs/ui-rework/01-brand.md §2): Syne for display, IBM Plex
// Sans for body, IBM Plex Mono for eyebrows, counts and positions. Exposed as
// CSS variables on <html>; tailwind.config.ts maps them to font-display /
// font-sans / font-mono.
const fontDisplay = Syne({
  subsets: ['latin'],
  weight: ['700', '800'],
  display: 'swap',
  variable: '--font-display',
})

const fontBody = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-body',
})

const fontMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'fulbot — Organizá tus partidos',
  description: 'Organizá partidos de fútbol amateur con tus amigos. Inscripciones, equipos balanceados con IA, y más.',
  manifest: '/manifest.json',
  icons: { apple: '/icons/icon-192.png' },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'fulbot',
  },
}

export const viewport: Viewport = {
  themeColor: '#173129',
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const themeCookie = cookieStore.get('fulbot_theme')?.value
  const theme: ThemePreference =
    themeCookie === 'light' || themeCookie === 'dark' || themeCookie === 'system'
      ? themeCookie
      : 'dark' // default stays dark when the cookie is absent

  // 'dark' -> render with the class already applied (no flash).
  // 'light' -> render with no class (light palette is the :root default).
  // 'system' -> render with no class; the inline script below adds/removes
  //   it before paint based on prefers-color-scheme.
  const htmlClassName = [
    fontDisplay.variable,
    fontBody.variable,
    fontMono.variable,
    theme === 'dark' ? 'dark' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <html lang="es" className={htmlClassName} suppressHydrationWarning>
      <body className="font-sans">
        {theme === 'system' && (
          <script
            // Must run before any app content paints — kept as the very
            // first thing in <body>, before {children}.
            dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }}
          />
        )}
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').catch(() => {})
                })
              }
            `,
          }}
        />
      </body>
    </html>
  )
}
