import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GroupSettingsForm } from './settings-form'
import { MembersManager } from './members-manager'
import { NotificationSettings } from './notification-settings'
import { DangerZone } from './danger-zone'

interface PageProps {
  params: Promise<{ groupSlug: string }>
}

export default async function GroupSettingsPage({ params }: PageProps) {
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
    .select('*')
    .eq('slug', groupSlug)
    .single() as { data: {
      id: string
      name: string
      slug: string
      description: string | null
      default_match_day: number | null
      default_match_time: string | null
      default_max_players: number
      invite_code: string
      timezone: string
    } | null }

  if (!group) return notFound()

  // Check if user is admin
  const { data: membership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', group.id)
    .eq('player_id', playerProfile.id)
    .eq('is_active', true)
    .single() as { data: { role: string } | null }

  if (!membership || membership.role !== 'admin') {
    redirect(`/groups/${groupSlug}`)
  }

  // Get all members
  type MembershipWithProfile = {
    id: string
    role: string
    is_active: boolean
    player_profiles: {
      id: string
      display_name: string
      user_id: string | null
    } | null
  }

  const { data: memberships } = await supabase
    .from('group_memberships')
    .select(`
      id,
      role,
      is_active,
      player_profiles (
        id,
        display_name,
        user_id
      )
    `)
    .eq('group_id', group.id)
    .eq('is_active', true)
    .order('role') as { data: MembershipWithProfile[] | null }

  const members = (memberships || [])
    .filter(m => m.player_profiles !== null)
    .map(m => ({
      membershipId: m.id,
      role: m.role as 'admin' | 'captain' | 'member',
      playerId: (m.player_profiles as { id: string }).id,
      displayName: (m.player_profiles as { display_name: string }).display_name,
      userId: (m.player_profiles as { user_id: string | null }).user_id,
      isCurrentUser: (m.player_profiles as { user_id: string | null }).user_id === user.id,
    }))

  // Get notification settings
  type NotificationSettingsType = {
    id: string
    send_signup_link_on_create: boolean
    reminder_hours_before: number
    notify_on_waitlist_promotion: boolean
    notify_on_teams_created: boolean
    whatsapp_webhook_url: string | null
  }

  const { data: notificationSettings } = await supabase
    .from('notification_settings')
    .select('*')
    .eq('group_id', group.id)
    .single() as { data: NotificationSettingsType | null }

  const notifSettings = notificationSettings || {
    id: null,
    send_signup_link_on_create: true,
    reminder_hours_before: 3,
    notify_on_waitlist_promotion: true,
    notify_on_teams_created: true,
    whatsapp_webhook_url: null,
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back button */}
      <Link
        href={`/groups/${groupSlug}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Volver al grupo
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground">{group.name}</p>
      </div>

      {/* General Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Configuración general</CardTitle>
          <CardDescription>
            Información básica y valores por defecto del grupo
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GroupSettingsForm group={group} />
        </CardContent>
      </Card>

      {/* Members Management */}
      <Card>
        <CardHeader>
          <CardTitle>Miembros ({members.length})</CardTitle>
          <CardDescription>
            Administra los roles y permisos de los miembros
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MembersManager
            groupId={group.id}
            members={members}
            currentUserId={user.id}
          />
        </CardContent>
      </Card>

      {/* Notification Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Notificaciones</CardTitle>
          <CardDescription>
            Configura las notificaciones automáticas del grupo
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationSettings
            groupId={group.id}
            settings={notifSettings}
          />
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Zona de peligro</CardTitle>
          <CardDescription>
            Acciones irreversibles
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DangerZone groupId={group.id} groupName={group.name} />
        </CardContent>
      </Card>
    </div>
  )
}
