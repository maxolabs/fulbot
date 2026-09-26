'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface RealtimeWrapperProps {
  matchId: string
  children: React.ReactNode
}

// Keeps an open match page live: signups (00025) and the match row itself
// (status, result, MVP, lineup review flag; published in 00029) refresh the
// server components.
export function RealtimeWrapper({ matchId, children }: RealtimeWrapperProps) {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const refresh = () => router.refresh()
    const channel = supabase
      .channel(`match-${matchId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_signups',
          filter: `match_id=eq.${matchId}`,
        },
        refresh
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'matches',
          filter: `id=eq.${matchId}`,
        },
        refresh
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [matchId, router, supabase])

  return <>{children}</>
}
