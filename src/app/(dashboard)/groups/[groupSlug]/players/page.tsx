import { notFound } from 'next/navigation'
import { ClipboardList, Star } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/eyebrow'
import { PlayerRow, PositionChip } from '@/components/ui/player-row'
import { MemberScoreStars } from '@/components/member-score'
import { PageHeader } from '@/components/layout/page-header'
import { TopBarConfig } from '@/components/layout/top-bar'
import { overallOf, summariesById, type RatingSummary } from '@/lib/ratings'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'
import type { MemberScoringSettings } from '@/types/database'
import { PlayersSortControl, type PlayersSort } from './players-sort'

interface PageProps {
  params: Promise<{ groupSlug: string }>
  searchParams: Promise<{ sort?: string }>
}

// Players list (docs/ui-rework/03-screens.md §7): one column of rows. Each
// row is the whole tap target: avatar, name, positions as mono chips, matches
// played and the member score stars where the viewer may see them.

export default async function GroupPlayersPage({ params, searchParams }: PageProps) {
  const { groupSlug } = await params
  const { sort } = await searchParams
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
    .select('id, name, slug')
    .eq('slug', groupSlug)
    .single() as { data: { id: string; name: string; slug: string } | null }

  if (!group) return notFound()

  const { data: membership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', group.id)
    .eq('player_id', currentPlayer.id)
    .eq('is_active', true)
    .single() as { data: { role: 'admin' | 'captain' | 'member' } | null }

  if (!membership) return notFound()

  const isAdmin = membership.role === 'admin'
  const isAdminOrCaptain = isAdmin || membership.role === 'captain'

  const { data: userData } = await supabase
    .from('users')
    .select('preferred_language')
    .eq('id', user.id)
    .single() as { data: { preferred_language: Language } | null }
  const language: Language = userData?.preferred_language ?? 'es'
  const t = getT(language)

  // Member score column (docs/member-scoring.md §5.4): everyone's score when the
  // group chose 'group' visibility or the viewer is admin/captain; otherwise a
  // plain member only sees their own row. Nothing at all while scoring is off.
  const { data: scoringSettings } = await supabase
    .rpc('member_scoring_settings', { p_group_id: group.id }) as { data: MemberScoringSettings | null }
  const scoringEnabled = !!scoringSettings?.enabled
  const canSeeAllScores = scoringEnabled && (scoringSettings?.visibility === 'group' || isAdminOrCaptain)
  const canSeeScoreOf = (playerId: string) => scoringEnabled && (canSeeAllScores || playerId === currentPlayer.id)
  const sortByScore = canSeeAllScores && sort === 'score'
  const currentSort: PlayersSort = sortByScore ? 'score' : 'matches'

  type MembershipWithProfile = {
    id: string
    role: string
    member_score: number | null
    player_profiles: {
      id: string
      display_name: string
      nickname: string | null
      main_position: string
      preferred_positions: string[]
      matches_played: number
      fitness_status: string
    } | null
  }

  const { data: memberships } = await supabase
    .from('group_memberships')
    .select(`
      id,
      role,
      member_score,
      player_profiles (
        id,
        display_name,
        nickname,
        main_position,
        preferred_positions,
        matches_played,
        fitness_status
      )
    `)
    .eq('group_id', group.id)
    .eq('is_active', true) as { data: MembershipWithProfile[] | null }

  const players = (memberships || [])
    .filter((m) => m.player_profiles !== null)
    .map((m) => ({
      role: m.role as 'admin' | 'captain' | 'member',
      memberScore: m.member_score === null ? null : Number(m.member_score),
      ...(m.player_profiles as NonNullable<MembershipWithProfile['player_profiles']>),
    }))
    .sort((a, b) => {
      // ?sort=score: member score (desc), newcomers (NULL) last, then the default order
      if (sortByScore && a.memberScore !== b.memberScore) {
        if (a.memberScore === null) return 1
        if (b.memberScore === null) return -1
        return b.memberScore - a.memberScore
      }
      if (b.matches_played !== a.matches_played) {
        return b.matches_played - a.matches_played
      }
      return a.display_name.localeCompare(b.display_name)
    })

  // Skill ratings are visible to admins and captains only (RLS enforces it on
  // player_rating_summary; this avoids a pointless query for members).
  let summaries = summariesById(null)
  if (isAdminOrCaptain && players.length > 0) {
    const { data: summaryRows } = await supabase
      .from('player_rating_summary')
      .select('player_id, goalkeeping, defense, attack, physical, overall, tags, peer_votes, matches_rated')
      .in('player_id', players.map((p) => p.id)) as { data: RatingSummary[] | null }
    summaries = summariesById(summaryRows)
  }

  const basePath = `/groups/${groupSlug}/players`
  const subtitle = t('ui.screens.players.count', { n: players.length, group: group.name })

  const links = (
    <>
      <Button asChild variant="outline" size="sm">
        <Link href={`/groups/${groupSlug}/rate`}>
          <Star className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          {t('ui.screens.players.rateCta')}
        </Link>
      </Button>
      {isAdmin && (
        <Button asChild variant="outline" size="sm">
          <Link href={`/groups/${groupSlug}/rate?mode=baseline`}>
            <ClipboardList className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            {t('ui.screens.players.baselineCta')}
          </Link>
        </Button>
      )}
    </>
  )

  const sortControl = canSeeAllScores ? (
    <PlayersSortControl value={currentSort} basePath={basePath} />
  ) : null

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <TopBarConfig title={t('ui.shell.players')} back={`/groups/${groupSlug}`} />

      <PageHeader
        eyebrow={group.name}
        title={t('ui.shell.players')}
        subtitle={subtitle}
        actions={
          <>
            {sortControl}
            {links}
          </>
        }
      />

      {/* Mobile hero: the top bar carries the title, this row carries the meta and the sort. */}
      <div className="space-y-3 lg:hidden">
        <p className="text-sm text-muted-foreground">{subtitle}</p>
        <div className="flex flex-wrap items-center gap-2">
          {sortControl}
          {links}
        </div>
      </div>

      {players.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('ui.screens.players.empty')}</p>
      ) : (
        <ul className="[&>li:last-child>*]:border-b-0">
          {players.map((player) => {
            const positions = Array.from(
              new Set([player.main_position, ...(player.preferred_positions || [])].filter(Boolean))
            ).slice(0, 3)
            const summary = summaries.get(player.id)
            const showSkill = isAdminOrCaptain && !!summary && (summary.peer_votes > 0 || summary.matches_rated > 0)

            return (
              <li key={player.id}>
                <PlayerRow
                  name={player.display_name}
                  nickname={player.nickname}
                  href={`${basePath}/${player.id}`}
                  language={language}
                  description={player.fitness_status !== 'ok' ? (
                    <Badge className="sm:hidden" variant={player.fitness_status === 'injured' ? 'destructive' : 'warning'}>
                      {player.fitness_status === 'injured' ? t('players.injured') : t('players.limited')}
                    </Badge>
                  ) : undefined}
                  trailing={
                    <>
                      {player.role !== 'member' && (
                        <Badge variant="outline" className="hidden sm:inline-flex">
                          {player.role === 'admin' ? t('groups.roles.admin') : t('groups.roles.captain')}
                        </Badge>
                      )}
                      {player.fitness_status !== 'ok' && (
                        <Badge className="hidden sm:inline-flex" variant={player.fitness_status === 'injured' ? 'destructive' : 'warning'}>
                          {player.fitness_status === 'injured' ? t('players.injured') : t('players.limited')}
                        </Badge>
                      )}
                      <span className="hidden items-center gap-1 sm:flex">
                        {positions.map((pos) => (
                          <PositionChip key={pos} position={pos} />
                        ))}
                      </span>
                      <PositionChip position={player.main_position} className="sm:hidden" />
                      {/* Matches played at every width (03-screens §7); the skill
                          number is the one that yields room on phones. */}
                      <span
                        className="w-12 text-right font-mono text-xs tabular-nums text-muted-foreground"
                        title={t('players.matchesPlayed')}
                      >
                        {player.matches_played} {t('ui.screens.players.matchesShort')}
                      </span>
                      {showSkill && (
                        <span
                          className="hidden w-8 text-right font-mono text-xs tabular-nums text-foreground sm:inline"
                          title={t('players.rating')}
                        >
                          {overallOf(summary).toFixed(1)}
                        </span>
                      )}
                      {canSeeScoreOf(player.id) && (
                        <MemberScoreStars score={player.memberScore} language={language} className="w-14 justify-end" />
                      )}
                    </>
                  }
                />
              </li>
            )
          })}
        </ul>
      )}

      {isAdminOrCaptain && (
        <Eyebrow>{t('ui.screens.players.legend')}</Eyebrow>
      )}
    </div>
  )
}
