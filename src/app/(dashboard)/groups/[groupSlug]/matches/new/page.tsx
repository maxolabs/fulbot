import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CreateMatchForm } from './create-match-form'

interface PageProps {
  params: Promise<{ groupSlug: string }>
}

export default async function CreateMatchPage({ params }: PageProps) {
  const { groupSlug } = await params
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  // Get user's player profile
  const { data: playerProfile } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null }

  if (!playerProfile) return notFound()

  // Get group
  const { data: group } = await supabase
    .from('groups')
    .select('id, name, slug, default_match_day, default_match_time, default_max_players')
    .eq('slug', groupSlug)
    .single() as { data: {
      id: string
      name: string
      slug: string
      default_match_day: number | null
      default_match_time: string | null
      default_max_players: number
    } | null }

  if (!group) return notFound()

  // Check if user is admin or captain
  const { data: membership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', group.id)
    .eq('player_id', playerProfile.id)
    .eq('is_active', true)
    .single() as { data: { role: string } | null }

  if (!membership || (membership.role !== 'admin' && membership.role !== 'captain')) {
    redirect(`/groups/${groupSlug}`)
  }

  // Calculate next match date based on default_match_day
  const getNextMatchDate = () => {
    const today = new Date()
    const targetDay = group.default_match_day ?? 1 // Default to Monday
    const daysUntilTarget = (targetDay - today.getDay() + 7) % 7
    const nextDate = new Date(today)

    // If target day is today and it's past the default time, go to next week
    if (daysUntilTarget === 0) {
      const defaultTime = group.default_match_time || '21:00'
      const [hours, minutes] = defaultTime.split(':').map(Number)
      const targetTime = new Date(today)
      targetTime.setHours(hours, minutes, 0, 0)

      if (today > targetTime) {
        nextDate.setDate(today.getDate() + 7)
      }
    } else {
      nextDate.setDate(today.getDate() + daysUntilTarget)
    }

    return nextDate.toISOString().split('T')[0]
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back button */}
      <Link
        href={`/groups/${groupSlug}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Volver a {group.name}
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Crear partido</CardTitle>
          <CardDescription>
            Programa un nuevo partido para {group.name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateMatchForm
            groupId={group.id}
            groupSlug={group.slug}
            defaults={{
              date: getNextMatchDate(),
              time: group.default_match_time?.slice(0, 5) || '21:00',
              maxPlayers: group.default_max_players,
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
