import Link from 'next/link'
import { Plus, Users, Calendar } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

type GroupWithRole = {
  id: string
  name: string
  slug: string
  description: string | null
  default_match_day: number | null
  default_match_time: string | null
  role: 'admin' | 'captain' | 'member'
}

export default async function GroupsPage() {
  const supabase = await createClient()

  // Get current user's player profile
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  // Get player profile
  const { data: playerProfile } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null }

  if (!playerProfile) {
    return null
  }

  // Get user's groups with membership info
  const { data: memberships } = await supabase
    .from('group_memberships')
    .select(`
      role,
      groups (
        id,
        name,
        slug,
        description,
        default_match_day,
        default_match_time
      )
    `)
    .eq('player_id', playerProfile.id)
    .eq('is_active', true) as { data: Array<{ role: 'admin' | 'captain' | 'member', groups: GroupWithRole | null }> | null }

  const groups: GroupWithRole[] = (memberships || [])
    .filter((m): m is { role: 'admin' | 'captain' | 'member', groups: GroupWithRole } => m.groups !== null)
    .map((m) => ({
      ...m.groups,
      role: m.role,
    }))

  const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mis grupos</h1>
          <p className="text-muted-foreground">
            Organiza partidos de fútbol con tus amigos
          </p>
        </div>
        <Link href="/groups/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Crear grupo
          </Button>
        </Link>
      </div>

      {/* Groups Grid */}
      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No tienes grupos todavía</h3>
            <p className="text-muted-foreground text-center mb-4">
              Crea un grupo para organizar partidos con tus amigos o únete a uno existente con un código de invitación.
            </p>
            <div className="flex gap-3">
              <Link href="/groups/new">
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Crear grupo
                </Button>
              </Link>
              <Link href="/invite">
                <Button variant="outline">
                  Unirme con código
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <Link key={group.id} href={`/groups/${group.slug}`}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg">{group.name}</CardTitle>
                    <Badge
                      variant={
                        group.role === 'admin'
                          ? 'default'
                          : group.role === 'captain'
                          ? 'secondary'
                          : 'outline'
                      }
                    >
                      {group.role === 'admin'
                        ? 'Admin'
                        : group.role === 'captain'
                        ? 'Capitán'
                        : 'Miembro'}
                    </Badge>
                  </div>
                  {group.description && (
                    <CardDescription className="line-clamp-2">
                      {group.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  {group.default_match_day !== null && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <span>
                        {dayNames[group.default_match_day]}
                        {group.default_match_time && ` ${group.default_match_time.slice(0, 5)}`}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
