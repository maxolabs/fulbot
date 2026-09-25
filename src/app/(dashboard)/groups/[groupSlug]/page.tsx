import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, ClipboardList, MessageCircle, Plus, Settings, Star, UserPlus, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { emitPendingMatchCreatedNotifications } from '@/lib/notifications/match-created'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Eyebrow } from '@/components/ui/eyebrow'
import { SpotsMeter } from '@/components/ui/spots-meter'
import { PlayerRow } from '@/components/ui/player-row'
import { PageHeader } from '@/components/layout/page-header'
import { TopBarAction, TopBarConfig } from '@/components/layout/top-bar'
import { GroupSwitcherTitle } from '@/components/layout/group-switcher'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'
import { DEFAULT_TIMEZONE, formatMatchTime, weekdayIndexInTimezone } from '@/lib/utils/datetime'
import { InviteButton } from './invite-button'
import { MatchRow, MatchStatusBadge, ScoreText } from './matches/match-row'
import { formatHeroDate, formatRowDate, formatShortDate } from './matches/match-format'
import { buildAnnouncementText } from './matches/[matchId]/announcement-text'

interface PageProps {
  params: Promise<{ groupSlug: string }>
}

type GroupRole = 'admin' | 'captain' | 'member'

interface Group {
  id: string
  name: string
  slug: string
  description: string | null
  default_match_day: number | null
  default_match_time: string | null
  default_max_players: number
  invite_code: string
  timezone: string | null
}

interface MatchRowData {
  id: string
  date_time: string
  location: string | null
  status: string
  max_players: number
}

type TeamScore = { name: 'dark' | 'light'; score: number }

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
const UPCOMING_STATUSES = ['signup_open', 'full', 'signup_closed', 'teams_created'] as const

export default async function GroupDetailPage({ params }: PageProps) {
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
  const language: Language = userData?.preferred_language ?? 'es'
  const t = getT(language)

  // Get user's player profile
  const { data: playerProfile } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null }

  if (!playerProfile) return notFound()

  // Get group by slug
  const { data: group } = await supabase
    .from('groups')
    .select('*')
    .eq('slug', groupSlug)
    .single() as { data: Group | null }

  if (!group) return notFound()

  const timeZone = group.timezone || DEFAULT_TIMEZONE

  // Check if user is a member and get their role
  const { data: membership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', group.id)
    .eq('player_id', playerProfile.id)
    .eq('is_active', true)
    .single() as { data: { role: GroupRole } | null }

  if (!membership) return notFound()

  const userRole = membership.role
  const isAdmin = userRole === 'admin'
  const isAdminOrCaptain = userRole === 'admin' || userRole === 'captain'

  // Group members (count for the subtitle, names for the table)
  type MembershipResult = {
    id: string
    role: GroupRole
    player_profiles: { id: string; display_name: string; nickname: string | null } | null
  }

  const { data: memberships } = await supabase
    .from('group_memberships')
    .select('id, role, player_profiles ( id, display_name, nickname )')
    .eq('group_id', group.id)
    .eq('is_active', true) as { data: MembershipResult[] | null }

  const members = (memberships || [])
    .filter((m): m is MembershipResult & { player_profiles: NonNullable<MembershipResult['player_profiles']> } => m.player_profiles !== null)
    .map(m => ({ id: m.id, role: m.role, player: m.player_profiles }))
  const memberNameById = new Map(members.map(m => [m.player.id, m.player.display_name]))

  // Initial scoring: members the current player hasn't rated or skipped yet in this
  // group. RLS returns only the current voter's own peer_ratings rows.
  const { data: myRatingRows } = await supabase
    .from('peer_ratings')
    .select('rated_player_id')
    .eq('group_id', group.id)
    .eq('voter_player_id', playerProfile.id) as { data: { rated_player_id: string }[] | null }
  const ratedIds = new Set((myRatingRows || []).map(r => r.rated_player_id))
  const pendingRatings = members.filter(m => m.player.id !== playerProfile.id && !ratedIds.has(m.player.id)).length

  // Lazily materialize the next recurring-match instance for this group, in
  // case the daily cron drifted or hasn't run yet (see docs/rework-plan.md
  // §2.4). Best-effort: a failure here must never break the group page.
  try {
    await supabase.rpc('generate_recurring_matches', { p_group_id: group.id })
    // Emit match_created (§2.6) for whatever that just created (or a racing
    // cron sweep already did); see src/lib/notifications/match-created.ts.
    // emit_notification is service-role only; membership was checked above.
    await emitPendingMatchCreatedNotifications(createAdminClient(), group.id)
  } catch {
    // ignore
  }

  // Upcoming matches: the first joinable one is the "Próximo partido" card,
  // the rest (drafts included) are rows.
  const nowIso = new Date().toISOString()
  const { data: upcomingRows } = await supabase
    .from('matches')
    .select('id, date_time, location, status, max_players')
    .eq('group_id', group.id)
    .in('status', ['draft', ...UPCOMING_STATUSES])
    .gte('date_time', nowIso)
    .order('date_time')
    .limit(6) as { data: MatchRowData[] | null }

  const upcoming = upcomingRows || []
  const nextMatch = upcoming.find(m => m.status !== 'draft') ?? (isAdminOrCaptain ? upcoming[0] ?? null : null)
  const otherUpcoming = upcoming.filter(m => m.id !== nextMatch?.id)

  // Confirmed counts for the upcoming rows, in one query
  const confirmedCountByMatch = new Map<string, number>()
  if (otherUpcoming.length > 0) {
    const { data: countRows } = await supabase
      .from('match_signups')
      .select('match_id')
      .in('match_id', otherUpcoming.map(m => m.id))
      .eq('status', 'confirmed') as { data: { match_id: string }[] | null }
    for (const row of countRows || []) {
      confirmedCountByMatch.set(row.match_id, (confirmedCountByMatch.get(row.match_id) || 0) + 1)
    }
  }

  // Roster of the next match
  type SignupRow = {
    id: string
    status: string
    waitlist_position: number | null
    player_profiles: { id: string; display_name: string; nickname: string | null; main_position: string } | null
    guest_players: { id: string; display_name: string; preferred_positions: string[] | null } | null
  }
  let confirmed: SignupRow[] = []
  let waitlist: SignupRow[] = []
  let nextHasTeams = false
  if (nextMatch) {
    const { data: signupRows } = await supabase
      .from('match_signups')
      .select(`
        id,
        status,
        waitlist_position,
        player_profiles ( id, display_name, nickname, main_position ),
        guest_players ( id, display_name, preferred_positions )
      `)
      .eq('match_id', nextMatch.id)
      .in('status', ['confirmed', 'waitlist'])
      .order('signup_time') as { data: SignupRow[] | null }
    confirmed = (signupRows || []).filter(s => s.status === 'confirmed')
    waitlist = (signupRows || [])
      .filter(s => s.status === 'waitlist')
      .sort((a, b) => (a.waitlist_position || 0) - (b.waitlist_position || 0))

    // Read for every viewer, not only admins: once the teams exist the card
    // links members to them too (03-screens §4).
    const { count } = await supabase
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('match_id', nextMatch.id)
    nextHasTeams = (count ?? 0) > 0
  }

  // Last 10 finished matches: recent rows, "Último resultado" and the table.
  type FinishedRow = MatchRowData & { mvp_player_id: string | null; teams: TeamScore[] | null }
  const { data: finishedRows } = await supabase
    .from('matches')
    .select('id, date_time, location, status, max_players, mvp_player_id, teams ( name, score )')
    .eq('group_id', group.id)
    .eq('status', 'finished')
    .order('date_time', { ascending: false })
    .limit(10) as { data: FinishedRow[] | null }
  const finished = finishedRows || []
  const scoreOf = (m: FinishedRow): { dark: number; light: number } | null => {
    const dark = m.teams?.find(tm => tm.name === 'dark')
    const light = m.teams?.find(tm => tm.name === 'light')
    return dark && light ? { dark: dark.score, light: light.score } : null
  }
  const recent = finished.slice(0, 3)
  const lastResultMatch = finished.find(m => scoreOf(m) !== null) ?? finished[0] ?? null

  // Table · últimos 10 (PJ, G, MVP; rating for admin/captain). Members only.
  type TableRow = { id: string; name: string; played: number; goals: number; mvp: number; rating: number | null }
  const tableById = new Map<string, TableRow>()
  const rowFor = (id: string): TableRow | null => {
    const name = memberNameById.get(id)
    if (!name) return null
    let row = tableById.get(id)
    if (!row) {
      row = { id, name, played: 0, goals: 0, mvp: 0, rating: null }
      tableById.set(id, row)
    }
    return row
  }
  if (finished.length > 0) {
    const finishedIds = finished.map(m => m.id)
    const [{ data: playedRows }, { data: goalRows }] = await Promise.all([
      supabase
        .from('match_signups')
        .select('player_id')
        .in('match_id', finishedIds)
        .eq('status', 'confirmed')
        .not('player_id', 'is', null) as unknown as Promise<{ data: { player_id: string }[] | null }>,
      supabase
        .from('match_events')
        .select('player_id')
        .in('match_id', finishedIds)
        .eq('event_type', 'goal')
        .not('player_id', 'is', null) as unknown as Promise<{ data: { player_id: string }[] | null }>,
    ])
    for (const r of playedRows || []) { const row = rowFor(r.player_id); if (row) row.played += 1 }
    for (const r of goalRows || []) { const row = rowFor(r.player_id); if (row) row.goals += 1 }
    for (const m of finished) { if (m.mvp_player_id) { const row = rowFor(m.mvp_player_id); if (row) row.mvp += 1 } }

    // Scores are visible to admins and captains only (RLS on player_rating_summary
    // enforces it; this just avoids a pointless query for members).
    if (isAdminOrCaptain && tableById.size > 0) {
      const { data: summaryRows } = await supabase
        .from('player_rating_summary')
        .select('player_id, overall')
        .in('player_id', Array.from(tableById.keys())) as { data: { player_id: string; overall: number }[] | null }
      for (const s of summaryRows || []) { const row = tableById.get(s.player_id); if (row) row.rating = s.overall }
    }
  }
  const table = Array.from(tableById.values())
    .sort((a, b) => b.played - a.played || b.goals - a.goals || b.mvp - a.mvp || a.name.localeCompare(b.name))
    .slice(0, 8)

  // Próximas fechas: the active recurring pattern, else the group defaults.
  const { data: pattern } = await supabase
    .from('recurring_patterns')
    .select('weekday, match_time')
    .eq('group_id', group.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle() as { data: { weekday: number; match_time: string } | null }
  const usualWeekday = pattern?.weekday ?? group.default_match_day
  const usualTime = (pattern?.match_time ?? group.default_match_time ?? '').slice(0, 5)
  const nextDates: Date[] = []
  if (usualWeekday !== null && usualWeekday !== undefined) {
    const cursor = new Date()
    for (let i = 1; i <= 28 && nextDates.length < 3; i++) {
      const d = new Date(cursor.getTime() + i * 24 * 60 * 60 * 1000)
      if (weekdayIndexInTimezone(d, timeZone) === usualWeekday) nextDates.push(d)
    }
  }

  // Result nudge for this group (docs/match-results-consensus.md §6): the
  // latest finished, unlocked match inside the window that the viewer played
  // and has not reported. Reporting also counts as "+1 compromiso".
  let reportNudge: { id: string; date_time: string } | null = null
  if (finished.length > 0) {
    const { data: settingsRow } = await supabase
      .from('notification_settings')
      .select('results_window_days')
      .eq('group_id', group.id)
      .maybeSingle() as { data: { results_window_days: number | null } | null }
    const windowMs = (settingsRow?.results_window_days ?? 7) * 24 * 60 * 60 * 1000
    const now = new Date().getTime()
    type NudgeCandidate = { id: string; date_time: string; result_status: string }
    const { data: candidateRows } = await supabase
      .from('matches')
      .select('id, date_time, result_status')
      .in('id', finished.map(m => m.id))
      .neq('result_status', 'locked') as { data: NudgeCandidate[] | null }
    const candidates = (candidateRows || []).filter(m => now - new Date(m.date_time).getTime() < windowMs)
    if (candidates.length > 0) {
      const ids = candidates.map(m => m.id)
      const [{ data: mySignups }, { data: myReports }] = await Promise.all([
        supabase
          .from('match_signups')
          .select('match_id')
          .in('match_id', ids)
          .eq('player_id', playerProfile.id)
          .eq('status', 'confirmed') as unknown as Promise<{ data: { match_id: string }[] | null }>,
        supabase
          .from('match_reports')
          .select('match_id')
          .in('match_id', ids)
          .eq('reporter_player_id', playerProfile.id) as unknown as Promise<{ data: { match_id: string }[] | null }>,
      ])
      const played = new Set((mySignups || []).map(s => s.match_id))
      const reported = new Set((myReports || []).map(r => r.match_id))
      const hit = candidates
        .sort((a, b) => b.date_time.localeCompare(a.date_time))
        .find(m => played.has(m.id) && !reported.has(m.id))
      if (hit) reportNudge = { id: hit.id, date_time: hit.date_time }
    }
  }

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/invite/${group.invite_code}`

  // Subtitle: "Lunes 20:00 · Cancha … · 14 lugares · 18 miembros"
  const subtitleParts: string[] = []
  if (usualWeekday !== null && usualWeekday !== undefined) {
    subtitleParts.push(`${t(`days.${DAY_KEYS[usualWeekday]}`)}${usualTime ? ` ${usualTime}` : ''}`)
  }
  if (nextMatch?.location) subtitleParts.push(nextMatch.location)
  subtitleParts.push(t('ui.matchScreens.dashboard.spots', { n: group.default_max_players }))
  subtitleParts.push(
    members.length === 1
      ? t('ui.matchScreens.dashboard.membersOne')
      : t('ui.matchScreens.dashboard.members', { n: members.length })
  )
  const subtitle = subtitleParts.join(' · ')

  // One orange per screen (docs/ui-rework/01-brand.md §1): while the next
  // match is full / closed and has no teams, arming the teams is the thing
  // to do, so it takes the primary and "Crear partido" goes outline.
  const showBuildTeams =
    isAdminOrCaptain &&
    !!nextMatch &&
    !nextHasTeams &&
    (nextMatch.status === 'signup_open' || nextMatch.status === 'full' || nextMatch.status === 'signup_closed') &&
    confirmed.length >= 4
  // Teams already armed: everyone gets "Ver equipos" in the same slot.
  const showViewTeams = !!nextMatch && nextHasTeams
  const createIsPrimary = !showBuildTeams && !showViewTeams && nextMatch?.status !== 'draft'

  const matchHref = (id: string) => `/groups/${groupSlug}/matches/${id}`
  const waitlistNames = waitlist
    .map(s => s.player_profiles?.display_name || s.guest_players?.display_name)
    .filter((n): n is string => !!n)

  const lastScore = lastResultMatch ? scoreOf(lastResultMatch) : null
  const lastMvp = lastResultMatch?.mvp_player_id ? memberNameById.get(lastResultMatch.mvp_player_id) ?? null : null

  const announcementText = nextMatch
    ? buildAnnouncementText({
        groupName: group.name,
        dateTime: nextMatch.date_time,
        location: nextMatch.location,
        confirmedCount: confirmed.length,
        maxPlayers: nextMatch.max_players,
        matchId: nextMatch.id,
        timeZone,
      })
    : ''
  const waUrl = `https://wa.me/?text=${encodeURIComponent(announcementText)}`

  const pendingRatingsCard = pendingRatings > 0 && (
    <Card variant="solid">
      <CardContent className="flex items-center gap-3 p-4 lg:p-4">
        <Star className="h-5 w-5 shrink-0 fill-primary text-primary" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {pendingRatings === 1
              ? t('ui.matchScreens.dashboard.pendingRatingsOne')
              : t('ui.matchScreens.dashboard.pendingRatings', { n: pendingRatings })}
          </p>
          <p className="text-xs text-muted-foreground text-pretty">{t('ui.matchScreens.dashboard.pendingRatingsBody')}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/groups/${groupSlug}/rate`}>{t('ui.matchScreens.dashboard.rate')}</Link>
        </Button>
      </CardContent>
    </Card>
  )

  const reportNudgeCard = reportNudge && (
    <Link
      href={`${matchHref(reportNudge.id)}#reportar`}
      className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card variant="solid" className="hover:bg-accent/40">
        <CardContent className="flex items-center gap-3 p-4 lg:p-4">
          <ClipboardList className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t('ui.matchScreens.dashboard.reportNudgeTitle')}</p>
            <p className="text-xs text-muted-foreground text-pretty">
              {t('ui.matchScreens.dashboard.reportNudgeBody', { date: formatShortDate(t, reportNudge.date_time, timeZone) })}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">{t('memberScore.plusOne')}</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        </CardContent>
      </Card>
    </Link>
  )

  return (
    <div className="space-y-6">
      <TopBarConfig
        title={<GroupSwitcherTitle fallback={group.name} />}
        action={
          isAdmin ? (
            <TopBarAction href={`/groups/${groupSlug}/settings`} label={t('ui.shell.groupSettings')}>
              <Settings className="h-5 w-5" strokeWidth={1.75} />
            </TopBarAction>
          ) : undefined
        }
      />

      <PageHeader
        title={group.name}
        subtitle={subtitle}
        actions={
          <>
            <InviteButton inviteUrl={inviteUrl} />
            {isAdminOrCaptain && (
              <Button asChild variant={createIsPrimary ? 'default' : 'outline'}>
                <Link href={`/groups/${groupSlug}/matches/new`}>
                  <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  {t('ui.matchScreens.dashboard.createMatch')}
                </Link>
              </Button>
            )}
          </>
        }
      />

      {/* Mobile: keep the group context and its everyday actions within reach. */}
      <div className="space-y-4 lg:hidden">
        <h1 className="sr-only">{group.name}</h1>
        <p className="text-sm text-muted-foreground text-pretty">{subtitle}</p>
        <div className="flex flex-wrap gap-2">
          {isAdminOrCaptain && (
            <Button asChild variant={createIsPrimary && !nextMatch ? 'default' : 'outline'}>
              <Link href={`/groups/${groupSlug}/matches/new`}>
                <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                {t('ui.matchScreens.dashboard.createMatch')}
              </Link>
            </Button>
          )}
          <InviteButton inviteUrl={inviteUrl} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main column */}
        <div className="min-w-0 space-y-6">
          {/* Próximo partido */}
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Eyebrow>{t('ui.matchScreens.dashboard.nextMatch')}</Eyebrow>
                {nextMatch && <MatchStatusBadge status={nextMatch.status} label={t(`matches.status.${nextMatch.status}`)} />}
              </div>
              {nextMatch ? (
                <div className="space-y-2">
                  <CardTitle className="text-2xl lg:text-3xl">
                    <Link
                      href={matchHref(nextMatch.id)}
                      className="rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                    >
                      {formatHeroDate(t, nextMatch.date_time, timeZone)}
                    </Link>
                  </CardTitle>
                  {nextMatch.location && <p className="text-sm text-muted-foreground">{nextMatch.location}</p>}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-pretty">
                  {otherUpcoming.length > 0
                    ? t('ui.polish.noOpenMatch')
                    : isAdminOrCaptain
                      ? t('ui.matchScreens.dashboard.noNextMatchAdmin')
                      : t('ui.matchScreens.dashboard.noNextMatch')}
                </p>
              )}
            </CardHeader>

            {nextMatch && (
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {(showBuildTeams || showViewTeams) && (
                    <Button asChild variant="default">
                      <Link href={`${matchHref(nextMatch.id)}/teams`}>
                        <Users className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                        {showViewTeams
                          ? t('ui.matchScreens.match.viewTeams')
                          : t('ui.matchScreens.dashboard.buildTeams')}
                      </Link>
                    </Button>
                  )}
                  {nextMatch.status === 'draft' && (
                    <Button asChild><Link href={matchHref(nextMatch.id)}>{t('ui.workflow.reviewDraft')}</Link></Button>
                  )}
                </div>
                <SpotsMeter
                  confirmed={confirmed.length}
                  max={nextMatch.max_players}
                  waitlist={waitlist.length}
                  language={language}
                />

                {confirmed.length > 0 && (
                  <details className="border-t border-border pt-3">
                    <summary className="-mt-3 cursor-pointer py-3 text-sm font-semibold">{t('ui.workflow.roster', { n: confirmed.length })}</summary>
                    <div className="pt-3">
                      <ol className="grid grid-cols-1 lg:grid-cols-2 lg:gap-x-6 [&>li:last-child>*]:border-b-0 lg:[&>li:nth-last-child(2):nth-child(odd)>*]:border-b-0">
                        {confirmed.map((s, i) => {
                          const player = s.player_profiles
                          const guest = s.guest_players
                          const name = player?.display_name || guest?.display_name || '—'
                          return (
                            <li key={s.id}>
                              <PlayerRow
                                index={i + 1}
                                name={name}
                                nickname={player?.nickname}
                                position={player?.main_position || guest?.preferred_positions?.[0] || null}
                                guest={!player && !!guest}
                                language={language}
                              />
                            </li>
                          )
                        })}
                      </ol>
                    </div>
                  </details>
                )}

                {waitlistNames.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t('ui.matchScreens.dashboard.waitlistLine', { names: waitlistNames.join(', ') })}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  {(nextMatch.status === 'signup_open' || nextMatch.status === 'full') && (
                    <Button asChild variant="outline">
                      <a href={waUrl} target="_blank" rel="noopener noreferrer">
                        <MessageCircle className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                        {t('ui.matchScreens.dashboard.shareWhatsApp')}
                      </a>
                    </Button>
                  )}
                  {isAdminOrCaptain && (
                    <Button asChild variant="outline">
                      <Link href={`${matchHref(nextMatch.id)}#invitado`}>
                        <UserPlus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                        {t('ui.matchScreens.dashboard.addGuest')}
                      </Link>
                    </Button>
                  )}
                </div>

                {/* Keep the match's signup/details entry point visible at every width. */}
                <Link
                  href={matchHref(nextMatch.id)}
                  className="-mx-4 -mb-4 flex min-h-12 items-center justify-between border-t border-border bg-accent/30 px-4 text-sm font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset lg:-mx-5 lg:-mb-5 lg:px-5"
                >
                  {t('ui.matchScreens.dashboard.viewMatch')}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                </Link>
              </CardContent>
            )}
          </Card>

          {/* Mobile: the aside collapses to two tiles */}
          <div className="grid grid-cols-2 gap-3 lg:hidden">
            <Link
              href={`/groups/${groupSlug}/players`}
              className="flex min-h-[72px] flex-col justify-between rounded-md border border-border bg-card p-3 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Eyebrow>{t('ui.matchScreens.dashboard.tileTable')}</Eyebrow>
              <span className="flex items-end justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {table[0] ? table[0].name : t('ui.matchScreens.dashboard.tileSeePlayers')}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
              </span>
            </Link>
            <Link
              href={lastResultMatch ? matchHref(lastResultMatch.id) : `/groups/${groupSlug}/matches`}
              className="flex min-h-[72px] flex-col justify-between rounded-md border border-border bg-card p-3 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Eyebrow>{t('ui.matchScreens.dashboard.tileLastResult')}</Eyebrow>
              <span className="flex items-end justify-between gap-2">
                {lastScore ? (
                  <ScoreText dark={lastScore.dark} light={lastScore.light} className="text-lg leading-none" />
                ) : (
                  <span className="truncate text-sm text-muted-foreground">
                    {lastResultMatch ? t('ui.matchScreens.dashboard.noScore') : t('ui.matchScreens.dashboard.lastResultEmpty')}
                  </span>
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
              </span>
            </Link>
          </div>

          {/* Mobile: the actionable aside cards stay reachable */}
          {(pendingRatingsCard || reportNudgeCard) && (
            <div className="space-y-3 lg:hidden">
              {pendingRatingsCard}
              {reportNudgeCard}
            </div>
          )}

          {/* Próximos partidos */}
          {otherUpcoming.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <Eyebrow as="h2">{t('ui.matchScreens.dashboard.upcoming')}</Eyebrow>
                <Link href={`/groups/${groupSlug}/matches`} className="text-xs text-muted-foreground hover:text-foreground">
                  {t('ui.matchScreens.dashboard.seeAll')}
                </Link>
              </div>
              <ul className="[&>li:last-child>a]:border-b-0">
                {otherUpcoming.map(m => (
                  <li key={m.id}>
                    <MatchRow
                      href={matchHref(m.id)}
                      date={formatRowDate(t, m.date_time, timeZone)}
                      meta={[formatMatchTime(m.date_time, timeZone), m.location].filter(Boolean).join(' · ')}
                      trailing={
                        <>
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {confirmedCountByMatch.get(m.id) || 0}/{m.max_players}
                          </span>
                          <MatchStatusBadge status={m.status} label={t(`matches.status.${m.status}`)} />
                        </>
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Partidos recientes */}
          {recent.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <Eyebrow as="h2">{t('ui.matchScreens.dashboard.recent')}</Eyebrow>
                <Link href={`/groups/${groupSlug}/matches`} className="text-xs text-muted-foreground hover:text-foreground">
                  {t('ui.matchScreens.dashboard.seeAll')}
                </Link>
              </div>
              <ul className="[&>li:last-child>a]:border-b-0">
                {recent.map(m => {
                  const score = scoreOf(m)
                  return (
                    <li key={m.id}>
                      <MatchRow
                        href={matchHref(m.id)}
                        date={formatRowDate(t, m.date_time, timeZone)}
                        meta={[formatMatchTime(m.date_time, timeZone), m.location].filter(Boolean).join(' · ')}
                        trailing={
                          score ? (
                            <ScoreText dark={score.dark} light={score.light} className="text-base" />
                          ) : (
                            <MatchStatusBadge status={m.status} label={t(`matches.status.${m.status}`)} />
                          )
                        }
                      />
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </div>

        {/* Aside (browser only) */}
        <aside className="hidden min-w-0 space-y-6 lg:block">
          {pendingRatingsCard}
          {reportNudgeCard}

          <Card variant="solid">
            <CardHeader>
              <Eyebrow as="h2">{t('ui.matchScreens.dashboard.table')}</Eyebrow>
            </CardHeader>
            <CardContent>
              {table.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('ui.matchScreens.dashboard.tableEmpty')}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">
                      <th scope="col" className="py-1.5 text-left font-medium">{t('ui.matchScreens.dashboard.colPlayer')}</th>
                      <th scope="col" className="py-1.5 text-right font-medium">{t('ui.matchScreens.dashboard.colPJ')}</th>
                      <th scope="col" className="py-1.5 text-right font-medium">{t('ui.matchScreens.dashboard.colG')}</th>
                      <th scope="col" className="py-1.5 text-right font-medium">{t('ui.matchScreens.dashboard.colMVP')}</th>
                      {isAdminOrCaptain && (
                        <th scope="col" className="py-1.5 text-right font-medium">{t('ui.matchScreens.dashboard.colRating')}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {table.map(row => (
                      <tr key={row.id} className="border-b border-border last:border-b-0">
                        <td className="max-w-0 truncate py-1.5 pr-2">
                          <Link href={`/groups/${groupSlug}/players/${row.id}`} className="hover:underline">
                            {row.name}
                          </Link>
                        </td>
                        <td className="py-1.5 text-right font-mono tabular-nums">{row.played}</td>
                        <td className="py-1.5 text-right font-mono tabular-nums">{row.goals}</td>
                        <td className="py-1.5 text-right font-mono tabular-nums">{row.mvp}</td>
                        {isAdminOrCaptain && (
                          <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                            {row.rating === null ? '–' : row.rating.toFixed(1)}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card variant="solid">
            <CardHeader>
              <Eyebrow as="h2">{t('ui.matchScreens.dashboard.nextDates')}</Eyebrow>
            </CardHeader>
            <CardContent>
              {nextDates.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('ui.matchScreens.dashboard.nextDatesEmpty')}</p>
              ) : (
                <ul className="[&>li:last-child]:border-b-0">
                  {nextDates.map(d => (
                    <li key={d.toISOString()} className="flex items-center justify-between border-b border-border py-2 text-sm">
                      <span>{formatShortDate(t, d, timeZone)}</span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">{usualTime}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card variant="solid">
            <CardHeader>
              <Eyebrow as="h2">{t('ui.matchScreens.dashboard.lastResult')}</Eyebrow>
            </CardHeader>
            <CardContent className="space-y-2">
              {lastResultMatch ? (
                <>
                  <Link href={matchHref(lastResultMatch.id)} className="block rounded-[3px] hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {lastScore ? (
                      <span className="flex items-center justify-between gap-3 text-sm">
                        <span>{t('ui.matchScreens.dashboard.dark')}</span>
                        <ScoreText dark={lastScore.dark} light={lastScore.light} className="text-lg" />
                        <span>{t('ui.matchScreens.dashboard.light')}</span>
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t('ui.matchScreens.dashboard.noScore')}</span>
                    )}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {[lastMvp ? t('ui.matchScreens.dashboard.mvp', { name: lastMvp }) : null, formatShortDate(t, lastResultMatch.date_time, timeZone)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t('ui.matchScreens.dashboard.lastResultEmpty')}</p>
              )}
            </CardContent>
          </Card>

          {group.description && <p className="text-sm text-muted-foreground text-pretty">{group.description}</p>}
        </aside>
      </div>
    </div>
  )
}
