import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Calendar, Clock, MapPin, Users, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PublicSignupButton } from './public-signup-button'

interface PageProps {
  params: Promise<{ matchId: string }>
}

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

export default async function PublicMatchPage({ params }: PageProps) {
  const { matchId } = await params
  const supabase = await createClient()

  // Get match with group info
  type MatchWithGroup = {
    id: string
    date_time: string
    location: string | null
    status: string
    max_players: number
    notes: string | null
    groups: {
      id: string
      name: string
      slug: string
    } | null
  }

  const { data: match } = await supabase
    .from('matches')
    .select(`
      id,
      date_time,
      location,
      status,
      max_players,
      notes,
      groups (
        id,
        name,
        slug
      )
    `)
    .eq('id', matchId)
    .single() as { data: MatchWithGroup | null }

  if (!match || !match.groups) {
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

  const group = match.groups
  const date = new Date(match.date_time)
  const isPast = date < new Date()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()

  // Count confirmed signups
  const { count: confirmedCount } = await supabase
    .from('match_signups')
    .select('*', { count: 'exact', head: true })
    .eq('match_id', matchId)
    .eq('status', 'confirmed')

  const signupCount = confirmedCount || 0
  const isFull = signupCount >= match.max_players

  // If match is not open for signup, show status
  if (match.status !== 'signup_open' && match.status !== 'full') {
    const statusMessages: Record<string, string> = {
      draft: 'Las inscripciones aún no están abiertas',
      teams_created: 'Los equipos ya fueron armados',
      finished: 'Este partido ya terminó',
      cancelled: 'Este partido fue cancelado',
    }

    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-8">
            <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">{group.name}</h2>
            <p className="text-muted-foreground text-center mb-6">
              {statusMessages[match.status] || 'Este partido no está disponible'}
            </p>
            {user && (
              <Link href={`/groups/${group.slug}/matches/${matchId}`}>
                <Button>Ver detalles del partido</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  // If user is logged in, check membership and signup status
  let playerProfile: { id: string } | null = null
  let isMember = false
  let currentSignup: { id: string; status: string; waitlist_position: number | null } | null = null

  if (user) {
    const { data: profile } = await supabase
      .from('player_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single() as { data: { id: string } | null }

    playerProfile = profile

    if (profile) {
      // Check membership
      const { data: membership } = await supabase
        .from('group_memberships')
        .select('id')
        .eq('group_id', group.id)
        .eq('player_id', profile.id)
        .eq('is_active', true)
        .single() as { data: { id: string } | null }

      isMember = !!membership

      // Check current signup
      const { data: signup } = await supabase
        .from('match_signups')
        .select('id, status, waitlist_position')
        .eq('match_id', matchId)
        .eq('player_id', profile.id)
        .in('status', ['confirmed', 'waitlist'])
        .single() as { data: { id: string; status: string; waitlist_position: number | null } | null }

      currentSignup = signup
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2">
            <Badge variant={isFull ? 'secondary' : 'default'}>
              {isFull ? 'Completo' : 'Inscripción abierta'}
            </Badge>
          </div>
          <CardTitle className="text-xl">{group.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Match Info */}
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
              <span>{signupCount}/{match.max_players} jugadores</span>
            </div>
          </div>

          {match.notes && (
            <p className="text-sm text-muted-foreground bg-muted rounded-lg p-3">
              {match.notes}
            </p>
          )}

          {/* Action based on auth status */}
          {!user ? (
            <div className="space-y-3">
              <p className="text-center text-sm text-muted-foreground">
                Inicia sesión para inscribirte
              </p>
              <div className="flex flex-col gap-2">
                <Link href={`/login?redirect=/m/${matchId}`}>
                  <Button className="w-full">Iniciar sesión</Button>
                </Link>
                <Link href={`/register?redirect=/m/${matchId}`}>
                  <Button variant="outline" className="w-full">Crear cuenta</Button>
                </Link>
              </div>
            </div>
          ) : !isMember ? (
            <div className="space-y-3">
              <p className="text-center text-sm text-muted-foreground">
                No sos miembro de este grupo
              </p>
              <Link href={`/groups/${group.slug}`}>
                <Button variant="outline" className="w-full">Ver grupo</Button>
              </Link>
            </div>
          ) : playerProfile ? (
            <PublicSignupButton
              matchId={matchId}
              playerId={playerProfile.id}
              groupSlug={group.slug}
              currentSignup={currentSignup}
              isFull={isFull}
              isPast={isPast}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
