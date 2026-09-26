'use client'

import { ErrorScreen } from '@/app/(auth)/error-screen'
import './globals.css'

// Last-resort boundary: replaces the root layout when it (or anything the
// route boundaries do not cover) throws, so it renders its own <html> and
// <body>. The board frame and the system font; the language comes from the
// fulbot_lang cookie because the root layout's <html lang> is gone.
function cookieLanguage(): 'es' | 'en' {
  if (typeof document === 'undefined') return 'es'
  return /(?:^|;\s*)fulbot_lang=en(?:;|$)/.test(document.cookie) ? 'en' : 'es'
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang={cookieLanguage()} className="dark" suppressHydrationWarning>
      <body className="font-sans">
        <ErrorScreen error={error} reset={reset} />
      </body>
    </html>
  )
}
