'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { disableDevicePush } from '@/lib/notifications/device-client'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'

// "Salir" as a text button (docs/ui-rework/03-screens.md §10). Same sign-out
// as the sidebar's user menu: end the Supabase session, go to /login.

export function SignOutButton({ className }: { className?: string }) {
  const t = useT()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const handleSignOut = async () => {
    setBusy(true)
    try {
      const supabase = createClient()
      await disableDevicePush().catch(() => {})
      await supabase.auth.signOut()
      router.push('/login')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      type="button"
      variant="link"
      onClick={handleSignOut}
      disabled={busy}
      className={cn('text-destructive', className)}
    >
      <LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      {t('nav.logout')}
    </Button>
  )
}
