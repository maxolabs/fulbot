import { notFound } from 'next/navigation'
import { Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/layout/page-header'
import { TopBarConfig } from '@/components/layout/top-bar'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'
import { RateMembersForm, type ExistingRating, type RateMember } from './rate-form'

interface PageProps {
  params: Promise<{ groupSlug: string }>
  searchParams: Promise<{ player?: string; mode?: string }>
}

// Peer rating flow for a group (docs/ui-rework/03-screens.md §8): each member
// rates the others on four dimensions (or skips the ones they don't know).
// Admins can open it in baseline mode, where their ratings weigh 3x and seed
// a group nobody has rated yet. Individual ratings are private to the voter;
// only admins and captains see the aggregates.
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

  const { data: userData } = await supabase
    .from('users')
    .select('preferred_language')
    .eq('id', user.id)
    .single() as { data: { preferred_language: Language } | null }
  const t = getT(userData?.preferred_language ?? 'es')

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

  const title = isBaseline ? t('ui.screens.rate.baselineTitle') : t('ui.shell.rate')
  const subtitle = isBaseline ? t('ui.screens.rate.baselineSubtitle') : t('ui.screens.rate.subtitle')

  return (
    <div className="mx-auto max-w-xl space-y-6 pb-32">
      <TopBarConfig title={title} back={`/groups/${groupSlug}`} />

      <PageHeader
        eyebrow={group.name}
        title={
          <>
            {title}
            {isBaseline && <Badge variant="secondary" className="ml-3 align-middle">Admin</Badge>}
          </>
        }
        subtitle={subtitle}
      />

      <div className="space-y-1 lg:hidden">
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        {t('ui.screens.rate.privacy')}
      </p>

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
