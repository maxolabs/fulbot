import { cookies } from 'next/headers'
import Link from 'next/link'
import { Calendar, Clock, MapPin, Users, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PublicMatchActions } from './public-match-actions'

interface PageProps {
  params: Promise<{ matchId: string }>
}

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

const STATUS_MESSAGES: Record<string, string> = {
  draft: 'Las inscripciones aún no están abiertas',
  teams_created: 'Los equipos ya fueron armados',
  finished: 'Este partido ya terminó',
  cancelled: 'Este partido fue cancelado',
}

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
}

function NotFoundCard() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center py-8">
          <XCircle className="h-12 w-12 text-destructive mb-4" />
          <h2 className="text-xl font-semibold mb-2">Partido no encontrado</h2>
          <p className="text-muted-foreground text-center mb-6">
            Este partido no existe o ya no está disponible.
          </p>
          <Link href="/">
            <Button>Ir al inicio</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}

export default async function PublicMatchPage({ params }: PageProps) {
  const { matchId } = await params
  const supabase = await createClient()

  // get_public_match works for anonymous visitors too -- it's the only way
  // this page reads match data, so RLS never needs to open matches to anon.
  const args: Database['public']['Functions']['get_public_match']['Args'] = {
    p_match_id: matchId,
  }
  const { data: match } = (await supabase.rpc('get_public_match', args)) as {
    data: PublicMatch | null
  }

  if (!match || !match.id) {
    return <NotFoundCard />
  }

  const date = new Date(match.date_time)
  const isPast = date < new Date()
  const isSignupPhase = ['signup_open', 'full', 'signup_closed'].includes(match.status)

  const { data: { user } } = await supabase.auth.getUser()

  if (!isSignupPhase) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-8">
            <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">{match.group_name}</h2>
            <p className="text-muted-foreground text-center mb-6">
              {STATUS_MESSAGES[match.status] || 'Este partido no está disponible'}
            </p>
            {user && (
              <Link href={`/groups/${match.group_slug}/matches/${matchId}`}>
                <Button>Ver detalles del partido</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  // Resolve the logged-in visitor's relationship to the group (member vs not)
  let isMember = false
  let memberSignup: { id: string; status: 'confirmed' | 'waitlist'; waitlistPosition: number | null } | null = null
  let inviteCode: string | null = null

  if (user) {
    const { data: profile } = await supabase
      .from('player_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single() as { data: { id: string } | null }

    if (profile) {
      const { data: groupRow } = await supabase
        .from('groups')
        .select('id, invite_code')
        .eq('slug', match.group_slug)
        .single() as { data: { id: string; invite_code: string } | null }

      if (groupRow) {
        inviteCode = groupRow.invite_code

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
    const cookieStore = await cookies()
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

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2">
            <Badge variant={match.status === 'full' ? 'secondary' : match.status === 'signup_closed' ? 'outline' : 'default'}>
              {match.status === 'full'
                ? 'Completo'
                : match.status === 'signup_closed'
                  ? 'Inscripción cerrada'
                  : 'Inscripción abierta'}
            </Badge>
          </div>
          <CardTitle className="text-xl">{match.group_name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>{DAYS[date.getDay()]} {date.toLocaleDateString('es-AR')}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>{date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            {match.location && (
              <div className="flex items-center gap-3 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span>{match.location}</span>
              </div>
            )}
            <div className="flex items-center gap-3 text-sm">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span>{match.confirmed_count}/{match.max_players} jugadores</span>
            </div>
          </div>

          {match.notes && (
            <p className="text-sm text-muted-foreground bg-muted rounded-lg p-3">
              {match.notes}
            </p>
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
          />

          <div className="space-y-3 border-t border-border/50 pt-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">
                Confirmados ({match.confirmed_names.length})
              </p>
              {match.confirmed_names.length > 0 ? (
                <ul className="text-sm space-y-1">
                  {match.confirmed_names.map((name, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="w-5 text-center text-xs text-muted-foreground">{i + 1}</span>
                      <span>{name}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nadie se inscribió todavía</p>
              )}
            </div>

            {match.waitlist_names.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  Lista de espera ({match.waitlist_names.length})
                </p>
                <ul className="text-sm space-y-1">
                  {match.waitlist_names.map((name, i) => (
                    <li key={i} className="flex items-center gap-2 text-muted-foreground">
                      <span className="w-5 text-center text-xs">{i + 1}</span>
                      <span>{name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
