import Link from 'next/link'
import { Plus, Users, Calendar, ChevronRight, Trophy } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/use-translations'

type GroupWithRole = {
  id: string
  name: string
  slug: string
  description: string | null
  default_match_day: number | null
  default_match_time: string | null
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
        default_match_time
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

  // MVP voting nudge: most recent finished match (within 7 days) the user
  // played in and hasn't voted for MVP in yet.
  type MvpNudge = { matchId: string; groupSlug: string; groupName: string; dateTime: string }
  let mvpNudge: MvpNudge | null = null

  if (groups.length > 0) {
    const groupIds = groups.map((g) => g.id)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const sevenDaysAgoIso = sevenDaysAgo.toISOString()

    const { data: finishedMatches } = await supabase
      .from('matches')
      .select('id, group_id, date_time')
      .in('group_id', groupIds)
      .eq('status', 'finished')
      .gte('date_time', sevenDaysAgoIso)
      .order('date_time', { ascending: false }) as {
        data: { id: string; group_id: string; date_time: string }[] | null
      }

    if (finishedMatches && finishedMatches.length > 0) {
      const matchIds = finishedMatches.map((m) => m.id)

      const { data: mySignups } = await supabase
        .from('match_signups')
        .select('match_id')
        .in('match_id', matchIds)
        .eq('player_id', playerProfile.id)
        .eq('status', 'confirmed') as { data: { match_id: string }[] | null }

      const playedMatchIds = new Set((mySignups || []).map((s) => s.match_id))

      const { data: myVotes } = await supabase
        .from('match_mvp_votes')
        .select('match_id')
        .in('match_id', matchIds)
        .eq('voter_player_id', playerProfile.id) as { data: { match_id: string }[] | null }

      const votedMatchIds = new Set((myVotes || []).map((v) => v.match_id))

      const candidate = finishedMatches.find(
        (m) => playedMatchIds.has(m.id) && !votedMatchIds.has(m.id)
      )

      if (candidate) {
        const candidateGroup = groups.find((g) => g.id === candidate.group_id)
        if (candidateGroup) {
          mvpNudge = {
            matchId: candidate.id,
            groupSlug: candidateGroup.slug,
            groupName: candidateGroup.name,
            dateTime: candidate.date_time,
          }
        }
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* MVP voting nudge */}
      {mvpNudge && (
        <Link href={`/groups/${mvpNudge.groupSlug}/matches/${mvpNudge.matchId}`}>
          <Card className="border-yellow-500/30 bg-yellow-500/5 transition-colors hover:bg-yellow-500/10">
            <CardContent className="flex items-center gap-3 py-4">
              <Trophy className="h-5 w-5 shrink-0 text-yellow-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {t('groups.mvpNudgeTitle', {
                    group: mvpNudge.groupName,
                    date: new Date(mvpNudge.dateTime).toLocaleDateString('es-AR'),
                  })}
                </p>
                <p className="text-xs text-muted-foreground">{t('groups.mvpNudgeSubtitle')}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('groups.title')}</h1>
          <p className="text-muted-foreground">
            {t('groups.subtitle')}
          </p>
        </div>
        <Link href="/groups/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            {t('groups.create')}
          </Button>
        </Link>
      </div>

      {/* Groups Grid */}
      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">{t('groups.noGroups')}</h3>
            <p className="text-muted-foreground text-center mb-4">
              {t('groups.noGroupsDescription')}
            </p>
            <div className="flex gap-3">
              <Link href="/groups/new">
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  {t('groups.create')}
                </Button>
              </Link>
              <Link href="/invite">
                <Button variant="outline">
                  {t('groups.join')}
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => {
            const nextMatch = nextMatchByGroup.get(group.id)
            const matchDate = nextMatch ? new Date(nextMatch.date_time) : null

            return (
              <Card key={group.id} className="h-full transition-shadow hover:shadow-md">
                <Link href={`/groups/${group.slug}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-lg">{group.name}</CardTitle>
                      <Badge
                        variant={
                          group.role === 'admin'
                            ? 'default'
                            : group.role === 'captain'
                            ? 'secondary'
                            : 'outline'
                        }
                      >
                        {group.role === 'admin'
                          ? t('groups.roles.admin')
                          : group.role === 'captain'
                          ? t('groups.roles.captain')
                          : t('groups.roles.member')}
                      </Badge>
                    </div>
                    {group.description && (
                      <CardDescription className="line-clamp-2">
                        {group.description}
                      </CardDescription>
                    )}
                  </CardHeader>
                </Link>
                <CardContent>
                  {nextMatch && matchDate ? (
                    <Link
                      href={`/groups/${group.slug}/matches/${nextMatch.id}`}
                      className="flex items-center justify-between gap-2 rounded-lg -mx-2 -my-1 px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Calendar className="h-4 w-4 shrink-0" />
                        <span className="truncate">
                          {t('groups.nextMatchSummary', {
                            day: t(`days.${DAY_KEYS[matchDate.getDay()]}`),
                            time: matchDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
                            confirmed: nextMatch.confirmedCount,
                            max: nextMatch.max_players,
                          })}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground/70">
                      <Calendar className="h-4 w-4" />
                      <span>{t('groups.noUpcomingMatch')}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
