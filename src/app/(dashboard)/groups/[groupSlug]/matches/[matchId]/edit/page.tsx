import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
    .select('id, date_time, location, max_players, notes, duration_minutes, results_request_delay_minutes')
    .eq('id', matchId)
    .eq('group_id', group.id)
    .single() as { data: {
      id: string
      date_time: string
      location: string | null
      max_players: number
      notes: string | null
      duration_minutes: number | null
      results_request_delay_minutes: number | null
    } | null }

  if (!match) return notFound()

  const { date, time } = splitDateTimeInTimezone(match.date_time, group.timezone)

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Link
        href={`/groups/${groupSlug}/matches/${matchId}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t('common.backTo', { name: group.name })}
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>{t('matches.editMatch')}</CardTitle>
          <CardDescription>
            {t('matches.editMatchSubtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  )
}
