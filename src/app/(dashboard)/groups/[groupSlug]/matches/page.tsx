import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { TopBarAction, TopBarConfig } from '@/components/layout/top-bar'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/eyebrow'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'
import { DEFAULT_TIMEZONE, formatMatchTime } from '@/lib/utils/datetime'
import { MatchRow, MatchStatusBadge, ScoreText } from './match-row'
import { formatRowDate } from './match-format'

interface PageProps {
  params: Promise<{ groupSlug: string }>
}

type TeamScore = { name: 'dark' | 'light'; score: number }

type MatchResult = {
  id: string
  date_time: string
  location: string | null
  status: string
  max_players: number
  teams: TeamScore[] | null
}

export default async function MatchesListPage({ params }: PageProps) {
  const { groupSlug } = await params
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  const { data: userData } = await supabase
    .from('users')
    .select('preferred_language')
    .eq('id', user.id)
    .single() as { data: { preferred_language: Language } | null }
  const t = getT(userData?.preferred_language ?? 'es')

  // Get user's player profile
  const { data: playerProfile } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null }

  if (!playerProfile) return notFound()

  // Get group
  const { data: group } = await supabase
    .from('groups')
    .select('id, name, slug, timezone')
    .eq('slug', groupSlug)
    .single() as { data: { id: string; name: string; slug: string; timezone: string | null } | null }

  if (!group) return notFound()

  const timeZone = group.timezone || DEFAULT_TIMEZONE

  // Check membership and get role
  const { data: membership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', group.id)
    .eq('player_id', playerProfile.id)
    .eq('is_active', true)
    .single() as { data: { role: string } | null }

  if (!membership) return notFound()

  const isAdminOrCaptain = membership.role === 'admin' || membership.role === 'captain'

  // All matches for this group, with team scores for the finished ones
  const { data: matches } = await supabase
    .from('matches')
    .select('id, date_time, location, status, max_players, teams ( name, score )')
    .eq('group_id', group.id)
    .order('date_time', { ascending: false }) as { data: MatchResult[] | null }

  // Confirmed counts in one query
  const confirmedCount = new Map<string, number>()
  if (matches && matches.length > 0) {
    const { data: rows } = await supabase
      .from('match_signups')
      .select('match_id')
      .in('match_id', matches.map(m => m.id))
      .eq('status', 'confirmed') as { data: { match_id: string }[] | null }
    for (const r of rows || []) confirmedCount.set(r.match_id, (confirmedCount.get(r.match_id) || 0) + 1)
  }

  const now = new Date()
  const upcoming = (matches || [])
    .filter(m => new Date(m.date_time) >= now && !['cancelled', 'finished'].includes(m.status))
    .sort((a, b) => a.date_time.localeCompare(b.date_time))
  const needsAttention = (matches || []).filter(m => new Date(m.date_time) < now && !['finished', 'cancelled'].includes(m.status))
  const past = (matches || []).filter(m => m.status === 'finished' || m.status === 'cancelled')

  const scoreOf = (m: MatchResult): { dark: number; light: number } | null => {
    const dark = m.teams?.find(tm => tm.name === 'dark')
    const light = m.teams?.find(tm => tm.name === 'light')
    return dark && light ? { dark: dark.score, light: light.score } : null
  }

  const createHref = `/groups/${groupSlug}/matches/new`
  const meta = (m: MatchResult) => [formatMatchTime(m.date_time, timeZone), m.location].filter(Boolean).join(' · ')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <TopBarConfig
        title={t('matches.title')}
        back={`/groups/${groupSlug}`}
        action={
          isAdminOrCaptain ? (
            <TopBarAction href={createHref} label={t('matches.create')}>
              <Plus className="h-5 w-5" strokeWidth={1.75} />
            </TopBarAction>
          ) : undefined
        }
      />

      <PageHeader
        title={t('matches.title')}
        subtitle={group.name}
        actions={
          isAdminOrCaptain ? (
            <Button asChild>
              <Link href={createHref}>
                <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                {t('matches.create')}
              </Link>
            </Button>
          ) : undefined
        }
      />

      {(matches || []).length === 0 ? (
        <p className="text-sm text-muted-foreground text-pretty">
          {isAdminOrCaptain ? t('ui.matchScreens.list.emptyAdmin') : t('ui.matchScreens.list.empty')}
        </p>
      ) : (
        <>
          {isAdminOrCaptain && needsAttention.length > 0 && (
            <section className="space-y-2 rounded-md border border-border bg-card p-4">
              <Eyebrow as="h2">{t('ui.workflow.attention')}</Eyebrow>
              <p className="text-sm text-muted-foreground">{t('ui.workflow.attentionBody')}</p>
              <ul>
                {needsAttention.map(m => (
                  <li key={m.id}>
                    <MatchRow href={`/groups/${groupSlug}/matches/${m.id}`} date={formatRowDate(t, m.date_time, timeZone)} meta={meta(m)} trailing={<MatchStatusBadge status={m.status} label={t(`matches.status.${m.status}`)} />} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <Eyebrow as="h2">{t('ui.matchScreens.list.upcoming')}</Eyebrow>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('ui.matchScreens.list.emptyUpcoming')}</p>
            ) : (
              <ul className="[&>li:last-child>a]:border-b-0">
                {upcoming.map(m => (
                  <li key={m.id}>
                    <MatchRow
                      href={`/groups/${groupSlug}/matches/${m.id}`}
                      date={formatRowDate(t, m.date_time, timeZone)}
                      meta={meta(m)}
                      trailing={
                        <>
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {confirmedCount.get(m.id) || 0}/{m.max_players}
                          </span>
                          <MatchStatusBadge status={m.status} label={t(`matches.status.${m.status}`)} />
                        </>
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(past.length > 0 || (!isAdminOrCaptain && needsAttention.length > 0)) && (
            <section className="space-y-2">
              <Eyebrow as="h2">{t('ui.matchScreens.list.past')}</Eyebrow>
              <ul className="[&>li:last-child>a]:border-b-0">
                {(isAdminOrCaptain ? past : [...needsAttention, ...past].sort((a, b) => b.date_time.localeCompare(a.date_time))).map(m => {
                  const score = m.status === 'finished' ? scoreOf(m) : null
                  return (
                    <li key={m.id}>
                      <MatchRow
                        href={`/groups/${groupSlug}/matches/${m.id}`}
                        date={formatRowDate(t, m.date_time, timeZone)}
                        meta={meta(m)}
                        trailing={
                          score ? (
                            <ScoreText dark={score.dark} light={score.light} className="text-base" />
                          ) : (
                            <>
                              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                {t('ui.matchScreens.list.players', { n: confirmedCount.get(m.id) || 0 })}
                              </span>
                              <MatchStatusBadge status={m.status} label={t(`matches.status.${m.status}`)} />
                            </>
                          )
                        }
                      />
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
