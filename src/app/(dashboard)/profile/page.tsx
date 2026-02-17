import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Trophy, Target, Star, Calendar, TrendingUp } from 'lucide-react'
import { ProfileForm } from './profile-form'

const POSITION_LABELS: Record<string, string> = {
  GK: 'Arquero',
  CB: 'Defensor central',
  LB: 'Lateral izquierdo',
  RB: 'Lateral derecho',
  CDM: 'Mediocampista defensivo',
  CM: 'Mediocampista central',
  CAM: 'Mediocampista ofensivo',
  LM: 'Mediocampista izquierdo',
  RM: 'Mediocampista derecho',
  LW: 'Extremo izquierdo',
  RW: 'Extremo derecho',
  ST: 'Delantero',
  CF: 'Centro delantero',
}

const POSITIONS = [
  { value: 'GK', label: 'Arquero (GK)' },
  { value: 'CB', label: 'Defensor central (CB)' },
  { value: 'LB', label: 'Lateral izquierdo (LB)' },
  { value: 'RB', label: 'Lateral derecho (RB)' },
  { value: 'CDM', label: 'Mediocampista defensivo (CDM)' },
  { value: 'CM', label: 'Mediocampista central (CM)' },
  { value: 'CAM', label: 'Mediocampista ofensivo (CAM)' },
  { value: 'LW', label: 'Extremo izquierdo (LW)' },
  { value: 'RW', label: 'Extremo derecho (RW)' },
  { value: 'ST', label: 'Delantero (ST)' },
]

export default async function ProfilePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  // Get user data
  const { data: userData } = await supabase
    .from('users')
    .select('name, email')
    .eq('id', user.id)
    .single() as { data: { name: string; email: string } | null }

  // Get player profile
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
      reliability_score: number
      fitness_status: 'ok' | 'limited' | 'injured'
      overall_rating: number
      matches_played: number
      goals: number
      assists: number
      mvp_count: number
      clean_sheets: number
    } | null }

  if (!profile) return notFound()

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mi perfil</h1>
        <p className="text-muted-foreground">Administra tu información de jugador</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Stats Card */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center">
                <Avatar fallback={profile.display_name} size="xl" />
                <h2 className="mt-4 text-xl font-semibold">{profile.display_name}</h2>
                {profile.nickname && (
                  <p className="text-muted-foreground">{profile.nickname}</p>
                )}
                <p className="text-sm text-muted-foreground mt-1">
                  {POSITION_LABELS[profile.main_position] || profile.main_position}
                </p>
                <div className="flex items-center gap-1 mt-2">
                  <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                  <span className="text-lg font-semibold">
                    {profile.overall_rating.toFixed(1)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Estadísticas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Partidos jugados</span>
                </div>
                <span className="font-semibold">{profile.matches_played}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Goles</span>
                </div>
                <span className="font-semibold">{profile.goals}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Asistencias</span>
                </div>
                <span className="font-semibold">{profile.assists}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm">MVPs</span>
                </div>
                <span className="font-semibold">{profile.mvp_count}</span>
              </div>
              {profile.clean_sheets > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm">Vallas invictas</span>
                  <span className="font-semibold">{profile.clean_sheets}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Confiabilidad</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${profile.reliability_score * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium">
                  {Math.round(profile.reliability_score * 100)}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Basado en asistencia y cancelaciones
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Edit Form */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Información del jugador</CardTitle>
              <CardDescription>
                Actualiza tu perfil para que los equipos se armen mejor
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileForm
                profile={profile}
                positions={POSITIONS}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
