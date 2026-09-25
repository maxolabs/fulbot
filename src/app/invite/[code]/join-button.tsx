'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice } from '@/components/form-controls'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'

interface JoinGroupButtonProps {
  groupId: string
  groupSlug: string
  playerId: string
  wasInactive?: boolean
}

export function JoinGroupButton({
  groupId,
  groupSlug,
  playerId,
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
      if (wasInactive) {
        // Reactivate membership
        const { error: updateError } = await (supabase as any)
          .from('group_memberships')
          .update({ is_active: true })
          .eq('group_id', groupId)
          .eq('player_id', playerId)

        if (updateError) {
          throw updateError
        }
      } else {
        // Create new membership
        const { error: insertError } = await (supabase as any)
          .from('group_memberships')
          .insert({
            group_id: groupId,
            player_id: playerId,
            role: 'member',
          })

        if (insertError) {
          if (insertError.code === '23505') {
            // Duplicate key - already a member
            router.push(`/groups/${groupSlug}`)
            return
          }
          throw insertError
        }
      }

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
