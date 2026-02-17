import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, CheckCircle, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { JoinGroupButton } from './join-button'

interface PageProps {
  params: Promise<{ code: string }>
}

export default async function InvitePage({ params }: PageProps) {
  const { code } = await params
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()

  // Find group by invite code
  const { data: group } = await supabase
    .from('groups')
    .select('id, name, slug, description, default_match_day, default_match_time')
    .eq('invite_code', code)
    .single() as { data: {
      id: string
      name: string
      slug: string
      description: string | null
      default_match_day: number | null
      default_match_time: string | null
    } | null }

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

  // If user is not logged in, show login prompt
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
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-muted-foreground">
              Inicia sesión o crea una cuenta para unirte al grupo.
            </p>
            <div className="flex flex-col gap-2">
              <Link href={`/login?redirect=/invite/${code}`}>
                <Button className="w-full">Iniciar sesión</Button>
              </Link>
              <Link href={`/register?redirect=/invite/${code}`}>
                <Button variant="outline" className="w-full">Crear cuenta</Button>
              </Link>
            </div>
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

  const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

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
          {group.default_match_day !== null && (
            <div className="text-center text-sm text-muted-foreground">
              Partidos: {DAYS[group.default_match_day]}
              {group.default_match_time && ` a las ${group.default_match_time.slice(0, 5)}`}
            </div>
          )}

          <JoinGroupButton
            groupId={group.id}
            groupSlug={group.slug}
            playerId={playerProfile.id}
            wasInactive={existingMembership !== null && !existingMembership.is_active}
          />

          <p className="text-xs text-center text-muted-foreground">
            Al unirte, podrás ver los partidos del grupo e inscribirte.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
