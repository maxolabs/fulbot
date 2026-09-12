import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PublicFrame } from '@/components/layout/public-frame'
import { LinkButton } from '@/components/link-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Eyebrow } from '@/components/ui/eyebrow'
import { LanguageProvider } from '@/i18n/provider'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'
import { DEFAULT_TIMEZONE, formatMatchDateShort, formatMatchTime } from '@/lib/utils/datetime'
import { JoinGroupButton } from './join-button'

interface PageProps {
  params: Promise<{ code: string }>
}

// Invite landing (docs/ui-rework/03-screens.md §12): one dashed card, "Te
// invitaron a {group}", the member count and the next-match line, one cone
// action ("Unirme" / "Crear cuenta para unirme") and the guest path to the
// next open match as a text link.

interface PublicGroup {
  id: string
  name: string
  slug: string
  description: string | null
  default_match_day: number | null
  default_match_time: string | null
  timezone: string | null
  member_count: number
  next_match: {
    id: string
    date_time: string
    location: string | null
    status: string
    max_players: number
    confirmed_count: number
  } | null
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

function Message({ title, body, cta }: { title: string; body: string; cta: { href: string; label: string } }) {
  return (
    <PublicFrame width="sm" className="justify-center">
      <div className="space-y-4 text-center">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-balance">{title}</h1>
        <p className="text-sm text-muted-foreground text-pretty">{body}</p>
        <div className="pt-2">
          <LinkButton href={cta.href} variant="outline">
            {cta.label}
          </LinkButton>
        </div>
      </div>
    </PublicFrame>
  )
}

export default async function InvitePage({ params }: PageProps) {
  const { code } = await params
  const supabase = await createClient()
  const cookieStore = await cookies()
  const langCookie = cookieStore.get('fulbot_lang')?.value
  const language: Language = langCookie === 'en' ? 'en' : 'es'
  const t = getT(language)

  const { data: { user } } = await supabase.auth.getUser()

  // Public view of the group (works for anonymous visitors, includes the next open match)
  const { data: groupData } = await supabase.rpc('get_public_group_by_invite', { p_invite_code: code })
  const group = (groupData as PublicGroup | null) ?? null

  if (!group) {
    return (
      <Message
        title={t('ui.screens.invite.invalidTitle')}
        body={t('ui.screens.invite.invalidBody')}
        cta={{ href: '/', label: t('ui.screens.publicMatch.goHome') }}
      />
    )
  }

  const tz = group.timezone || DEFAULT_TIMEZONE
  const scheduleLine = group.default_match_day !== null
    ? `${t(`days.${DAY_KEYS[group.default_match_day]}`)}${group.default_match_time ? ` ${group.default_match_time.slice(0, 5)}` : ''}`
    : null
  const match = group.next_match
  const nextMatchLine = match
    ? `${formatMatchDateShort(match.date_time, tz)} · ${formatMatchTime(match.date_time, tz)}${match.location ? ` · ${match.location}` : ''}`
    : null
  const isFull = match ? match.confirmed_count >= match.max_players : false

  let playerId: string | null = null
  let wasInactive = false

  if (user) {
    const { data: playerProfile } = await supabase
      .from('player_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single() as { data: { id: string } | null }

    if (!playerProfile) {
      return (
        <Message
          title={t('ui.screens.invite.noProfileTitle')}
          body={t('ui.screens.invite.noProfileBody')}
          cta={{ href: '/groups', label: t('ui.shell.myGroups') }}
        />
      )
    }
    playerId = playerProfile.id

    const { data: existingMembership } = await supabase
      .from('group_memberships')
      .select('id, is_active')
      .eq('group_id', group.id)
      .eq('player_id', playerProfile.id)
      .single() as { data: { id: string; is_active: boolean } | null }

    if (existingMembership?.is_active) {
      redirect(`/groups/${group.slug}`)
    }
    wasInactive = existingMembership !== null && !existingMembership.is_active
  }

  return (
    <LanguageProvider language={language}>
      <PublicFrame width="sm" className="justify-center">
        <Card className="w-full">
          <CardHeader>
            <Eyebrow>{t('ui.screens.invite.eyebrow')}</Eyebrow>
            <CardTitle className="text-2xl">{t('ui.screens.invite.title', { group: group.name })}</CardTitle>
            {group.description && <CardDescription className="text-pretty">{group.description}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-5">
            <dl className="[&>div:last-child]:border-b-0">
              <div className="flex items-center justify-between gap-4 border-b border-border py-2 text-sm">
                <dt className="text-muted-foreground">{t('groups.members')}</dt>
                <dd className="font-mono tabular-nums">{group.member_count}</dd>
              </div>
              {scheduleLine && (
                <div className="flex items-center justify-between gap-4 border-b border-border py-2 text-sm">
                  <dt className="text-muted-foreground">{t('ui.screens.invite.usually')}</dt>
                  <dd className="font-mono tabular-nums">{scheduleLine}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4 border-b border-border py-2 text-sm">
                <dt className="shrink-0 text-muted-foreground">{t('groups.nextMatch')}</dt>
                <dd className="text-right font-mono text-xs tabular-nums">
                  {nextMatchLine ? (
                    <>
                      <span className="block">{nextMatchLine}</span>
                      <span className="block text-muted-foreground">
                        {match!.confirmed_count} / {match!.max_players}
                        {isFull && ` · ${t('ui.screens.invite.waitlist')}`}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{t('groups.noUpcomingMatch')}</span>
                  )}
                </dd>
              </div>
            </dl>

            {user && playerId ? (
              <>
                <JoinGroupButton
                  groupId={group.id}
                  groupSlug={group.slug}
                  playerId={playerId}
                  wasInactive={wasInactive}
                />
                <p className="text-center text-xs text-muted-foreground">{t('ui.screens.invite.joinHint')}</p>
              </>
            ) : (
              <div className="space-y-3">
                <LinkButton href={`/register?redirect=/invite/${code}`} size="xl" className="w-full">
                  {t('ui.screens.invite.createAccountToJoin')}
                </LinkButton>
                <p className="text-center text-sm text-muted-foreground">
                  {t('auth.hasAccount')}{' '}
                  <Link
                    href={`/login?redirect=/invite/${code}`}
                    className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
                  >
                    {t('auth.loginCta')}
                  </Link>
                </p>
              </div>
            )}

            {match && (
              <div className="space-y-1 border-t border-border pt-4 text-center">
                <LinkButton href={`/m/${match.id}`} variant="link" className="text-foreground">
                  {t('ui.screens.invite.guestPath')}
                </LinkButton>
                <p className="text-xs text-muted-foreground text-pretty">{t('ui.screens.invite.guestHint')}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </PublicFrame>
    </LanguageProvider>
  )
}
