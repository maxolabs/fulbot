'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface RealtimeWrapperProps {
  matchId: string
  children: React.ReactNode
}

export function RealtimeWrapper({ matchId, children }: RealtimeWrapperProps) {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    // Subscribe to changes in match_signups for this match
    const channel = supabase
      .channel(`match-signups-${matchId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_signups',
          filter: `match_id=eq.${matchId}`,
        },
        () => {
          // Refresh the page when signups change
          router.refresh()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [matchId, router, supabase])

  return <>{children}</>
}
