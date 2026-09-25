import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Award } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { SkillSummaryCard } from '@/components/player-skills'
import { MemberScoreBreakdown, MemberScoreStars } from '@/components/member-score'
import { MemberEventDeleteButton, MemberScoreAdjust } from '@/components/member-score-adjust'
import type { RatingSummary } from '@/lib/ratings'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Eyebrow } from '@/components/ui/eyebrow'
import { PositionChip } from '@/components/ui/player-row'
import { TopBarConfig } from '@/components/layout/top-bar'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'
import type { MemberBreakdown, MemberEventSource, MemberEventType, MemberScoringSettings } from '@/types/database'
import {
  DEFAULT_TIMEZONE,
  formatMatchDateNumeric,
  formatMatchDateShort,
  formatMatchDayMonth,
  formatMatchTime,
  formatWeekday,
} from '@/lib/utils/datetime'
import { cn } from '@/lib/utils/cn'

interface PageProps {
  params: Promise<{ groupSlug: string; playerId: string }>
}

// Player detail (docs/ui-rework/03-screens.md §7): hero with the 64px avatar
// and the name in the display face; two columns in the browser (main =
// stats, aside = member score, badges, skills), stacked main-then-aside on
// mobile.

const BADGE_KEYS = new Set(['hat_trick', 'playmaker', 'ironman', 'safe_hands', 'mvp', 'mvp_streak', 'first_match'])

export default async function PlayerProfilePage({ params }: PageProps) {
  const { groupSlug, playerId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  const { data: currentPlayer } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null }

  if (!currentPlayer) return notFound()

  const { data: group } = await supabase
    .from('groups')
    .select('id, name, slug, timezone')
    .eq('slug', groupSlug)
    .single() as { data: { id: string; name: string; slug: string; timezone: string | null } | null }

  if (!group) return notFound()

  const timeZone = group.timezone || DEFAULT_TIMEZONE

  type PlayerProfileFull = {
    id: string
    display_name: string
    nickname: string | null
    preferred_positions: string[]
    main_position: string
    footedness: string
    goalkeeper_willingness: number
    fitness_status: string
    matches_played: number
    goals: number
    assists: number
    mvp_count: number
    clean_sheets: number
    created_at: string
  }

  const { data: player } = await supabase
    .from('player_profiles')
    .select('*')
    .eq('id', playerId)
    .single() as { data: PlayerProfileFull | null }

  if (!player) return notFound()

  const { data: viewerMembership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', group.id)
    .eq('player_id', currentPlayer.id)
    .eq('is_active', true)
    .single() as { data: { role: 'admin' | 'captain' | 'member' } | null }

  if (!viewerMembership) return notFound()

  const isAdmin = viewerMembership.role === 'admin'
  const isAdminOrCaptain = isAdmin || viewerMembership.role === 'captain'

  const { data: userData } = await supabase
    .from('users')
    .select('preferred_language')
    .eq('id', user.id)
    .single() as { data: { preferred_language: Language } | null }
  const language: Language = userData?.preferred_language ?? 'es'
  const t = getT(language)

  // The player's own role in this group, for the hero.
  const { data: playerMembership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', group.id)
    .eq('player_id', playerId)
    .eq('is_active', true)
    .maybeSingle() as { data: { role: 'admin' | 'captain' | 'member' } | null }

  // Member score ("Compromiso", docs/member-scoring.md §5.4): visible when the
  // group opted into 'group' visibility, or the viewer is admin/captain, or the
  // viewer is looking at their own page. Hidden entirely while scoring is off.
  const { data: scoringSettings } = await supabase
    .rpc('member_scoring_settings', { p_group_id: group.id }) as { data: MemberScoringSettings | null }
  const canSeeScore = !!scoringSettings?.enabled
    && (scoringSettings.visibility === 'group' || isAdminOrCaptain || currentPlayer.id === playerId)

  type MemberScoreRow = { member_score: number | null; member_breakdown: MemberBreakdown | null }
  type MemberEventRow = {
    id: string
    match_id: string | null
    type: MemberEventType
    points: number
    source: MemberEventSource
    reported_by: string | null
    note: string | null
    created_at: string
  }
  type WindowMatch = { id: string; date_time: string; location: string | null }

  let memberScore: MemberScoreRow | null = null
  let memberEvents: MemberEventRow[] = []
  const windowMatchById = new Map<string, WindowMatch>()
  const reporterNameById = new Map<string, string>()

  if (canSeeScore) {
    const { data: scoreRow } = await supabase
      .from('group_memberships')
      .select('member_score, member_breakdown')
      .eq('group_id', group.id)
      .eq('player_id', playerId)
      .eq('is_active', true)
      .maybeSingle() as { data: MemberScoreRow | null }
    memberScore = scoreRow

    // The window is the group's last N finished matches (§3); match-less events
    // (adjustments, newcomer ratings) count from the oldest window match on.
    const windowSize = scoringSettings?.window_matches ?? 10
    const { data: windowMatches } = await supabase
      .from('matches')
      .select('id, date_time, location')
      .eq('group_id', group.id)
      .eq('status', 'finished')
      .order('date_time', { ascending: false })
      .limit(windowSize) as { data: WindowMatch[] | null }
    for (const m of windowMatches || []) windowMatchById.set(m.id, m)
    const oldest = windowMatches && windowMatches.length > 0
      ? windowMatches[windowMatches.length - 1].date_time
      : null

    const { data: eventRows } = await supabase
      .from('member_events')
      .select('id, match_id, type, points, source, reported_by, note, created_at')
      .eq('group_id', group.id)
      .eq('player_id', playerId)
      .order('created_at', { ascending: false }) as { data: MemberEventRow[] | null }

    memberEvents = (eventRows || []).filter((e) =>
      e.match_id
        ? windowMatchById.has(e.match_id)
        : oldest === null || e.created_at >= oldest
    )

    const reporterIds = Array.from(new Set(memberEvents.map((e) => e.reported_by).filter((id): id is string => !!id)))
    if (reporterIds.length > 0) {
      const { data: reporters } = await supabase
        .from('player_profiles')
        .select('id, display_name')
        .in('id', reporterIds) as { data: { id: string; display_name: string }[] | null }
      for (const r of reporters || []) reporterNameById.set(r.id, r.display_name)
    }
  }

  let ratingSummary: RatingSummary | null = null
  if (isAdminOrCaptain) {
    const { data: summaryRow } = await supabase
      .from('player_rating_summary')
      .select('player_id, goalkeeping, defense, attack, physical, overall, tags, peer_votes, matches_rated')
      .eq('player_id', playerId)
      .maybeSingle() as { data: RatingSummary | null }
    ratingSummary = summaryRow
  }

  type BadgeRow = {
    id: string
    badge_type: string
    earned_at: string
    metadata: Record<string, unknown>
  }

  const { data: badges } = await supabase
    .from('player_badges')
    .select('*')
    .eq('player_id', playerId)
    .order('earned_at', { ascending: false }) as { data: BadgeRow[] | null }

  type RecentMatch = {
    id: string
    match_id: string
    status: string
    signup_time: string
    matches: {
      id: string
      date_time: string
      location: string | null
      status: string
    } | null
  }

  const { data: recentSignups } = await supabase
    .from('match_signups')
    .select(`
      id,
      match_id,
      status,
      signup_time,
      matches (
        id,
        date_time,
        location,
        status
      )
    `)
    .eq('player_id', playerId)
    .in('status', ['confirmed', 'did_not_show'])
    .order('signup_time', { ascending: false })
    .limit(10) as { data: RecentMatch[] | null }

  const recentMatches = (recentSignups || [])
    .filter((s) => s.matches !== null)
    .map((s) => ({
      signupStatus: s.status,
      ...(s.matches as { id: string; date_time: string; location: string | null; status: string }),
    }))

  type RatingAgg = { rating: number }
  const { data: ratingsReceived } = await supabase
    .from('match_ratings')
    .select('rating')
    .eq('rated_player_id', playerId) as { data: RatingAgg[] | null }

  const avgRating = ratingsReceived && ratingsReceived.length > 0
    ? ratingsReceived.reduce((sum, r) => sum + r.rating, 0) / ratingsReceived.length
    : null

  const positionLabel = (code: string) => {
    const label = t(`positions.${code}`)
    return label === `positions.${code}` ? code : label
  }
  const footednessLabel =
    player.footedness === 'left'
      ? t('ui.screens.player.leftFooted')
      : player.footedness === 'right'
        ? t('ui.screens.player.rightFooted')
        : t('ui.screens.player.bothFooted')
  const roleLabel = playerMembership ? t(`groups.roles.${playerMembership.role}`) : null
  const otherPositions = (player.preferred_positions || []).filter((p) => p !== player.main_position)

  const stats: { label: string; value: string }[] = [
    { label: t('players.matchesPlayed'), value: String(player.matches_played) },
    { label: t('players.goals'), value: String(player.goals) },
    { label: t('players.assists'), value: String(player.assists) },
    { label: t('players.mvpCount'), value: String(player.mvp_count) },
  ]

  const gkWillingness = [
    t('ui.screens.player.gkNever'),
    t('ui.screens.player.gkIfNeeded'),
    t('ui.screens.player.gkOk'),
    t('ui.screens.player.gkLoves'),
  ][player.goalkeeper_willingness] ?? '–'

  const statRow = (label: string, value: string, key: string) => (
    <div key={key} className="flex items-center justify-between gap-4 border-b border-border py-2.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  )

  const memberScoreCard = canSeeScore && (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <CardTitle>{t('memberScore.title')}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {scoringSettings?.visibility === 'self' && currentPlayer.id === playerId && !isAdminOrCaptain
                ? t('memberScore.privateHint')
                : t('memberScore.subtitle')}
            </p>
          </div>
          {isAdmin && <MemberScoreAdjust groupId={group.id} playerId={playerId} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <MemberScoreStars score={memberScore?.member_score ?? null} variant="full" language={language} />
        <MemberScoreBreakdown breakdown={memberScore?.member_breakdown ?? null} language={language} />

        <div className="border-t border-border pt-3">
          <Eyebrow as="h4">{t('memberScore.eventLog')}</Eyebrow>
          <p className="mt-1 text-xs text-muted-foreground">{t('memberScore.eventLogHint')}</p>
          {memberEvents.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('memberScore.eventLogEmpty')}</p>
          ) : (
            <ul className="mt-2 [&>li:last-child]:border-b-0">
              {memberEvents
                .map((e) => ({ ...e, when: e.match_id ? windowMatchById.get(e.match_id)?.date_time ?? e.created_at : e.created_at }))
                .sort((a, b) => b.when.localeCompare(a.when) || b.created_at.localeCompare(a.created_at))
                .map((event) => {
                  const match = event.match_id ? windowMatchById.get(event.match_id) : undefined
                  const reporter = event.reported_by ? reporterNameById.get(event.reported_by) : undefined
                  return (
                    <li key={event.id} className="flex items-start gap-3 border-b border-border py-2 text-sm">
                      <span className="w-11 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                        {formatMatchDayMonth(event.when, timeZone)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{t(`memberScore.events.${event.type}`)}</p>
                        <p className="break-words text-xs text-muted-foreground">
                          {match ? (
                            <Link href={`/groups/${groupSlug}/matches/${match.id}`} className="hover:underline">
                              {formatMatchDateShort(match.date_time, timeZone)}
                              {match.location ? ` · ${match.location}` : ''}
                            </Link>
                          ) : (
                            formatMatchDateNumeric(event.created_at, timeZone)
                          )}
                          {' · '}
                          {reporter ? t('memberScore.reportedBy', { name: reporter }) : t('memberScore.system')}
                        </p>
                        {event.note && <p className="mt-0.5 text-xs italic text-muted-foreground">{event.note}</p>}
                      </div>
                      <span
                        className={cn(
                          'font-mono text-sm font-medium tabular-nums',
                          event.points < 0 ? 'text-destructive' : event.points > 0 ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {event.points > 0 ? '+' : ''}{event.points}
                      </span>
                      {isAdmin && <MemberEventDeleteButton eventId={event.id} />}
                    </li>
                  )
                })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6">
      {/* The hero below already carries the name, so the top bar stays generic
          (02-shell §2: one title per screen). */}
      <TopBarConfig title={t('ui.screens.player.topBar')} back={`/groups/${groupSlug}/players`} />

      {/* Hero: same block at every width (the avatar is part of the header, so PageHeader's text-only row is not used). */}
      <header className="flex items-start gap-4">
        <Avatar fallback={player.display_name} size="lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <Eyebrow className="hidden lg:block">{group.name}</Eyebrow>
          <h1 className="font-display text-2xl font-extrabold leading-tight tracking-tight text-balance lg:text-3xl">
            {player.display_name}
            {player.nickname && (
              <span className="ml-2 font-sans text-base font-normal text-muted-foreground">({player.nickname})</span>
            )}
          </h1>
          <div className="flex flex-wrap items-center gap-1.5">
            {roleLabel && playerMembership?.role !== 'member' && <Badge variant="secondary">{roleLabel}</Badge>}
            <PositionChip position={player.main_position} className="text-foreground" />
            {otherPositions.map((pos) => (
              <PositionChip key={pos} position={pos} />
            ))}
            <span className="text-xs text-muted-foreground">{footednessLabel}</span>
            {player.fitness_status !== 'ok' && (
              <Badge variant={player.fitness_status === 'injured' ? 'destructive' : 'warning'}>
                {player.fitness_status === 'injured' ? t('players.injured') : t('players.limited')}
              </Badge>
            )}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main column */}
        <div className="min-w-0 space-y-6">
          <dl className="grid grid-cols-4 gap-2">
            {stats.map((s) => (
              <div key={s.label} className="rounded-md bg-card px-2 py-3 text-center">
                <dd className="font-display text-2xl font-extrabold tabular-nums">{s.value}</dd>
                <dt className="mt-1 font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">{s.label}</dt>
              </div>
            ))}
          </dl>

          <Card>
            <CardHeader>
              <CardTitle>{t('ui.screens.player.detailedStats')}</CardTitle>
            </CardHeader>
            <CardContent>
              {statRow(t('players.cleanSheets'), String(player.clean_sheets), 'cs')}
              {avgRating !== null && statRow(t('ui.screens.player.avgRating'), `${avgRating.toFixed(1)} / 5`, 'avg')}
              {statRow(t('ui.screens.player.gkWillingness'), gkWillingness, 'gk')}
              {player.matches_played > 0 &&
                statRow(t('ui.screens.player.goalsPerMatch'), (player.goals / player.matches_played).toFixed(2), 'gpm')}
              {statRow(t('ui.screens.player.mainPosition'), positionLabel(player.main_position), 'pos')}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('ui.screens.player.recentMatches')}</CardTitle>
            </CardHeader>
            <CardContent>
              {recentMatches.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('ui.screens.player.noMatches')}</p>
              ) : (
                <ul className="[&>li:last-child>a]:border-b-0">
                  {recentMatches.map((match) => (
                    <li key={match.id}>
                      <Link
                        href={`/groups/${groupSlug}/matches/${match.id}`}
                        className="flex min-h-11 items-center gap-3 border-b border-border py-2 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                          <span className="block">{formatWeekday(match.date_time, timeZone).slice(0, 3)}</span>
                          <span className="block text-foreground">{formatMatchDayMonth(match.date_time, timeZone)}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{match.location || t('ui.screens.player.noLocation')}</span>
                          <span className="block font-mono text-xs text-muted-foreground">{formatMatchTime(match.date_time, timeZone)}</span>
                        </span>
                        <Badge
                          variant={
                            match.signupStatus === 'did_not_show'
                              ? 'warning'
                              : match.status === 'finished'
                                ? 'outline'
                                : match.status === 'cancelled'
                                  ? 'destructive'
                                  : 'secondary'
                          }
                        >
                          {match.signupStatus === 'did_not_show'
                            ? t('ui.screens.player.noShow')
                            : match.status === 'finished'
                              ? t('ui.screens.player.played')
                              : match.status === 'cancelled'
                                ? t('ui.screens.player.cancelled')
                                : t('ui.screens.player.pending')}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Aside */}
        <aside className="min-w-0 space-y-6">
          {memberScoreCard}

          {badges && badges.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t('ui.screens.player.badges')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="[&>li:last-child]:border-b-0">
                  {badges.map((badge) => {
                    const label = BADGE_KEYS.has(badge.badge_type)
                      ? t(`ui.screens.player.badgeNames.${badge.badge_type}`)
                      : badge.badge_type
                    return (
                      <li key={badge.id} className="flex items-center gap-3 border-b border-border py-2 text-sm">
                        <Award className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {formatMatchDateNumeric(badge.earned_at, timeZone)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          {isAdminOrCaptain && (
            <Card>
              <CardHeader>
                <CardTitle>{t('ui.screens.player.groupRating')}</CardTitle>
              </CardHeader>
              <CardContent>
                <SkillSummaryCard summary={ratingSummary} language={language} />
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  )
}
