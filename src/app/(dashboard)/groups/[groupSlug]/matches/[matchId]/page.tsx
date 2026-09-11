import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  Users,
  Edit,
  Trophy,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MatchAnnouncement } from './match-announcement'
import { SignupList } from './signup-list'
import { SignupActions } from './signup-actions'
import { MatchAdminActions } from './match-admin-actions'
import { AddGuestForm } from './add-guest-form'
import { PostMatchVoting } from './post-match-voting'
import { RulesManager } from './rules-manager'
import { RealtimeWrapper } from './realtime-wrapper'
import { MatchResults } from './match-results'
import { ReportForm, type OwnReport, type ReportTeam } from './report-form'
import { ResultConsensus } from './result-consensus'
import type { MatchResultStatus } from '@/types/database'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'
import { DEFAULT_TIMEZONE, formatMatchDateNumeric, formatMatchTime, weekdayIndexInTimezone } from '@/lib/utils/datetime'

interface PageProps {
  params: Promise<{ groupSlug: string; matchId: string }>
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline',
  signup_open: 'default',
  signup_closed: 'outline',
  full: 'secondary',
  teams_created: 'default',
  finished: 'outline',
  cancelled: 'destructive',
}

export default async function MatchDetailPage({ params }: PageProps) {
  const { groupSlug, matchId } = await params
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

  // Get match details
  const { data: match } = await supabase
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .eq('group_id', group.id)
    .single() as { data: {
      id: string
      group_id: string
      date_time: string
      location: string | null
      status: string
      max_players: number
      notes: string | null
      results_finalized: boolean
      result_status: MatchResultStatus
      mvp_player_id: string | null
      created_at: string
    } | null }

  if (!match) return notFound()

  // Current MVP (if voted) - shown with a trophy in the header
  let mvpPlayerName: string | null = null
  if (match.mvp_player_id) {
    const { data: mvpPlayer } = await supabase
      .from('player_profiles')
      .select('display_name')
      .eq('id', match.mvp_player_id)
      .single() as { data: { display_name: string } | null }
    mvpPlayerName = mvpPlayer?.display_name ?? null
  }

  // Get signups with player info (both registered and guest players)
  type SignupResult = {
    id: string
    status: string
    signup_time: string
    position_preference: string | null
    notes: string | null
    waitlist_position: number | null
    player_id: string | null
    guest_player_id: string | null
    player_profiles: {
      id: string
      display_name: string
      nickname: string | null
      main_position: string
    } | null
    guest_players: {
      id: string
      display_name: string
      notes: string | null
      estimated_rating: number
      preferred_positions: string[]
    } | null
  }

  const { data: signups } = await supabase
    .from('match_signups')
    .select(`
      id,
      status,
      signup_time,
      position_preference,
      notes,
      waitlist_position,
      player_id,
      guest_player_id,
      player_profiles (
        id,
        display_name,
        nickname,
        main_position
      ),
      guest_players (
        id,
        display_name,
        notes,
        estimated_rating,
        preferred_positions
      )
    `)
    .eq('match_id', matchId)
    .in('status', ['confirmed', 'waitlist', 'did_not_show'])
    .order('signup_time') as { data: SignupResult[] | null }

  const confirmedSignups = (signups || []).filter(s => s.status === 'confirmed')
  const noShowSignups = (signups || []).filter(s => s.status === 'did_not_show')
  const waitlistSignups = (signups || [])
    .filter(s => s.status === 'waitlist')
    .sort((a, b) => (a.waitlist_position || 0) - (b.waitlist_position || 0))

  // On a finished match, no-shows stay visible in the confirmed list so
  // admins can toggle them back; before that they simply don't exist yet.
  const confirmedListSignups = match.status === 'finished'
    ? [...confirmedSignups, ...noShowSignups].sort((a, b) => a.signup_time.localeCompare(b.signup_time))
    : confirmedSignups

  // Badges for everyone shown in the signup lists (up to 3 icons each in SignupList)
  const listedPlayerIds = Array.from(new Set(
    [...confirmedListSignups, ...waitlistSignups]
      .map(s => s.player_profiles?.id)
      .filter((id): id is string => !!id)
  ))

  const badgesByPlayer: Record<string, string[]> = {}
  if (listedPlayerIds.length > 0) {
    const { data: badgeRows } = await supabase
      .from('player_badges')
      .select('player_id, badge_type, earned_at')
      .in('player_id', listedPlayerIds)
      .order('earned_at', { ascending: false }) as {
        data: { player_id: string; badge_type: string; earned_at: string }[] | null
      }

    for (const row of badgeRows || []) {
      if (!badgesByPlayer[row.player_id]) badgesByPlayer[row.player_id] = []
      if (badgesByPlayer[row.player_id].length < 3) {
        badgesByPlayer[row.player_id].push(row.badge_type)
      }
    }
  }

  // Scores are visible to admins and captains only (RLS on player_rating_summary
  // enforces it; this just avoids a pointless query for members).
  const ratingsById: Record<string, number> = {}
  if (isAdminOrCaptain && listedPlayerIds.length > 0) {
    const { data: summaryRows } = await supabase
      .from('player_rating_summary')
      .select('player_id, overall')
      .in('player_id', listedPlayerIds) as { data: { player_id: string; overall: number }[] | null }
    for (const row of summaryRows || []) {
      ratingsById[row.player_id] = row.overall
    }
  }

  // Get all group members for rules and voting
  type MemberProfile = {
    player_profiles: {
      id: string
      display_name: string
      nickname: string | null
      main_position: string
    } | null
  }

  const { data: membershipsData } = await supabase
    .from('group_memberships')
    .select(`
      player_profiles (
        id,
        display_name,
        nickname,
        main_position
      )
    `)
    .eq('group_id', group.id)
    .eq('is_active', true) as { data: MemberProfile[] | null }

  const allGroupPlayers = (membershipsData || [])
    .filter(m => m.player_profiles !== null)
    .map(m => m.player_profiles as { id: string; display_name: string; nickname: string | null; main_position: string })

  // Players selectable in team rules: every group member plus any guest on the
  // match (confirmed or waitlisted). Guests aren't group members, so without
  // this they'd never show up in the pair-rule pickers even though the team
  // generator treats their guest_players.id like any other player id.
  const guestPlayersInMatch = [...confirmedListSignups, ...waitlistSignups]
    .filter(s => s.guest_players !== null)
    .map(s => ({ id: s.guest_players!.id, display_name: s.guest_players!.display_name, is_guest: true }))
  const seenRulePlayerIds = new Set<string>()
  const rulePlayers = [...allGroupPlayers, ...guestPlayersInMatch].filter(p => {
    if (seenRulePlayerIds.has(p.id)) return false
    seenRulePlayerIds.add(p.id)
    return true
  })

  // Players who participated (for voting) - from confirmed signups
  const matchPlayers = confirmedSignups
    .filter(s => s.player_profiles !== null)
    .map(s => s.player_profiles as { id: string; display_name: string; nickname: string | null; main_position: string })

  // Check if current user is signed up
  const currentUserSignup = (signups || []).find(
    s => s.player_profiles?.id === playerProfile.id
  )

  // Fetch teams with assignments and match events when match is finished
  type TeamWithPlayers = {
    id: string
    name: 'dark' | 'light'
    color_hex: string
    score: number
    team_assignments: {
      player_id: string | null
      guest_player_id: string | null
      position: string
      player_profiles: { id: string; display_name: string } | null
      guest_players: { id: string; display_name: string } | null
    }[]
  }

  type MatchEventResult = {
    id: string
    team_id: string
    player_id: string | null
    guest_player_id: string | null
    event_type: string
    linked_event_id: string | null
    player_profiles: { id: string; display_name: string } | null
    guest_players: { id: string; display_name: string } | null
  }

  let matchTeams: TeamWithPlayers[] = []
  let matchEvents: MatchEventResult[] = []

  if (match.status === 'finished') {
    const { data: teamsData } = await supabase
      .from('teams')
      .select(`
        id,
        name,
        color_hex,
        score,
        team_assignments (
          player_id,
          guest_player_id,
          position,
          player_profiles ( id, display_name ),
          guest_players ( id, display_name )
        )
      `)
      .eq('match_id', matchId) as { data: TeamWithPlayers[] | null }

    matchTeams = teamsData || []

    const { data: eventsData } = await supabase
      .from('match_events')
      .select(`
        id,
        team_id,
        player_id,
        guest_player_id,
        event_type,
        linked_event_id,
        player_profiles ( id, display_name ),
        guest_players ( id, display_name )
      `)
      .eq('match_id', matchId) as { data: MatchEventResult[] | null }

    matchEvents = eventsData || []
  }

  // Crowd-sourced reports (docs/match-results-consensus.md §6, §11.3).
  type ReportRow = {
    reporter_player_id: string
    dark_score: number | null
    light_score: number | null
    dark_goals_complete: boolean
    light_goals_complete: boolean
    mvp_candidate_id: string | null
    submitted_after_lock: boolean
    match_report_stats: {
      team_id: string
      player_id: string | null
      guest_player_id: string | null
      goals: number
      assists: number
    }[]
  }

  let reports: ReportRow[] = []
  let resultsWindowDays = 7

  if (match.status === 'finished') {
    const { data: settingsRow } = await supabase
      .from('notification_settings')
      .select('results_window_days')
      .eq('group_id', group.id)
      .maybeSingle() as { data: { results_window_days: number | null } | null }
    resultsWindowDays = settingsRow?.results_window_days ?? 7

    const { data: reportRows } = await supabase
      .from('match_reports')
      .select(`
        reporter_player_id,
        dark_score,
        light_score,
        dark_goals_complete,
        light_goals_complete,
        mvp_candidate_id,
        submitted_after_lock,
        match_report_stats ( team_id, player_id, guest_player_id, goals, assists )
      `)
      .eq('match_id', matchId) as { data: ReportRow[] | null }
    reports = reportRows || []
  }

  const reportWindowOpen =
    new Date().getTime() - new Date(match.date_time).getTime() < resultsWindowDays * 24 * 60 * 60 * 1000
  const viewerPlayed = currentUserSignup?.status === 'confirmed'
  const viewerCanReport = match.status === 'finished' && viewerPlayed && reportWindowOpen
  const ownReportRow = reports.find(r => r.reporter_player_id === playerProfile.id) ?? null
  const ownReport: OwnReport | null = ownReportRow
    ? {
        dark_score: ownReportRow.dark_score,
        light_score: ownReportRow.light_score,
        dark_goals_complete: ownReportRow.dark_goals_complete,
        light_goals_complete: ownReportRow.light_goals_complete,
        mvp_candidate_id: ownReportRow.mvp_candidate_id,
        submitted_after_lock: ownReportRow.submitted_after_lock,
        stats: ownReportRow.match_report_stats,
      }
    : null

  // Blind rule: a player who can still report sees nothing about the consensus
  // until their own report exists, so the first report never anchors the rest.
  const showConsensus = match.status === 'finished' && (ownReport !== null || !viewerCanReport)

  const scoredReports = reports.filter(r => r.dark_score !== null && r.light_score !== null)
  const agreement =
    ownReport && ownReport.dark_score !== null && ownReport.light_score !== null
      ? {
          same: scoredReports.filter(
            r => r.dark_score === ownReport.dark_score && r.light_score === ownReport.light_score
          ).length,
          total: scoredReports.length,
        }
      : null

  const reportTeams: ReportTeam[] = matchTeams.map(t => ({
    id: t.id,
    name: t.name,
    color_hex: t.color_hex,
    players: t.team_assignments
      .filter(a => a.player_id || a.guest_player_id)
      .map(a => ({
        key: (a.player_id || a.guest_player_id) as string,
        player_id: a.player_id,
        guest_player_id: a.guest_player_id,
        display_name: a.player_profiles?.display_name || a.guest_players?.display_name || 'Desconocido',
      })),
  }))

  const consensusEvents = matchEvents.map(e => ({
    id: e.id,
    team_id: e.team_id,
    player_id: e.player_id,
    guest_player_id: e.guest_player_id,
    event_type: e.event_type,
    player_name: e.player_profiles?.display_name || e.guest_players?.display_name || null,
  }))

  // Prepare teams data for MatchResults component
  const teamsForResults = matchTeams.map(t => ({
    id: t.id,
    name: t.name,
    color_hex: t.color_hex,
    score: t.score,
    players: t.team_assignments.map(a => ({
      id: a.player_id || a.guest_player_id || '',
      display_name: a.player_profiles?.display_name || a.guest_players?.display_name || 'Desconocido',
      is_guest: !!a.guest_player_id,
      player_id: a.player_id,
      guest_player_id: a.guest_player_id,
    })),
  }))

  const date = new Date(match.date_time)
  const isPast = date < new Date()
  const statusVariant = STATUS_VARIANTS[match.status] || STATUS_VARIANTS.draft
  const statusLabel = t(`matches.status.${match.status}`)

  return (
    <RealtimeWrapper matchId={matchId}>
      <div className="space-y-6">
        {/* Back button */}
        <Link
          href={`/groups/${groupSlug}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('common.backTo', { name: group.name })}
        </Link>

      {/* Match Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold tracking-tight">
              {t(`days.${DAY_KEYS[weekdayIndexInTimezone(date, timeZone)]}`)} {formatMatchDateNumeric(date, timeZone)}
            </h1>
            <Badge variant={statusVariant}>{statusLabel}</Badge>
          </div>

          {mvpPlayerName && showConsensus && (
            <p className="flex items-center gap-1.5 text-sm text-yellow-600 dark:text-yellow-500 mb-2">
              <Trophy className="h-4 w-4" />
              MVP: {mvpPlayerName}
            </p>
          )}

          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {formatMatchTime(date, timeZone)}
            </span>
            {match.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                {match.location}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              {confirmedSignups.length}/{match.max_players} {t('matches.playersLabel')}
            </span>
          </div>
        </div>

        {isAdminOrCaptain && (
          <div className="flex gap-2">
            <Link href={`/groups/${groupSlug}/matches/${matchId}/edit`}>
              <Button variant="outline" size="sm">
                <Edit className="mr-2 h-4 w-4" />
                {t('common.edit')}
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Notes */}
      {match.notes && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm">{match.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Match Announcement (replaces the bare share link + copy) */}
      {(match.status === 'signup_open' || match.status === 'full') && (
        <MatchAnnouncement
          groupName={group.name}
          dateTime={match.date_time}
          location={match.location}
          confirmedCount={confirmedSignups.length}
          maxPlayers={match.max_players}
          matchId={match.id}
          timeZone={timeZone}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content - Signup List */}
        <div className="lg:col-span-2 space-y-6">
          {/* Signup Actions for Current User */}
          {!isPast && match.status !== 'cancelled' && match.status !== 'finished' && (
            <SignupActions
              matchId={match.id}
              currentSignup={currentUserSignup ? {
                id: currentUserSignup.id,
                status: currentUserSignup.status,
                waitlistPosition: currentUserSignup.waitlist_position,
              } : null}
              matchStatus={match.status}
              isFull={confirmedSignups.length >= match.max_players}
            />
          )}

          {/* Confirmed Players */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Confirmados ({confirmedSignups.length}/{match.max_players})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SignupList
                signups={confirmedListSignups}
                currentPlayerId={playerProfile.id}
                emptyMessage="Nadie se inscribió todavía"
                isAdminOrCaptain={isAdminOrCaptain}
                matchStatus={match.status}
                badgesByPlayer={badgesByPlayer}
                ratingsById={ratingsById}
              />
            </CardContent>
          </Card>

          {/* Waitlist */}
          {waitlistSignups.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Lista de espera ({waitlistSignups.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SignupList
                  signups={waitlistSignups}
                  currentPlayerId={playerProfile.id}
                  showWaitlistPosition
                  emptyMessage="No hay nadie en espera"
                  isAdminOrCaptain={isAdminOrCaptain}
                  badgesByPlayer={badgesByPlayer}
                  ratingsById={ratingsById}
                />
              </CardContent>
            </Card>
          )}

          {/* Player report form (blind until the viewer has reported) */}
          {viewerCanReport && reportTeams.length > 0 && (
            <ReportForm
              matchId={match.id}
              teams={reportTeams}
              mvpCandidates={matchPlayers.filter(p => p.id !== playerProfile.id)}
              existingReport={ownReport}
              agreement={agreement}
              windowOpen={reportWindowOpen}
              resultStatus={match.result_status}
            />
          )}

          {/* Consensus / locked result - shown once the viewer can't be anchored by it */}
          {showConsensus && (
            <ResultConsensus
              teams={matchTeams.map(t => ({ id: t.id, name: t.name, color_hex: t.color_hex, score: t.score }))}
              events={consensusEvents}
              resultStatus={match.result_status}
              reportersCount={reports.filter(r => !r.submitted_after_lock).length}
              playersCount={confirmedSignups.filter(s => s.player_profiles !== null).length}
              mvpName={mvpPlayerName}
            />
          )}

          {/* Match Results Editor - shown to admins when match is finished */}
          {match.status === 'finished' && isAdminOrCaptain && teamsForResults.length > 0 && (
            <MatchResults
              matchId={match.id}
              groupId={group.id}
              teams={teamsForResults}
              existingEvents={matchEvents.map(e => ({
                id: e.id,
                team_id: e.team_id,
                player_id: e.player_id,
                guest_player_id: e.guest_player_id,
                event_type: e.event_type,
                linked_event_id: e.linked_event_id,
              }))}
              resultsFinalized={match.results_finalized}
            />
          )}

          {/* Optional teammate ratings - only for players of the match */}
          {match.status === 'finished' && viewerPlayed && matchPlayers.length > 1 && (
            <PostMatchVoting
              matchId={match.id}
              currentPlayerId={playerProfile.id}
              players={matchPlayers}
              windowOpen={reportWindowOpen}
            />
          )}
        </div>

        {/* Sidebar - Admin Actions */}
        <div className="space-y-6">
          {isAdminOrCaptain && (
            <MatchAdminActions
              matchId={match.id}
              groupSlug={groupSlug}
              currentStatus={match.status}
              hasEnoughPlayers={confirmedSignups.length >= 4}
            />
          )}

          {/* Add Guest - Admin only */}
          {isAdminOrCaptain && match.status !== 'finished' && match.status !== 'cancelled' && (
            <AddGuestForm
              matchId={match.id}
              isFull={confirmedSignups.length >= match.max_players}
              maxPlayers={match.max_players}
              confirmedCount={confirmedSignups.length}
              groupName={group.name}
              dateTime={match.date_time}
              location={match.location}
              timeZone={timeZone}
            />
          )}

          {/* Rules Manager - Admin only, before teams are created */}
          {isAdminOrCaptain && (match.status === 'signup_open' || match.status === 'full') && (
            <RulesManager
              groupId={group.id}
              matchId={match.id}
              players={rulePlayers}
            />
          )}

          {/* Quick Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Estadísticas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Inscritos</span>
                <span className="font-medium">{confirmedSignups.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">En espera</span>
                <span className="font-medium">{waitlistSignups.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Disponibles</span>
                <span className="font-medium">
                  {Math.max(0, match.max_players - confirmedSignups.length)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      </div>
    </RealtimeWrapper>
  )
}
