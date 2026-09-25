'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice } from '@/components/form-controls'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'

interface JoinGroupButtonProps {
  inviteCode: string
  groupSlug: string
  wasInactive?: boolean
}

export function JoinGroupButton({
  inviteCode,
  groupSlug,
  wasInactive,
}: JoinGroupButtonProps) {
  const t = useT()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  const handleJoin = async () => {
    setLoading(true)
    setError(null)

    try {
      // The RPC validates the invite code, adds a new member, reactivates a
      // removed one (as a plain member) and is a no-op for an active member.
      const { error: joinError } = await supabase.rpc('join_group_via_invite', {
        p_invite_code: inviteCode,
      })
      if (joinError) throw joinError

      router.push(`/groups/${groupSlug}`)
      router.refresh()
    } catch (err) {
      console.error('Error joining group:', err)
      setError(t('ui.screens.invite.joinError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      {error && <FormNotice kind="error">{error}</FormNotice>}
      <Button onClick={handleJoin} disabled={loading} size="xl" className="w-full">
        {loading && <Spinner size="sm" />}
        {wasInactive ? t('ui.screens.invite.rejoin') : t('ui.screens.invite.join')}
      </Button>
    </div>
  )
}
