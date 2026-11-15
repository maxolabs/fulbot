'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Pause, Play, Users, Flag, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice } from '@/components/form-controls'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'
import type { Database } from '@/types/database'

type Status = Database['public']['Enums']['match_status']

export function MatchWorkflow({ matchId, matchHref, status, confirmed, hasTeams, canManage, reportHref, lineupStale = false, started = false, attendanceOnly = false }: {
  matchId: string; matchHref: string; status: string; confirmed: number; hasTeams: boolean; canManage: boolean; reportHref?: string
  /** The confirmed list changed after the teams were published (00029): warn before finishing. */
  lineupStale?: boolean
  /** Kickoff has passed: a match without teams can be finished with attendance only (00034, OD-3). */
  started?: boolean
  /** Finished without teams: the page shows the attendance-only block instead of this panel. */
  attendanceOnly?: boolean
}) {
  const t = useT()
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // 'teams': finish a teams_created match; 'attendance': finish without teams.
  const [finishMode, setFinishMode] = useState<'teams' | 'attendance' | null>(null)
  const busy = saving || pending
  const finished = status === 'finished'
  const editable = ['signup_open', 'full', 'signup_closed', 'teams_created'].includes(status)
  const step = finished ? 2 : hasTeams ? 2 : status === 'draft' || confirmed < 4 ? 0 : 1

  const updateStatus = async (next: Status) => {
    setSaving(true)
    setError(null)
    try {
      const { error } = await createClient().rpc('admin_set_match_status', { p_match_id: matchId, p_status: next })
      if (error) throw error
      setFinishMode(null)
      startTransition(() => router.refresh())
    } catch (error) {
      console.error('Error updating match status:', error)
      setError(t('ui.workflow.statusError'))
    } finally { setSaving(false) }
  }

  // Members only need the panel to report; the header/action bar already
  // take them to the teams, and the rest of the copy is for organizers.
  if (status === 'cancelled' || (finished && attendanceOnly) || (!canManage && !reportHref)) return null
  // Started without teams: finishing records attendance only (OD-3).
  const canFinishWithoutTeams = canManage && !hasTeams && started && ['signup_open', 'full', 'signup_closed'].includes(status)
  const canBuild = canManage && !hasTeams && editable && confirmed >= 4
  // On mobile the sticky ActionBar carries the same link as the orange primary.
  const barLink = 'hidden lg:inline-flex'
  const title = finished ? reportHref ? 'reportTitle' : 'finishedTitle' : hasTeams ? 'teamsTitle' : status === 'draft' ? 'draftTitle' : canFinishWithoutTeams ? 'pastTitle' : confirmed >= 4 ? 'buildTitle' : 'signupTitle'
  const body = finished ? 'finishedBody' : hasTeams ? 'teamsBody' : status === 'draft' ? 'draftBody' : canFinishWithoutTeams ? canBuild ? 'pastBody' : 'pastShortBody' : confirmed >= 4 ? status === 'signup_closed' ? 'closedBody' : 'buildBody' : status === 'signup_closed' ? 'closedShortBody' : 'signupBody'
  // The past-kickoff copy lives with the other lifecycle strings.
  const copyKey = (key: string) => (key.startsWith('past') ? `ui.lifecycle.finish.${key}` : `ui.workflow.${key}`)

  return (
    <section aria-label={t('ui.workflow.title')} className="rounded-md border border-border bg-card" aria-busy={busy}>
      <ol className="grid grid-cols-3 border-b border-border">
        {['signupStep', 'teamsStep', 'resultStep'].map((label, index) => (
          <li key={label} aria-current={index === step ? 'step' : undefined} className={cn('flex items-center gap-2 px-3 py-3 text-xs sm:px-4', index === step ? 'bg-accent font-semibold' : 'text-muted-foreground')}>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current font-mono text-[10px]">{index < step || finished ? <Check className="h-3 w-3" aria-hidden="true" /> : index + 1}</span>
            {t(`ui.workflow.${label}`)}
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between lg:p-5">
        <div className="min-w-0 space-y-1">
          <h2 className="font-display text-lg font-bold">{t(copyKey(title))}</h2>
          <p className="max-w-xl text-sm text-muted-foreground">{t(copyKey(body), { n: Math.max(0, 4 - confirmed) })}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {reportHref && <Button asChild className={barLink}><Link href={reportHref}>{t('ui.matchScreens.match.reportResult')}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>}
          {hasTeams && <Button asChild variant={reportHref ? 'outline' : 'default'} className={reportHref ? undefined : barLink}><Link href={`${matchHref}/teams`}><Users className="h-4 w-4" aria-hidden="true" />{t(canManage && !finished ? 'ui.matchScreens.match.editTeams' : 'ui.matchScreens.match.viewTeams')}</Link></Button>}
          {canManage && !hasTeams && editable && (confirmed >= 4 ? <Button asChild className={barLink}><Link href={`${matchHref}/teams`}><Users className="h-4 w-4" aria-hidden="true" />{t('ui.matchScreens.dashboard.buildTeams')}</Link></Button> : !canFinishWithoutTeams && <Button disabled><Users className="h-4 w-4" aria-hidden="true" />{t('ui.matchScreens.dashboard.buildTeams')}</Button>)}
          {canManage && (status === 'draft' || (status === 'signup_closed' && !started)) && <Button variant={status === 'draft' ? 'default' : 'outline'} disabled={busy} onClick={() => updateStatus('signup_open')}>{busy ? <Spinner size="sm" /> : <Play className="h-4 w-4" aria-hidden="true" />}{t(status === 'draft' ? 'ui.workflow.open' : 'ui.workflow.reopen')}</Button>}
          {canManage && ['signup_open', 'full'].includes(status) && <Button variant="outline" disabled={busy} onClick={() => updateStatus('signup_closed')}>{busy ? <Spinner size="sm" /> : <Pause className="h-4 w-4" aria-hidden="true" />}{t('ui.workflow.close')}</Button>}
          {canManage && status === 'teams_created' && <Button variant="outline" disabled={busy} onClick={() => setFinishMode('teams')}><Flag className="h-4 w-4" aria-hidden="true" />{t('ui.workflow.finish')}</Button>}
          {/* The primary when there is nothing to build; next to "Armar equipos" it stays an outline. */}
          {canFinishWithoutTeams && <Button variant={canBuild ? 'outline' : 'default'} disabled={busy} onClick={() => setFinishMode('attendance')}><Flag className="h-4 w-4" aria-hidden="true" />{t('ui.lifecycle.finish.withoutTeams')}</Button>}
        </div>
      </div>
      {error && <div className="px-4 pb-4"><FormNotice kind="error">{error}</FormNotice></div>}
      <Sheet
        open={finishMode !== null}
        onOpenChange={(open) => { if (!open) setFinishMode(null) }}
        title={t(finishMode === 'attendance' ? 'ui.lifecycle.finish.withoutTeams' : 'ui.workflow.finish')}
        description={finishMode === 'attendance' ? t('ui.lifecycle.finish.withoutTeamsConfirm', { n: confirmed }) : t('ui.workflow.finishConfirm')}
      >
        {finishMode === 'teams' && lineupStale && (
          <div className="mt-4 space-y-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm" role="status">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.75} aria-hidden="true" />
              <span className="text-pretty">{t('ui.matchLifecycle.finishStale')}</span>
            </p>
            <Button asChild variant="outline" size="sm"><Link href={`${matchHref}/teams`}>{t('ui.matchLifecycle.reviewTeams')}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
          </div>
        )}
        <div className="flex flex-wrap gap-3 pt-4"><Button variant={finishMode === 'teams' && lineupStale ? 'outline' : 'default'} disabled={busy} onClick={() => updateStatus('finished')}>{busy && <Spinner size="sm" />}{t(finishMode === 'attendance' ? 'ui.lifecycle.finish.withoutTeams' : 'ui.workflow.finish')}</Button><Button variant="outline" disabled={busy} onClick={() => setFinishMode(null)}>{t('common.cancel')}</Button></div>
      </Sheet>
    </section>
  )
}
