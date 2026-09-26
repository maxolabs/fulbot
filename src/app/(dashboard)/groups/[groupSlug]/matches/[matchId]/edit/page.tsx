import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { TopBarConfig } from '@/components/layout/top-bar'
import { PageHeader } from '@/components/layout/page-header'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'
import { splitDateTimeInTimezone } from '@/lib/utils/datetime'
import { EditMatchForm } from './edit-match-form'

interface PageProps {
  params: Promise<{ groupSlug: string; matchId: string }>
}

export default async function EditMatchPage({ params }: PageProps) {
  const { groupSlug, matchId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  const { data: userData } = await supabase
    .from('users')
    .select('preferred_language')
    .eq('id', user.id)
    .single() as { data: { preferred_language: Language } | null }

  const t = getT(userData?.preferred_language ?? 'es')

  const { data: playerProfile } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null }

  if (!playerProfile) return notFound()

  const { data: group } = await supabase
    .from('groups')
    .select('id, name, slug, timezone')
    .eq('slug', groupSlug)
    .single() as { data: { id: string; name: string; slug: string; timezone: string } | null }

  if (!group) return notFound()

  const { data: membership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', group.id)
    .eq('player_id', playerProfile.id)
    .eq('is_active', true)
    .single() as { data: { role: string } | null }

  if (!membership || (membership.role !== 'admin' && membership.role !== 'captain')) {
    redirect(`/groups/${groupSlug}/matches/${matchId}`)
  }

  const { data: match } = await supabase
    .from('matches')
    .select('id, status, date_time, location, max_players, notes, duration_minutes, results_request_delay_minutes')
    .eq('id', matchId)
    .eq('group_id', group.id)
    .single() as { data: {
      id: string
      status: string
      date_time: string
      location: string | null
      max_players: number
      notes: string | null
      duration_minutes: number | null
      results_request_delay_minutes: number | null
    } | null }

  if (!match) return notFound()

  const matchHref = `/groups/${groupSlug}/matches/${matchId}`

  // Finished and cancelled matches keep their date, place and cap
  // (00032_match_edit_guard rejects the change in the database too).
  if (match.status === 'finished' || match.status === 'cancelled') {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <TopBarConfig title={t('matches.editMatch')} back={matchHref} />
        <PageHeader title={t('matches.editMatch')} />
        <div role="status" className="flex items-start gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
          <div className="min-w-0 space-y-3">
            <div>
              <p className="font-semibold">
                {t(match.status === 'finished' ? 'matches.editLockedFinished' : 'matches.editLockedCancelled')}
              </p>
              <p className="mt-0.5 text-pretty text-muted-foreground">{t('matches.editLockedBody')}</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={matchHref}>
                <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                {t('matches.backToMatch')}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const { date, time } = splitDateTimeInTimezone(match.date_time, group.timezone)

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <TopBarConfig title={t('matches.editMatch')} back={matchHref} />
      <PageHeader title={t('matches.editMatch')} subtitle={t('matches.editMatchSubtitle')} />
      <p className="text-sm text-muted-foreground text-pretty lg:hidden">{t('matches.editMatchSubtitle')}</p>

      <EditMatchForm
        matchId={match.id}
        groupSlug={group.slug}
        timezone={group.timezone}
        defaults={{
          date,
          time,
          location: match.location || '',
          maxPlayers: match.max_players,
          notes: match.notes || '',
          durationMinutes: match.duration_minutes ?? 60,
          resultsRequestDelayMinutes: match.results_request_delay_minutes ?? 60,
        }}
      />
    </div>
  )
}
