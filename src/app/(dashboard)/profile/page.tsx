import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Pencil } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/eyebrow'
import { PositionChip } from '@/components/ui/player-row'
import { MemberScoreStars } from '@/components/member-score'
import { SignOutButton } from '@/components/sign-out-button'
import { PageHeader } from '@/components/layout/page-header'
import { TopBarConfig } from '@/components/layout/top-bar'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'
import type { MemberScoringSettings } from '@/types/database'
import { ProfileForm } from './profile-form'
import { MeLinks } from './me-links'

// Profile (docs/ui-rework/03-screens.md §10): hero with the avatar and the
// name in the display face, "Editar" jumps to the form card. Browser: form in
// the main column, Estadísticas and Compromiso in the aside; on mobile (the
// `Yo` tab) the aside comes first, under the Avisos / Preferencias rows, and
// "Salir" closes the page.

const POSITION_CODES = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST'] as const

export default async function ProfilePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  const { data: profile } = await supabase
    .from('player_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single() as { data: {
      id: string
      display_name: string
      nickname: string | null
      preferred_positions: string[]
      main_position: string
      footedness: 'left' | 'right' | 'both'
      goalkeeper_willingness: number
      fitness_status: 'ok' | 'limited' | 'injured'
      matches_played: number
      goals: number
      assists: number
      mvp_count: number
      clean_sheets: number
    } | null }

  if (!profile) return notFound()

  const { data: userLang } = await supabase
    .from('users')
    .select('preferred_language')
    .eq('id', user.id)
    .single() as { data: { preferred_language: Language } | null }
  const language: Language = userLang?.preferred_language ?? 'es'
  const t = getT(language)

  // Member score per group (docs/member-scoring.md §5.4): the viewer always sees
  // their own score, so no visibility check here; only whether scoring is on.
  type GroupScoreRow = {
    member_score: number | null
    groups: { id: string; name: string; slug: string } | null
  }
  const { data: scoreRows } = await supabase
    .from('group_memberships')
    .select('member_score, groups (id, name, slug)')
    .eq('player_id', profile.id)
    .eq('is_active', true) as { data: GroupScoreRow[] | null }

  const groupScores = await Promise.all(
    (scoreRows || [])
      .filter((row): row is GroupScoreRow & { groups: NonNullable<GroupScoreRow['groups']> } => row.groups !== null)
      .map(async (row) => {
        const { data: settings } = await supabase
          .rpc('member_scoring_settings', { p_group_id: row.groups.id }) as { data: MemberScoringSettings | null }
        return {
          id: row.groups.id,
          name: row.groups.name,
          slug: row.groups.slug,
          enabled: !!settings?.enabled,
          score: row.member_score === null ? null : Number(row.member_score),
        }
      })
  )
  groupScores.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))

  const positions = POSITION_CODES.map((value) => ({ value, label: `${t(`positions.${value}`)} (${value})` }))
  const positionLabel = t(`positions.${profile.main_position}`)
  const subtitle = [profile.nickname, positionLabel === `positions.${profile.main_position}` ? profile.main_position : positionLabel]
    .filter(Boolean)
    .join(' · ')

  const stats = [
    { label: t('players.matchesPlayed'), value: profile.matches_played },
    { label: t('players.goals'), value: profile.goals },
    { label: t('players.assists'), value: profile.assists },
    { label: t('players.mvpCount'), value: profile.mvp_count },
    ...(profile.clean_sheets > 0 ? [{ label: t('players.cleanSheets'), value: profile.clean_sheets }] : []),
  ]

  const editLink = (
    <Button asChild variant="outline" size="sm">
      <Link href="#informacion">
        <Pencil className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        {t('common.edit')}
      </Link>
    </Button>
  )

  return (
    <div className="space-y-6">
      <TopBarConfig title={t('ui.shell.profile')} />

      <MeLinks />

      <PageHeader eyebrow={t('ui.shell.profile')} title={profile.display_name} subtitle={subtitle} actions={editLink} />

      {/* Mobile hero */}
      <header className="flex items-center gap-4 lg:hidden">
        <Avatar fallback={profile.display_name} size="lg" />
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="truncate font-display text-2xl font-extrabold leading-tight tracking-tight">{profile.display_name}</h1>
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            {profile.nickname && <span>{profile.nickname}</span>}
            <PositionChip position={profile.main_position} />
          </div>
        </div>
        {editLink}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <Card id="informacion" className="scroll-mt-16">
            <CardHeader>
              <CardTitle>{t('ui.screens.profile.infoTitle')}</CardTitle>
              <CardDescription>{t('ui.screens.profile.infoHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileForm profile={profile} positions={positions} />
            </CardContent>
          </Card>
        </div>

        <aside className="order-first min-w-0 space-y-6 lg:order-none">
          <Card>
            <CardHeader>
              <CardTitle>{t('players.stats')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="[&>div:last-child]:border-b-0">
                {stats.map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-4 border-b border-border py-2.5 text-sm">
                    <dt className="text-muted-foreground">{s.label}</dt>
                    <dd className="font-mono tabular-nums">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('memberScore.title')}</CardTitle>
              <CardDescription>{t('memberScore.profileDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              {groupScores.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('memberScore.profileEmpty')}</p>
              ) : (
                <ul className="[&>li:last-child>a]:border-b-0">
                  {groupScores.map((g) => (
                    <li key={g.id}>
                      <Link
                        href={`/groups/${g.slug}/players/${profile.id}`}
                        className="flex min-h-11 items-center gap-3 border-b border-border py-2 text-sm hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                        title={t('memberScore.viewDetail')}
                      >
                        <span className="min-w-0 flex-1 truncate">{g.name}</span>
                        {g.enabled ? (
                          <MemberScoreStars score={g.score} language={language} />
                        ) : (
                          <span className="text-xs text-muted-foreground">{t('memberScore.profileDisabled')}</span>
                        )}
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      <div className="flex flex-col items-center gap-2 pt-2 lg:hidden">
        <Eyebrow>{user.email}</Eyebrow>
        <SignOutButton />
      </div>
    </div>
  )
}
