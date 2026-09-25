import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, ClipboardList, KeyRound, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/layout/page-header'
import { TopBarConfig } from '@/components/layout/top-bar'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'
import { CreateOrJoinButton } from './create-or-join-button'
import {
  DEFAULT_TIMEZONE,
  formatMatchDateNumeric,
  formatMatchDayMonth,
  formatMatchTime,
  weekdayIndexInTimezone,
} from '@/lib/utils/datetime'

type GroupWithRole = {
  id: string
  name: string
  slug: string
  description: string | null
  default_match_day: number | null
  default_match_time: string | null
  timezone: string | null
  role: 'admin' | 'captain' | 'member'
}

type NextMatch = {
  id: string
  date_time: string
  max_players: number
  confirmedCount: number
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

export default async function GroupsPage() {
  const supabase = await createClient()

  // Get current user's player profile
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data: userData } = await supabase
    .from('users')
    .select('preferred_language')
    .eq('id', user.id)
    .single() as { data: { preferred_language: Language } | null }

  const t = getT(userData?.preferred_language ?? 'es')

  // Get player profile
  const { data: playerProfile } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null }

  if (!playerProfile) {
    return null
  }

  // Get user's groups with membership info
  const { data: memberships } = await supabase
    .from('group_memberships')
    .select(`
      role,
      groups (
        id,
        name,
        slug,
        description,
        default_match_day,
        default_match_time,
        timezone
      )
    `)
    .eq('player_id', playerProfile.id)
    .eq('is_active', true) as { data: Array<{ role: 'admin' | 'captain' | 'member', groups: GroupWithRole | null }> | null }

  const groups: GroupWithRole[] = (memberships || [])
    .filter((m): m is { role: 'admin' | 'captain' | 'member', groups: GroupWithRole } => m.groups !== null)
    .map((m) => ({
      ...m.groups,
      role: m.role,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Single-group users land on their dashboard (docs/ui-rework/03-screens.md
  // §1, 06-principles.md §1.3); the list stays reachable from the switcher.
  if (groups.length === 1) {
    redirect(`/groups/${groups[0].slug}`)
  }

  // Next upcoming, joinable match per group
  const nextMatchByGroup = new Map<string, NextMatch>()

  if (groups.length > 0) {
    const groupIds = groups.map((g) => g.id)
    const nowIso = new Date().toISOString()

    const { data: upcomingMatches } = await supabase
      .from('matches')
      .select('id, group_id, date_time, max_players, status')
      .in('group_id', groupIds)
      .gte('date_time', nowIso)
      .in('status', ['signup_open', 'full', 'teams_created'])
      .order('date_time', { ascending: true }) as {
        data: { id: string; group_id: string; date_time: string; max_players: number; status: string }[] | null
      }

    const earliestPerGroup = new Map<string, { id: string; group_id: string; date_time: string; max_players: number }>()
    for (const match of upcomingMatches || []) {
      if (!earliestPerGroup.has(match.group_id)) {
        earliestPerGroup.set(match.group_id, match)
      }
    }

    const matchIds = Array.from(earliestPerGroup.values()).map((m) => m.id)

    if (matchIds.length > 0) {
      const { data: signups } = await supabase
        .from('match_signups')
        .select('match_id, status')
        .in('match_id', matchIds)
        .eq('status', 'confirmed') as { data: { match_id: string; status: string }[] | null }

      const confirmedCounts = new Map<string, number>()
      for (const s of signups || []) {
        confirmedCounts.set(s.match_id, (confirmedCounts.get(s.match_id) || 0) + 1)
      }

      for (const [groupId, match] of Array.from(earliestPerGroup.entries())) {
        nextMatchByGroup.set(groupId, {
          id: match.id,
          date_time: match.date_time,
          max_players: match.max_players,
          confirmedCount: confirmedCounts.get(match.id) || 0,
        })
      }
    }
  }

  // Result nudge: most recent finished match (inside the reporting window)
  // the user played in and hasn't reported yet (docs/match-results-consensus.md §6).
  type ResultNudge = { matchId: string; groupSlug: string; groupName: string; dateTime: string; timezone: string | null }
  let resultNudge: ResultNudge | null = null

  if (groups.length > 0) {
    const groupIds = groups.map((g) => g.id)

    // The reporting window is a per-group setting (results_window_days, 00018).
    const { data: windowRows } = await supabase
      .from('notification_settings')
      .select('group_id, results_window_days')
      .in('group_id', groupIds) as { data: { group_id: string; results_window_days: number | null }[] | null }
    const windowDaysByGroup = new Map<string, number>()
    for (const row of windowRows || []) windowDaysByGroup.set(row.group_id, row.results_window_days ?? 7)
    const windowDaysFor = (groupId: string) => windowDaysByGroup.get(groupId) ?? 7
    const maxWindowDays = Math.max(7, ...groupIds.map(windowDaysFor))

    const now = new Date()
    const earliest = new Date(now)
    earliest.setDate(earliest.getDate() - maxWindowDays)

    const { data: finishedRows } = await supabase
      .from('matches')
      .select('id, group_id, date_time, result_status')
      .in('group_id', groupIds)
      .eq('status', 'finished')
      .neq('result_status', 'locked')
      .gte('date_time', earliest.toISOString())
      .order('date_time', { ascending: false }) as {
        data: { id: string; group_id: string; date_time: string; result_status: string }[] | null
      }

    const finishedMatches = (finishedRows || []).filter(
      (m) => now.getTime() - new Date(m.date_time).getTime() < windowDaysFor(m.group_id) * 24 * 60 * 60 * 1000
    )

    if (finishedMatches.length > 0) {
      const matchIds = finishedMatches.map((m) => m.id)

      const { data: mySignups } = await supabase
        .from('match_signups')
        .select('match_id')
        .in('match_id', matchIds)
        .eq('player_id', playerProfile.id)
        .eq('status', 'confirmed') as { data: { match_id: string }[] | null }

      const playedMatchIds = new Set((mySignups || []).map((s) => s.match_id))

      const { data: myReports } = await supabase
        .from('match_reports')
        .select('match_id')
        .in('match_id', matchIds)
        .eq('reporter_player_id', playerProfile.id) as { data: { match_id: string }[] | null }

      const reportedMatchIds = new Set((myReports || []).map((r) => r.match_id))

      const candidate = finishedMatches.find(
        (m) => playedMatchIds.has(m.id) && !reportedMatchIds.has(m.id)
      )

      if (candidate) {
        const candidateGroup = groups.find((g) => g.id === candidate.group_id)
        if (candidateGroup) {
          resultNudge = {
            matchId: candidate.id,
            groupSlug: candidateGroup.slug,
            groupName: candidateGroup.name,
            dateTime: candidate.date_time,
            timezone: candidateGroup.timezone,
          }
        }
      }
    }
  }

  const rowClassName =
    'flex min-h-14 w-full items-center gap-3 border-b border-border py-3 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <TopBarConfig title={t('groups.title')} />
      <p className="text-sm text-muted-foreground lg:hidden">{t('ui.polish.groupsIntro')}</p>
      {/* Result report nudge: the one dashed card on this screen */}
      {resultNudge && (
        <Link
          href={`/groups/${resultNudge.groupSlug}/matches/${resultNudge.matchId}#reportar`}
          className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Card className="hover:bg-accent/40">
            <CardContent className="flex items-center gap-3 p-4 lg:p-4">
              <ClipboardList className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {t('groups.resultNudgeTitle', {
                    group: resultNudge.groupName,
                    date: formatMatchDateNumeric(resultNudge.dateTime, resultNudge.timezone || DEFAULT_TIMEZONE),
                  })}
                </p>
                <p className="text-xs text-muted-foreground">{t('groups.resultNudgeSubtitle')}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
            </CardContent>
          </Card>
        </Link>
      )}

      <PageHeader
        title={t('groups.title')}
        subtitle={t('ui.polish.groupsIntro')}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/invite">
                <KeyRound className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                {t('ui.shell.joinWithCode')}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/groups/new">
                <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                {t('ui.shell.createGroup')}
              </Link>
            </Button>
          </>
        }
      />

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground text-pretty">{t('ui.matchScreens.groups.empty')}</p>
      ) : (
        <ul className="[&>li:last-child>a]:border-b-0">
          {groups.map((group) => {
            const nextMatch = nextMatchByGroup.get(group.id)
            const groupTimezone = group.timezone || DEFAULT_TIMEZONE

            return (
              <li key={group.id}>
                <Link href={`/groups/${group.slug}`} className={rowClassName}>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-display text-base font-bold leading-tight">{group.name}</span>
                      <Badge variant={group.role === 'member' ? 'outline' : 'secondary'}>
                        {t(`groups.roles.${group.role}`)}
                      </Badge>
                    </span>
                    <span className="block font-mono text-xs tabular-nums text-muted-foreground">
                      {nextMatch
                        ? t('ui.matchScreens.groups.nextMatchLine', {
                            day: t(`ui.matchScreens.daysShort.${DAY_KEYS[weekdayIndexInTimezone(nextMatch.date_time, groupTimezone)]}`),
                            date: formatMatchDayMonth(nextMatch.date_time, groupTimezone),
                            time: formatMatchTime(nextMatch.date_time, groupTimezone),
                            confirmed: nextMatch.confirmedCount,
                            max: nextMatch.max_players,
                          })
                        : t('ui.matchScreens.groups.noUpcoming')}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {/* Mobile: the two header actions collapse to one outline button after the list */}
      <div className="lg:hidden">
        <CreateOrJoinButton />
      </div>
    </div>
  )
}
