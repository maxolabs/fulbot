import { cookies } from 'next/headers'
import { LanguageProvider } from '@/i18n/provider'
import type { Language } from '@/i18n/core'
import { ForgotPasswordForm } from './forgot-password-form'

export default async function ForgotPasswordPage({
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
      <ForgotPasswordForm redirectParam={typeof redirect === 'string' ? redirect : undefined} />
    </LanguageProvider>
  )
}
