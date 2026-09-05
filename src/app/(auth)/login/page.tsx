import { cookies } from 'next/headers'
import { LanguageProvider } from '@/i18n/provider'
import type { Language } from '@/i18n/use-translations'
import { LoginForm } from './login-form'

export default async function LoginPage() {
  const cookieStore = await cookies()
  const langCookie = cookieStore.get('fulbot_lang')?.value
  const language: Language = langCookie === 'en' ? 'en' : 'es'

  return (
    <LanguageProvider language={language}>
      <LoginForm />
    </LanguageProvider>
  )
}
