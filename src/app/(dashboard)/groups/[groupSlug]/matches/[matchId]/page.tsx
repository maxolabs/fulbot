import { notFound } from 'next/navigation'
import { Trophy } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { Eyebrow } from '@/components/ui/eyebrow'
import { SpotsMeter } from '@/components/ui/spots-meter'
import { PageHeader } from '@/components/layout/page-header'
import { MatchAnnouncement } from './match-announcement'
import { SignupList } from './signup-list'
import { MatchActionBar, SignupActions, SignupDetail, SignupProvider } from './signup-actions'
import { SignupPolicyNotice } from '@/components/signup-policy-notice'
import { MatchAdminActions } from './match-admin-actions'
import { AddGuestForm } from './add-guest-form'
import { PostMatchVoting } from './post-match-voting'
import { RulesManager } from './rules-manager'
import { RealtimeWrapper } from './realtime-wrapper'
import { MatchResults } from './match-results'
import { ReportForm, type OwnReport, type ReportTeam } from './report-form'
import { ResultConsensus } from './result-consensus'
import type { MatchResultStatus, WaitlistReason } from '@/types/database'
import { MatchReportsTable } from './match-reports-table'
import { ConductCheck } from './conduct-check'
import { ManagePopover, MatchTopBar, ShareMatchButton } from './match-manage'
import { MatchStatusBadge, ScoreText } from '../match-row'
import { formatHeroDate, formatRowDate } from '../match-format'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'
import { DEFAULT_TIMEZONE, formatMatchTime } from '@/lib/utils/datetime'

interface PageProps {
  params: Promise<{ groupSlug: string; matchId: string }>
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

  const language: Language = userData?.preferred_language ?? 'es'
  const t = getT(language)

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

  // Current MVP (if voted) - shown with a trophy in the hero
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
    waitlist_reason: WaitlistReason | null
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
      waitlist_reason,
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

  const listedPlayerIds = Array.from(new Set(
    [...confirmedListSignups, ...waitlistSignups]
      .map(s => s.player_profiles?.id)
      .filter((id): id is string => !!id)
  ))

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
  // Member scoring on for this group: the report form shows "+1 compromiso"
  // after a usable report (docs/member-scoring.md §5.5).
  let scoringEnabled = false

  if (match.status === 'finished') {
    const { data: scoringSettings } = await supabase
      .rpc('member_scoring_settings', { p_group_id: group.id }) as { data: { enabled?: boolean } | null }
    scoringEnabled = !!scoringSettings?.enabled

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
  // A locked result is final and visible to everyone (a late report can't be
  // anchored into changing it), as is anything after the window closed.
  const resultLocked = match.result_status === 'locked'
  const showConsensus =
    match.status === 'finished' && (ownReport !== null || !viewerCanReport || resultLocked)
  // Admin/captain tools follow the same rule: an admin who played reports
  // first like everyone else; one who did not play sees them right away.
  const showAdminTools = isAdminOrCaptain && showConsensus

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

  // Whether teams exist (only fetched above for finished matches): the admin
  // actions explain that a match without teams can't be finished (§5.1), and
  // the action bar offers "Armar equipos" while they are missing.
  let hasTeams = matchTeams.length > 0
  if (!hasTeams && isAdminOrCaptain && match.status !== 'finished') {
    const { count } = await supabase
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('match_id', matchId)
    hasTeams = (count ?? 0) > 0
  }

  // Result consensus/lock columns (00019). `select('*')` already returns them; the
  // narrow cast above predates them, so read them through a local cast here.
  const resultMeta = match as unknown as {
    result_status?: MatchResultStatus
    result_locked_by?: string | null
    result_locked_at?: string | null
  }

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
  const isFinished = match.status === 'finished'
  const isLive = !isPast && match.status !== 'cancelled' && !isFinished
  const isFull = confirmedSignups.length >= match.max_players
  const statusLabel = t(`matches.status.${match.status}`)
  const heroDate = formatHeroDate(t, match.date_time, timeZone)
  const groupHref = `/groups/${groupSlug}`
  const matchHref = `${groupHref}/matches/${matchId}`
  const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/m/${matchId}`

  // Finished: the score replaces the count once the viewer may see it (blind rule).
  const darkTeam = matchTeams.find(tm => tm.name === 'dark')
  const lightTeam = matchTeams.find(tm => tm.name === 'light')
  const heroScore = isFinished && showConsensus && darkTeam && lightTeam ? { dark: darkTeam.score, light: lightTeam.score } : null

  const countLabel = t('ui.matchScreens.match.players', { confirmed: confirmedSignups.length, max: match.max_players })

  // Action bar (mobile): one primary. Admin extra while the match is full or
  // closed without teams; "Reportar resultado" after the match until reported.
  const buildTeamsHref =
    isLive && isAdminOrCaptain && !hasTeams && confirmedSignups.length >= 4 &&
    (match.status === 'full' || match.status === 'signup_closed')
      ? `${matchHref}/teams`
      : undefined
  const reportHref = isFinished && viewerCanReport && !ownReport && reportTeams.length > 0 ? '#reportar' : undefined
  const showActionBar = (isLive && match.status !== 'draft') || !!reportHref

  const showAnnouncement = match.status === 'signup_open' || match.status === 'full'
  const showAddGuest = isAdminOrCaptain && !isFinished && match.status !== 'cancelled'
  const showRules = isAdminOrCaptain && (match.status === 'signup_open' || match.status === 'full')

  // MatchAdminActions renders nothing once the match is finished; without
  // actions there is no "Gestionar" (the sheet would be empty too).
  const hasAdminActions = isAdminOrCaptain && !isFinished

  const adminActions = hasAdminActions ? (
    <MatchAdminActions
      hasTeams={hasTeams}
      matchId={match.id}
      groupSlug={groupSlug}
      currentStatus={match.status}
      hasEnoughPlayers={confirmedSignups.length >= 4}
    />
  ) : null

  const announcement = showAnnouncement ? (
    <MatchAnnouncement
      variant="bare"
      groupName={group.name}
      dateTime={match.date_time}
      location={match.location}
      confirmedCount={confirmedSignups.length}
      maxPlayers={match.max_players}
      matchId={match.id}
      timeZone={timeZone}
    />
  ) : null

  const addGuest = showAddGuest ? (
    <AddGuestForm
      matchId={match.id}
      isFull={isFull}
      maxPlayers={match.max_players}
      confirmedCount={confirmedSignups.length}
      groupName={group.name}
      dateTime={match.date_time}
      location={match.location}
      timeZone={timeZone}
    />
  ) : null

  const rules = showRules ? (
    <RulesManager groupId={group.id} matchId={match.id} players={rulePlayers} />
  ) : null

  // Mobile sheet: admin actions + announcement + add guest + rules (03-screens §3)
  const sheetContent = hasAdminActions ? (
    <>
      {adminActions}
      {announcement && <div className="border-t border-border pt-6">{announcement}</div>}
      {addGuest && <div className="border-t border-border pt-6">{addGuest}</div>}
      {rules && <div className="border-t border-border pt-6">{rules}</div>}
    </>
  ) : undefined

  const statusBadge = <MatchStatusBadge status={match.status} label={statusLabel} />

  return (
    <RealtimeWrapper matchId={matchId}>
      <SignupProvider
        matchId={match.id}
        currentSignup={currentUserSignup ? {
          id: currentUserSignup.id,
          status: currentUserSignup.status,
          waitlistPosition: currentUserSignup.waitlist_position,
          waitlistReason: currentUserSignup.waitlist_reason,
        } : null}
        matchStatus={match.status}
        isFull={isFull}
      >
        <div className={showActionBar ? 'space-y-6 pb-32 lg:pb-0' : 'space-y-6'}>
          <MatchTopBar
            groupName={group.name}
            groupHref={groupHref}
            shareUrl={shareUrl}
            manageContent={sheetContent}
          />

          <PageHeader
            title={heroDate}
            subtitle={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {match.location && <span>{match.location}</span>}
                {statusBadge}
                {heroScore ? (
                  <ScoreText dark={heroScore.dark} light={heroScore.light} className="text-base text-foreground" />
                ) : (
                  <span className="font-mono text-xs tabular-nums">{countLabel}</span>
                )}
                {mvpPlayerName && showConsensus && (
                  <span className="flex items-center gap-1">
                    <Trophy className="h-4 w-4 text-primary" strokeWidth={1.75} aria-hidden="true" />
                    {t('ui.matchScreens.dashboard.mvp', { name: mvpPlayerName })}
                  </span>
                )}
              </span>
            }
            actions={
              <>
                <ShareMatchButton shareUrl={shareUrl} />
                {adminActions && <ManagePopover>{adminActions}</ManagePopover>}
              </>
            }
          />

          {/* Mobile hero */}
          <div className="space-y-2 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow>{isLive ? t('ui.matchScreens.match.eyebrowNext') : t('ui.shell.tabMatch')}</Eyebrow>
              {statusBadge}
            </div>
            <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight text-balance">
              {formatRowDate(t, match.date_time, timeZone)}
            </h1>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono tabular-nums">{formatMatchTime(match.date_time, timeZone)}</span>
              {match.location && ` · ${match.location}`}
            </p>
            {heroScore && (
              <p className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>{t('ui.matchScreens.dashboard.dark')}</span>
                <ScoreText dark={heroScore.dark} light={heroScore.light} className="text-3xl text-foreground" />
                <span>{t('ui.matchScreens.dashboard.light')}</span>
              </p>
            )}
            {mvpPlayerName && showConsensus && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Trophy className="h-4 w-4 text-primary" strokeWidth={1.75} aria-hidden="true" />
                {t('ui.matchScreens.dashboard.mvp', { name: mvpPlayerName })}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* Main column */}
            <div className="min-w-0 space-y-6">
              {/* Notes */}
              {match.notes && (
                <p className="text-sm text-pretty">
                  <span className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">{t('ui.matchScreens.match.notes')}</span>{' '}
                  {match.notes}
                </p>
              )}

              {/* Member scoring policy notice (docs/member-scoring.md §6): renders nothing unless it applies */}
              {!isPast && match.status === 'signup_open' && !currentUserSignup && (
                <SignupPolicyNotice
                  matchId={match.id}
                  groupId={group.id}
                  playerId={playerProfile.id}
                  timeZone={timeZone}
                />
              )}

              {/* Signup action, inline in the browser; the action bar covers phones */}
              {isLive && <SignupActions />}

              {!isFinished && match.status !== 'cancelled' && (
                <div className="space-y-2">
                  <SpotsMeter
                    confirmed={confirmedSignups.length}
                    max={match.max_players}
                    waitlist={waitlistSignups.length}
                    language={language}
                  />
                  {isLive && <SignupDetail />}
                </div>
              )}

              {/* Confirmados */}
              <section
                id="confirmados"
                className="lg:rounded-md lg:border lg:border-dashed lg:border-border lg:bg-card lg:p-5"
                aria-labelledby="confirmados-title"
              >
                <div className="flex items-center justify-between pb-2">
                  <Eyebrow as="h2" id="confirmados-title">
                    {t('ui.matchScreens.match.confirmed')}
                  </Eyebrow>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {confirmedSignups.length} / {match.max_players}
                  </span>
                </div>
                <SignupList
                  signups={confirmedListSignups}
                  currentPlayerId={playerProfile.id}
                  emptyMessage={t('ui.matchScreens.match.nobodyYet')}
                  isAdminOrCaptain={isAdminOrCaptain}
                  matchStatus={match.status}
                  ratingsById={ratingsById}
                />
              </section>

              {/* Lista de espera */}
              {waitlistSignups.length > 0 && (
                <section
                  className="lg:rounded-md lg:border lg:border-dashed lg:border-border lg:bg-card lg:p-5"
                  aria-labelledby="waitlist-title"
                >
                  <div className="flex items-center justify-between pb-2">
                    <Eyebrow as="h2" id="waitlist-title">
                      {t('ui.matchScreens.match.waitlist')}
                    </Eyebrow>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{waitlistSignups.length}</span>
                  </div>
                  <SignupList
                    signups={waitlistSignups}
                    currentPlayerId={playerProfile.id}
                    showWaitlistPosition
                    emptyMessage={t('ui.matchScreens.match.waitlistEmpty')}
                    isAdminOrCaptain={isAdminOrCaptain}
                    ratingsById={ratingsById}
                  />
                </section>
              )}

              {/* Player report form (blind until the viewer has reported) */}
              {isFinished && viewerPlayed && reportTeams.length > 0 && (
                <ReportForm
                  matchId={match.id}
                  teams={reportTeams}
                  mvpCandidates={matchPlayers.filter(p => p.id !== playerProfile.id)}
                  existingReport={ownReport}
                  agreement={agreement}
                  windowOpen={reportWindowOpen}
                  resultStatus={match.result_status}
                  scoringEnabled={scoringEnabled}
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
              {isFinished && showAdminTools && teamsForResults.length > 0 && (
                <MatchResults
                  matchId={match.id}
                  teams={teamsForResults}
                  existingEvents={matchEvents.map(e => ({
                    id: e.id,
                    team_id: e.team_id,
                    player_id: e.player_id,
                    guest_player_id: e.guest_player_id,
                    event_type: e.event_type,
                    linked_event_id: e.linked_event_id,
                  }))}
                  resultStatus={resultMeta.result_status ?? 'pending'}
                  lockedBy={resultMeta.result_locked_by ?? null}
                  lockedAt={resultMeta.result_locked_at ?? null}
                  mvpPlayerId={match.mvp_player_id}
                  mvpCandidates={matchPlayers.map(p => ({ id: p.id, display_name: p.display_name }))}
                />
              )}

              {/* Player reports (who said what) - admins/captains only */}
              {isFinished && showAdminTools && teamsForResults.length > 0 && (
                <MatchReportsTable
                  matchId={match.id}
                  resultStatus={resultMeta.result_status ?? 'pending'}
                  teams={teamsForResults.map(t => ({ id: t.id, name: t.name, color_hex: t.color_hex, score: t.score }))}
                  people={[
                    ...matchPlayers.map(p => ({ id: p.id, display_name: p.display_name })),
                    ...teamsForResults.flatMap(t => t.players.map(p => ({ id: p.id, display_name: p.display_name }))),
                  ]}
                  confirmedCount={matchPlayers.length}
                />
              )}

              {/* Conduct check (docs/member-scoring.md §4.2) - admins, and captains when allowed; hidden when scoring is off */}
              {isFinished && isAdminOrCaptain && (
                <ConductCheck
                  matchId={match.id}
                  groupId={group.id}
                  role={membership.role as 'admin' | 'captain' | 'member'}
                />
              )}

              {/* Optional teammate ratings - only for players of the match */}
              {isFinished && viewerPlayed && matchPlayers.length > 1 && (
                <PostMatchVoting
                  matchId={match.id}
                  currentPlayerId={playerProfile.id}
                  players={matchPlayers}
                  windowOpen={reportWindowOpen}
                />
              )}
            </div>

            {/* Aside (browser only; on phones this content lives in the admin sheet) */}
            <aside className="hidden min-w-0 space-y-6 lg:block">
              {showAnnouncement && (
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

              {addGuest && <div id="invitado">{addGuest}</div>}

              {rules}

              {/* Quick Stats */}
              <Card variant="solid">
                <CardContent className="space-y-2 p-4 lg:p-5">
                  <Eyebrow as="h2">{t('ui.matchScreens.match.stats')}</Eyebrow>
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">{t('ui.matchScreens.match.statsSigned')}</dt>
                      <dd className="font-mono tabular-nums">{confirmedSignups.length}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">{t('ui.matchScreens.match.statsWaiting')}</dt>
                      <dd className="font-mono tabular-nums">{waitlistSignups.length}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">{t('ui.matchScreens.match.statsAvailable')}</dt>
                      <dd className="font-mono tabular-nums">{Math.max(0, match.max_players - confirmedSignups.length)}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </aside>
          </div>

          {showActionBar && (
            <MatchActionBar
              buildTeamsHref={buildTeamsHref}
              buildTeamsLabel={t('ui.matchScreens.dashboard.buildTeams')}
              reportHref={reportHref}
              reportLabel={t('ui.matchScreens.match.reportResult')}
            />
          )}
        </div>
      </SignupProvider>
    </RealtimeWrapper>
  )
}
