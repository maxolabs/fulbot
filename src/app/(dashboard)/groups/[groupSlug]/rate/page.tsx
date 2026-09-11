import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { RateMembersForm, type ExistingRating, type RateMember } from './rate-form'

interface PageProps {
  params: Promise<{ groupSlug: string }>
  searchParams: Promise<{ player?: string; mode?: string }>
}

// Peer rating flow for a group: each member rates the others on four dimensions
// (or skips the ones they don't know). Admins can open it in baseline mode, where
// their ratings weigh 3x and seed a group nobody has rated yet. Individual ratings
// are private to the voter; only admins and captains see the aggregates.
export default async function RateMembersPage({ params, searchParams }: PageProps) {
  const { groupSlug } = await params
  const { player: focusPlayerId, mode } = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  const { data: playerProfile } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null }

  if (!playerProfile) return notFound()

  const { data: group } = await supabase
    .from('groups')
    .select('id, name, slug')
    .eq('slug', groupSlug)
    .single() as { data: { id: string; name: string; slug: string } | null }

  if (!group) return notFound()

  const { data: membership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', group.id)
    .eq('player_id', playerProfile.id)
    .eq('is_active', true)
    .single() as { data: { role: 'admin' | 'captain' | 'member' } | null }

  if (!membership) return notFound()

  const isBaseline = mode === 'baseline' && membership.role === 'admin'

  type MembershipWithProfile = {
    player_profiles: {
      id: string
      display_name: string
      nickname: string | null
      main_position: string
    } | null
  }

  const { data: memberships } = await supabase
    .from('group_memberships')
    .select(`
      player_profiles (
        id,
        display_name,
        nickname,
        main_position
      )
    `)
    .eq('group_id', group.id)
    .eq('is_active', true) as { data: MembershipWithProfile[] | null }

  const members: RateMember[] = (memberships || [])
    .map((m) => m.player_profiles)
    .filter((p): p is NonNullable<MembershipWithProfile['player_profiles']> => p !== null && p.id !== playerProfile.id)
    .map((p) => ({
      id: p.id,
      displayName: p.display_name,
      nickname: p.nickname,
      mainPosition: p.main_position,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))

  // RLS returns only the current voter's rows
  const { data: myRatings } = await supabase
    .from('peer_ratings')
    .select('rated_player_id, skipped, goalkeeping, defense, attack, physical, tags, is_baseline')
    .eq('group_id', group.id)
    .eq('voter_player_id', playerProfile.id) as {
      data: (ExistingRating & { rated_player_id: string })[] | null
    }

  const existing: Record<string, ExistingRating> = {}
  for (const row of myRatings || []) {
    const { rated_player_id, ...rest } = row
    existing[rated_player_id] = rest
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Link
        href={`/groups/${groupSlug}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Volver a {group.name}
      </Link>

      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {isBaseline ? 'Puntaje base' : 'Calificá a tus compañeros'}
          </h1>
          {isBaseline && <Badge>Admin</Badge>}
        </div>
        <p className="text-muted-foreground mt-1">
          {isBaseline
            ? 'Como admin, tu calificación pesa el triple y sirve de punto de partida hasta que el grupo vote.'
            : 'Cuatro aspectos del 1 al 5. Si a alguien no lo viste jugar, omitilo.'}
        </p>
        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5" />
          Tus calificaciones son privadas. Solo los admins y capitanes ven los promedios, y los usan para armar equipos parejos.
        </p>
      </div>

      <RateMembersForm
        groupId={group.id}
        groupSlug={group.slug}
        voterPlayerId={playerProfile.id}
        isBaseline={isBaseline}
        focusPlayerId={focusPlayerId ?? null}
        members={members}
        existing={existing}
      />
    </div>
  )
}
