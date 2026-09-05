import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { LanguageProvider } from '@/i18n/provider'
import type { Language } from '@/i18n/core'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get user profile data
  const { data: userData } = await supabase
    .from('users')
    .select('name, email, avatar_url, preferred_language')
    .eq('id', user.id)
    .single() as { data: { name: string; email: string; avatar_url: string | null; preferred_language: Language } | null }

  const language: Language = userData?.preferred_language ?? 'es'

  return (
    <LanguageProvider language={language}>
      <div className="min-h-screen bg-background">
        <Header
          user={userData ? {
            name: userData.name,
            email: userData.email,
            avatar_url: userData.avatar_url,
          } : undefined}
        />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </LanguageProvider>
  )
}
