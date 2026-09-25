import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'
import Link from 'next/link'
import { PublicFrame } from '@/components/layout/public-frame'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Eyebrow } from '@/components/ui/eyebrow'
import { PlayerRow } from '@/components/ui/player-row'
import { SpotsMeter } from '@/components/ui/spots-meter'
import { PublicMatchActions } from './public-match-actions'
import { SignupPolicyNotice } from '@/components/signup-policy-notice'
import { DEFAULT_TIMEZONE, formatMatchDate, formatMatchTime } from '@/lib/utils/datetime'
import { formatRowDate } from '@/app/(dashboard)/groups/[groupSlug]/matches/match-format'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'

interface PageProps {
  params: Promise<{ matchId: string }>
}

// Public match page (docs/ui-rework/03-screens.md §12): the first screen a
// guest sees from WhatsApp. Hero (group eyebrow, date in display, location,
// SpotsMeter), the confirmed names, the guest form, and an action bar pinned
// to the bottom of the viewport at every width.

interface PublicMatch {
  id: string
  group_name: string
  group_slug: string
  date_time: string
  location: string | null
  notes: string | null
  status: string
  max_players: number
  confirmed_count: number
  waitlist_count: number
  confirmed_names: string[]
  waitlist_names: string[]
  timezone: string | null
}

function Message({
  eyebrow,
  title,
  body,
  cta,
}: {
  eyebrow?: string
  title: string
  body: string
  cta?: { href: string; label: string }
}) {
  return (
    <PublicFrame className="justify-center">
      <div className="space-y-4 text-center">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-balance">{title}</h1>
        <p className="text-sm text-muted-foreground text-pretty">{body}</p>
        {cta && (
          <div className="pt-2">
            <Button asChild variant="outline">
              <Link href={cta.href}>{cta.label}</Link>
            </Button>
          </div>
        )}
      </div>
    </PublicFrame>
  )
}

export default async function PublicMatchPage({ params }: PageProps) {
  const { matchId } = await params
  const supabase = await createClient()
  const cookieStore = await cookies()
  const langCookie = cookieStore.get('fulbot_lang')?.value
  const language: Language = langCookie === 'en' ? 'en' : 'es'
  const t = getT(language)

  // get_public_match works for anonymous visitors too -- it's the only way
  // this page reads match data, so RLS never needs to open matches to anon.
  const args: Database['public']['Functions']['get_public_match']['Args'] = {
    p_match_id: matchId,
  }
  const { data: match } = (await supabase.rpc('get_public_match', args)) as {
    data: PublicMatch | null
  }

  if (!match || !match.id) {
    return (
      <Message
        title={t('ui.screens.publicMatch.notFoundTitle')}
        body={t('ui.screens.publicMatch.notFoundBody')}
        cta={{ href: '/', label: t('ui.screens.publicMatch.goHome') }}
      />
    )
  }

  const date = new Date(match.date_time)
  const timeZone = match.timezone || DEFAULT_TIMEZONE
  const isPast = date < new Date()
  const isSignupPhase = ['signup_open', 'full', 'signup_closed'].includes(match.status)

  const { data: { user } } = await supabase.auth.getUser()

  if (!isSignupPhase) {
    const statusKey = ['draft', 'teams_created', 'finished', 'cancelled'].includes(match.status)
      ? `ui.screens.publicMatch.status.${match.status}`
      : 'ui.screens.publicMatch.status.unavailable'
    return (
      <Message
        eyebrow={match.group_name}
        title={formatMatchDate(date, timeZone)}
        body={t(statusKey)}
        cta={user ? { href: `/groups/${match.group_slug}/matches/${matchId}`, label: t('ui.screens.publicMatch.viewMatch') } : undefined}
      />
    )
  }

  // Resolve the logged-in visitor's relationship to the group (member vs not)
  let isMember = false
  let memberSignup: { id: string; status: 'confirmed' | 'waitlist'; waitlistPosition: number | null } | null = null
  let inviteCode: string | null = null
  let groupId: string | null = null
  let profileId: string | null = null

  if (user) {
    const { data: profile } = await supabase
      .from('player_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single() as { data: { id: string } | null }

    if (profile) {
      profileId = profile.id
      const { data: groupRow } = await supabase
        .from('groups')
        .select('id, invite_code')
        .eq('slug', match.group_slug)
        .single() as { data: { id: string; invite_code: string } | null }

      if (groupRow) {
        inviteCode = groupRow.invite_code
        groupId = groupRow.id

        const { data: membership } = await supabase
          .from('group_memberships')
          .select('id')
          .eq('group_id', groupRow.id)
          .eq('player_id', profile.id)
          .eq('is_active', true)
          .single() as { data: { id: string } | null }

        isMember = !!membership

        if (isMember) {
          const { data: signup } = await supabase
            .from('match_signups')
            .select('id, status, waitlist_position')
            .eq('match_id', matchId)
            .eq('player_id', profile.id)
            .in('status', ['confirmed', 'waitlist'])
            .single() as { data: { id: string; status: string; waitlist_position: number | null } | null }

          memberSignup = signup
            ? {
                id: signup.id,
                status: signup.status as 'confirmed' | 'waitlist',
                waitlistPosition: signup.waitlist_position,
              }
            : null
        }
      }
    }
  }

  // Resolve the anonymous/guest identity from the httpOnly cookie, if any.
  // guest_players/match_signups aren't readable by anon, so this lookup goes
  // through the service-role client -- never trusting anything besides the
  // opaque token itself.
  let guestSignup: { status: 'confirmed' | 'waitlist'; waitlistPosition: number | null } | null = null

  if (!isMember) {
    const guestToken = cookieStore.get(`fulbot_guest_${matchId}`)?.value

    if (guestToken) {
      try {
        const admin = createAdminClient()
        const { data: guestRow } = await admin
          .from('guest_players')
          .select('id')
          .eq('self_signup_token', guestToken)
          .maybeSingle() as { data: { id: string } | null }

        if (guestRow) {
          const { data: signupRow } = await admin
            .from('match_signups')
            .select('status, waitlist_position')
            .eq('match_id', matchId)
            .eq('guest_player_id', guestRow.id)
            .in('status', ['confirmed', 'waitlist'])
            .maybeSingle() as { data: { status: string; waitlist_position: number | null } | null }

          if (signupRow) {
            guestSignup = {
              status: signupRow.status as 'confirmed' | 'waitlist',
              waitlistPosition: signupRow.waitlist_position,
            }
          }
        }
      } catch (err) {
        console.error('Error resolving guest signup:', err)
      }
    }
  }

  const statusBadge =
    match.status === 'full' ? (
      <Badge variant="success">{t('ui.spots.full')}</Badge>
    ) : match.status === 'signup_closed' ? (
      <Badge variant="outline">{t('ui.screens.publicMatch.signupClosed')}</Badge>
    ) : (
      <Badge variant="secondary">{t('ui.screens.publicMatch.signupOpen')}</Badge>
    )

  return (
    <PublicFrame className="justify-start">
      {/* Hero */}
      <header className="space-y-3">
        <Eyebrow>{match.group_name}</Eyebrow>
        {/* Same short hero as the match screen on phones ("Jueves 17 sep", then
            the mono time · location line), in the group timezone, so the title
            stays on one line at 390px inside the 448px frame. */}
        <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight text-balance lg:text-4xl">
          {formatRowDate(t, date, timeZone)}
        </h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="font-mono tabular-nums text-foreground">{formatMatchTime(date, timeZone)}</span>
          {match.location && (
            <>
              <span aria-hidden="true">·</span>
              <span>{match.location}</span>
            </>
          )}
          {statusBadge}
        </div>
        <SpotsMeter
          confirmed={match.confirmed_count}
          max={match.max_players}
          waitlist={match.waitlist_count}
          language={language}
        />
        {match.notes && <p className="text-sm text-muted-foreground text-pretty">{match.notes}</p>}
      </header>

      <div className="mt-6">
        {/* Member scoring policy notice for logged-in members (docs/member-scoring.md §6); guests unaffected */}
        {!isPast && isMember && !memberSignup && match.status === 'signup_open' && groupId && profileId && (
          <div className="mb-6">
            <SignupPolicyNotice
              matchId={matchId}
              groupId={groupId}
              playerId={profileId}
              timeZone={timeZone}
            />
          </div>
        )}

        <PublicMatchActions
          matchId={matchId}
          groupSlug={match.group_slug}
          status={match.status as 'signup_open' | 'full' | 'signup_closed'}
          isPast={isPast}
          isLoggedIn={!!user}
          isMember={isMember}
          memberSignup={memberSignup}
          guestSignup={guestSignup}
          inviteCode={inviteCode}
        >
          <section className="space-y-2">
            <Eyebrow as="h2">
              {t('ui.screens.publicMatch.confirmed')} · {match.confirmed_names.length}
            </Eyebrow>
            {match.confirmed_names.length > 0 ? (
              <ol className="[&>li:last-child>*]:border-b-0">
                {match.confirmed_names.map((name, i) => (
                  <li key={`${name}-${i}`}>
                    <PlayerRow index={i + 1} name={name} language={language} />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">{t('ui.screens.publicMatch.nobodyYet')}</p>
            )}
          </section>

          {match.waitlist_names.length > 0 && (
            <section className="space-y-2">
              <Eyebrow as="h2">
                {t('ui.screens.publicMatch.waitlist')} · {match.waitlist_names.length}
              </Eyebrow>
              <ol className="[&>li:last-child>*]:border-b-0">
                {match.waitlist_names.map((name, i) => (
                  <li key={`${name}-${i}`}>
                    <PlayerRow index={i + 1} name={name} language={language} className="text-muted-foreground" />
                  </li>
                ))}
              </ol>
            </section>
          )}
        </PublicMatchActions>
      </div>
    </PublicFrame>
  )
}
