import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, XCircle, Calendar, MapPin, UserPlus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DEFAULT_TIMEZONE, formatMatchDate, formatMatchTime, formatWeekday } from '@/lib/utils/datetime'
import { JoinGroupButton } from './join-button'

interface PageProps {
  params: Promise<{ code: string }>
}

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

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

function NextMatchCard({ group }: { group: PublicGroup }) {
  const match = group.next_match
  if (!match) return null
  const tz = group.timezone || DEFAULT_TIMEZONE
  const isFull = match.confirmed_count >= match.max_players

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3">
      <p className="text-sm font-medium">Próximo partido</p>
      <div className="space-y-1 text-sm text-muted-foreground">
        <p className="flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          {formatMatchDate(match.date_time, tz)} · {formatMatchTime(match.date_time, tz)}
        </p>
        {match.location && (
          <p className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            {match.location}
          </p>
        )}
        <p className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          {match.confirmed_count}/{match.max_players} anotados
          {isFull && ' · lista de espera'}
        </p>
      </div>
      <Link href={`/m/${match.id}`} className="block">
        <Button variant="secondary" className="w-full">
          <UserPlus className="mr-2 h-4 w-4" />
          Anotarme como invitado (sin cuenta)
        </Button>
      </Link>
      <p className="text-xs text-center text-muted-foreground">
        Solo para este partido, con tu nombre. Para quedar en el grupo, creá una cuenta.
      </p>
    </div>
  )
}

export default async function InvitePage({ params }: PageProps) {
  const { code } = await params
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()

  // Public view of the group (works for anonymous visitors, includes the next open match)
  const { data: groupData } = await supabase.rpc('get_public_group_by_invite', { p_invite_code: code })
  const group = (groupData as PublicGroup | null) ?? null

  if (!group) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-8">
            <XCircle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invitación inválida</h2>
            <p className="text-muted-foreground text-center mb-6">
              Este código de invitación no existe o ya no es válido.
            </p>
            <Link href="/">
              <Button>Ir al inicio</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const scheduleLine = group.default_match_day !== null
    ? `${DAYS[group.default_match_day]}${group.default_match_time ? ` a las ${group.default_match_time.slice(0, 5)}` : ''}`
    : null

  // Anonymous visitor: account actions plus the guest path to the next match
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Te invitaron a {group.name}</CardTitle>
            {group.description && (
              <CardDescription>{group.description}</CardDescription>
            )}
            {scheduleLine && (
              <p className="text-sm text-muted-foreground mt-1">
                Partidos: {scheduleLine} · {group.member_count} miembros
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-muted-foreground">
              Iniciá sesión o creá una cuenta para unirte al grupo.
            </p>
            <div className="flex flex-col gap-2">
              <Link href={`/login?redirect=/invite/${code}`}>
                <Button className="w-full">Iniciar sesión</Button>
              </Link>
              <Link href={`/register?redirect=/invite/${code}`}>
                <Button variant="outline" className="w-full">Crear cuenta</Button>
              </Link>
            </div>
            <NextMatchCard group={group} />
          </CardContent>
        </Card>
      </div>
    )
  }

  // Get user's player profile
  const { data: playerProfile } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null }

  if (!playerProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-8">
            <XCircle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Error</h2>
            <p className="text-muted-foreground text-center mb-6">
              No se encontró tu perfil de jugador.
            </p>
            <Link href="/groups">
              <Button>Ir a mis grupos</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Check if user is already a member
  const { data: existingMembership } = await supabase
    .from('group_memberships')
    .select('id, is_active')
    .eq('group_id', group.id)
    .eq('player_id', playerProfile.id)
    .single() as { data: { id: string; is_active: boolean } | null }

  if (existingMembership?.is_active) {
    // Already a member, redirect to group
    redirect(`/groups/${group.slug}`)
  }

  const tz = group.timezone || DEFAULT_TIMEZONE

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Unirse a {group.name}</CardTitle>
          {group.description && (
            <CardDescription>{group.description}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {scheduleLine && (
            <div className="text-center text-sm text-muted-foreground">
              Partidos: {scheduleLine} · {group.member_count} miembros
            </div>
          )}

          {group.next_match && (
            <p className="text-center text-sm">
              Próximo: {formatWeekday(group.next_match.date_time, tz)} {formatMatchTime(group.next_match.date_time, tz)}
              {' · '}{group.next_match.confirmed_count}/{group.next_match.max_players} anotados
            </p>
          )}

          <JoinGroupButton
            groupId={group.id}
            groupSlug={group.slug}
            playerId={playerProfile.id}
            wasInactive={existingMembership !== null && !existingMembership.is_active}
          />

          <p className="text-xs text-center text-muted-foreground">
            Al unirte, vas a poder ver los partidos del grupo e inscribirte.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
