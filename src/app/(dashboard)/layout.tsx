import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/layout/app-shell'
import type { ShellCurrentGroup, ShellGroup, ShellRole } from '@/components/layout/types'
import { maybeTick } from '@/lib/notifications/opportunistic-tick'
import { LanguageProvider } from '@/i18n/provider'
import type { Language } from '@/i18n/core'
import { GROUP_COOKIE } from '@/lib/group-cookie'

// The current group is not in the URL from a layout's point of view, so it
// comes from the fulbot_group cookie (set by the middleware on every
// /groups/[slug] request, docs/ui-rework/02-shell.md §3), matched against
// the user's active memberships. Fallback: the only group when there is one.

const UPCOMING_STATUSES = ['signup_open', 'full', 'signup_closed', 'teams_created'] as const

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Let signed-in traffic drive the results scheduler when no ticker is
  // running (docs/match-results-consensus.md §5). Detached and throttled:
  // never awaited, never throws, at most once a minute per instance.
  maybeTick()

  const [{ data: userData }, { data: playerProfile }, { data: unreadData }] = await Promise.all([
    supabase
      .from('users')
      .select('name, email, avatar_url, preferred_language')
      .eq('id', user.id)
      .single() as unknown as Promise<{
        data: { name: string; email: string; avatar_url: string | null; preferred_language: Language } | null
      }>,
    supabase
      .from('player_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single() as unknown as Promise<{ data: { id: string } | null }>,
    supabase.rpc('get_unread_notification_count') as unknown as Promise<{ data: number | null }>,
  ])

  const language: Language = userData?.preferred_language ?? 'es'
  const unreadCount = typeof unreadData === 'number' ? unreadData : 0

  // Active memberships → the groups the shell knows about.
  let groups: Array<ShellGroup & { id: string }> = []
  if (playerProfile) {
    const { data: memberships } = await supabase
      .from('group_memberships')
      .select('role, groups ( id, name, slug )')
      .eq('player_id', playerProfile.id)
      .eq('is_active', true) as {
        data: Array<{ role: ShellRole; groups: { id: string; name: string; slug: string } | null }> | null
      }
    groups = (memberships || [])
      .filter((m): m is { role: ShellRole; groups: { id: string; name: string; slug: string } } => m.groups !== null)
      .map((m) => ({ id: m.groups.id, slug: m.groups.slug, name: m.groups.name, role: m.role }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  const cookieStore = await cookies()
  const cookieSlug = cookieStore.get(GROUP_COOKIE)?.value
  const current =
    groups.find((g) => g.slug === cookieSlug) ?? (groups.length === 1 ? groups[0] : undefined)

  let currentGroup: ShellCurrentGroup | undefined
  if (current && playerProfile) {
    const nowIso = new Date().toISOString()
    const [{ data: nextMatch }, { data: memberRows }, { data: ratedRows }] = await Promise.all([
      supabase
        .from('matches')
        .select('id')
        .eq('group_id', current.id)
        .gte('date_time', nowIso)
        .in('status', UPCOMING_STATUSES)
        .order('date_time', { ascending: true })
        .limit(1)
        .maybeSingle() as unknown as Promise<{ data: { id: string } | null }>,
      supabase
        .from('group_memberships')
        .select('player_id')
        .eq('group_id', current.id)
        .eq('is_active', true) as unknown as Promise<{ data: { player_id: string }[] | null }>,
      // RLS returns only the current voter's own peer_ratings rows (same
      // query the group dashboard uses for its "sin calificar" card).
      supabase
        .from('peer_ratings')
        .select('rated_player_id')
        .eq('group_id', current.id)
        .eq('voter_player_id', playerProfile.id) as unknown as Promise<{ data: { rated_player_id: string }[] | null }>,
    ])

    const ratedIds = new Set((ratedRows || []).map((r) => r.rated_player_id))
    const pendingRatings = (memberRows || []).filter(
      (m) => m.player_id !== playerProfile.id && !ratedIds.has(m.player_id)
    ).length

    currentGroup = {
      slug: current.slug,
      name: current.name,
      role: current.role,
      pendingRatings,
      nextMatchId: nextMatch?.id,
    }
  }

  return (
    <LanguageProvider language={language}>
      <AppShell
        user={userData ? { name: userData.name, email: userData.email, avatar_url: userData.avatar_url } : undefined}
        groups={groups.map(({ slug, name, role }) => ({ slug, name, role }))}
        currentGroup={currentGroup}
        unreadCount={unreadCount}
      >
        {children}
      </AppShell>
    </LanguageProvider>
  )
}
