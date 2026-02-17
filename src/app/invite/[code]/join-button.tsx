'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      setError('Error al unirse al grupo. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive text-center">
          {error}
        </div>
      )}
      <Button onClick={handleJoin} disabled={loading} className="w-full">
        {loading && <Spinner size="sm" className="mr-2" />}
        {wasInactive ? 'Volver al grupo' : 'Unirme al grupo'}
      </Button>
    </div>
  )
}
