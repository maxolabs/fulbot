import { cookies } from 'next/headers'
import { LanguageProvider } from '@/i18n/provider'
import type { Language } from '@/i18n/core'
import { UpdatePasswordForm } from './update-password-form'

// Password reset, step 2. Protected by the middleware: the reset link opens a
// session through /api/auth/callback before landing here.

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[] }>
}) {
  const cookieStore = await cookies()
  const langCookie = cookieStore.get('fulbot_lang')?.value
  const language: Language = langCookie === 'en' ? 'en' : 'es'
  const { redirect } = await searchParams

  return (
    <LanguageProvider language={language}>
      <UpdatePasswordForm redirectParam={typeof redirect === 'string' ? redirect : undefined} />
    </LanguageProvider>
  )
}
