'use client'

import { useEffect, useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'
import type { MemberScoringSettings } from '@/types/database'

interface ConductCheckProps {
  matchId: string
  groupId: string
  /** Viewer's role in the group; members never see the check. */
  role: 'admin' | 'captain' | 'member'
}

type ConductFlag = 'arrived_late' | 'wrong_jersey' | 'unpaid'

const FLAGS: { type: ConductFlag; emoji: string; labelKey: string }[] = [
  { type: 'arrived_late', emoji: '🕐', labelKey: 'memberScoring.conduct.arrivedLate' },
  { type: 'wrong_jersey', emoji: '👕', labelKey: 'memberScoring.conduct.wrongJersey' },
  { type: 'unpaid', emoji: '💸', labelKey: 'memberScoring.conduct.unpaid' },
]

type Row = {
  key: string
  playerId: string | null
  displayName: string
  isGuest: boolean
}

type SignupRow = {
  id: string
  player_id: string | null
  guest_player_id: string | null
  signup_time: string
  player_profiles: { id: string; display_name: string } | null
  guest_players: { id: string; display_name: string } | null
}

const flagKey = (playerId: string, type: ConductFlag) => `${playerId}:${type}`

export function ConductCheck({ matchId, groupId, role }: ConductCheckProps) {
  const supabase = createClient()
  const t = useT()

  const [canReport, setCanReport] = useState<boolean | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [flags, setFlags] = useState<Set<string>>(() => new Set())
  const [pending, setPending] = useState<Set<string>>(() => new Set())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (role === 'member') {
      setCanReport(false)
      return
    }
    let cancelled = false

    const load = async () => {
      const { data: settings, error: settingsError } = await supabase.rpc('member_scoring_settings', {
        p_group_id: groupId,
      })
      if (cancelled) return
      const s = settings as MemberScoringSettings | null
      if (settingsError || !s || !s.enabled || (role === 'captain' && !s.captains_can_report)) {
        setCanReport(false)
        return
      }
      setCanReport(true)

      // The Database type has no relationship metadata, so the embedded select is untyped.
      const { data: signups, error: signupsError } = await (supabase as any)
        .from('match_signups')
        .select('id, player_id, guest_player_id, signup_time, player_profiles ( id, display_name ), guest_players ( id, display_name )')
        .eq('match_id', matchId)
        .eq('status', 'confirmed')
        .order('signup_time') as { data: SignupRow[] | null; error: { message: string } | null }
      if (cancelled) return
      if (signupsError) {
        setLoadError(signupsError.message)
        setRows([])
        return
      }

      const nextRows: Row[] = (signups ?? [])
        .filter(s => s.player_profiles || s.guest_players)
        .map(s => ({
          key: s.id,
          playerId: s.player_profiles?.id ?? null,
          displayName: s.player_profiles?.display_name ?? s.guest_players?.display_name ?? '',
          isGuest: !s.player_profiles,
        }))
        // Registered players first (alphabetical), guests at the end.
        .sort((a, b) => {
          if (a.isGuest !== b.isGuest) return a.isGuest ? 1 : -1
          return a.displayName.localeCompare(b.displayName, 'es')
        })

      const { data: events, error: eventsError } = await supabase
        .from('member_events')
        .select('player_id, type')
        .eq('match_id', matchId)
        .in('type', ['arrived_late', 'wrong_jersey', 'unpaid'])
      if (cancelled) return
      if (eventsError) {
        setLoadError(eventsError.message)
        setRows([])
        return
      }

      const nextFlags = new Set<string>()
      for (const e of (events ?? []) as { player_id: string; type: string }[]) {
        nextFlags.add(flagKey(e.player_id, e.type as ConductFlag))
      }
      setFlags(nextFlags)
      setRows(nextRows)
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, groupId, role])

  const toggle = async (row: Row, type: ConductFlag) => {
    if (!row.playerId) return
    const key = flagKey(row.playerId, type)
    if (pending.has(key)) return
    const wasOn = flags.has(key)
    const nextOn = !wasOn

    // Optimistic: flip now, revert if the RPC fails.
    setSaveError(null)
    setFlags(prev => {
      const next = new Set(prev)
      if (nextOn) next.add(key)
      else next.delete(key)
      return next
    })
    setPending(prev => new Set(prev).add(key))

    const { error } = await supabase.rpc('set_conduct_flag', {
      p_match_id: matchId,
      p_player_id: row.playerId,
      p_type: type,
      p_on: nextOn,
    })

    setPending(prev => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })

    if (error) {
      console.error('Error setting conduct flag:', error)
      setFlags(prev => {
        const next = new Set(prev)
        if (wasOn) next.add(key)
        else next.delete(key)
        return next
      })
      setSaveError(t('memberScoring.conduct.saveError', { name: row.displayName }))
    }
  }

  if (canReport !== true) return null

  const flaggedCount = rows
    ? rows.filter(r => r.playerId && FLAGS.some(f => flags.has(flagKey(r.playerId!, f.type)))).length
    : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5" />
          {t('memberScoring.conduct.title')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('memberScoring.conduct.description')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows === null && !loadError && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size="sm" /> {t('memberScoring.conduct.loading')}
          </div>
        )}
        {loadError && (
          <p className="text-sm text-destructive">
            {t('memberScoring.conduct.loadError')}: {loadError}
          </p>
        )}
        {saveError && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            {saveError}
          </div>
        )}
        {rows !== null && rows.length === 0 && !loadError && (
          <p className="text-sm text-muted-foreground">{t('memberScoring.conduct.empty')}</p>
        )}
        {rows !== null && rows.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground">
              {flaggedCount > 0
                ? t('memberScoring.conduct.flagged', { count: flaggedCount })
                : t('memberScoring.conduct.allGood')}
            </p>
            <ul className="divide-y divide-border/50">
              {rows.map(row => (
                <li
                  key={row.key}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 ${row.isGuest ? 'opacity-60' : ''}`}
                >
                  <span className="min-w-0 flex-1 basis-40 truncate text-sm font-medium">{row.displayName}</span>
                  {row.isGuest || !row.playerId ? (
                    <span className="text-xs text-muted-foreground">{t('memberScoring.conduct.guestNoScore')}</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {FLAGS.map(f => {
                        const key = flagKey(row.playerId!, f.type)
                        const on = flags.has(key)
                        const busy = pending.has(key)
                        return (
                          <button
                            key={f.type}
                            type="button"
                            aria-pressed={on}
                            aria-label={`${row.displayName}: ${t(f.labelKey)}`}
                            disabled={busy}
                            onClick={() => toggle(row, f.type)}
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60 ${
                              on
                                ? 'border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-400'
                                : 'border-border/50 bg-card/50 text-muted-foreground hover:border-border hover:text-foreground'
                            }`}
                          >
                            <span aria-hidden="true">{f.emoji}</span>
                            {t(f.labelKey)}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
