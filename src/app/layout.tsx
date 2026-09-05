import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { cookies } from 'next/headers'
import './globals.css'

type ThemePreference = 'light' | 'dark' | 'system'

// Inline, blocking script that resolves 'system' theme to the OS preference
// before first paint (no library, no flash of the wrong theme).
const SYSTEM_THEME_SCRIPT = `(function(){try{var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var c=document.documentElement.classList;if(d){c.add('dark')}else{c.remove('dark')}}catch(e){}})();`

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'fulbot — Organiza tus partidos',
  description: 'Organiza partidos de fútbol amateur con tus amigos. Inscripciones, equipos balanceados con IA, y más.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'fulbot',
  },
}

export const viewport: Viewport = {
  themeColor: '#0a0a0f',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
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
  const htmlClassName = theme === 'dark' ? 'dark' : ''

  return (
    <html lang="es" className={htmlClassName} suppressHydrationWarning>
      <body className={inter.className}>
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
