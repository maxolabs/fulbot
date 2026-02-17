'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shield, ShieldCheck, User, MoreVertical, UserMinus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'

interface Member {
  membershipId: string
  role: 'admin' | 'captain' | 'member'
  playerId: string
  displayName: string
  userId: string | null
  isCurrentUser: boolean
}

interface MembersManagerProps {
  groupId: string
  members: Member[]
  currentUserId: string
}

export function MembersManager({ groupId, members, currentUserId }: MembersManagerProps) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState<string | null>(null)
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  const adminCount = members.filter((m) => m.role === 'admin').length

  const handleRoleChange = async (membershipId: string, newRole: 'admin' | 'captain' | 'member') => {
    setLoading(membershipId)
    setOpenMenu(null)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('group_memberships')
        .update({ role: newRole })
        .eq('id', membershipId)

      if (error) throw error
      router.refresh()
    } catch (err) {
      console.error('Error changing role:', err)
      alert('Error al cambiar el rol')
    } finally {
      setLoading(null)
    }
  }

  const handleRemoveMember = async (membershipId: string, displayName: string) => {
    if (!confirm(`¿Estás seguro de querer eliminar a ${displayName} del grupo?`)) {
      return
    }

    setLoading(membershipId)
    setOpenMenu(null)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('group_memberships')
        .update({ is_active: false })
        .eq('id', membershipId)

      if (error) throw error
      router.refresh()
    } catch (err) {
      console.error('Error removing member:', err)
      alert('Error al eliminar al miembro')
    } finally {
      setLoading(null)
    }
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin':
        return <ShieldCheck className="h-4 w-4" />
      case 'captain':
        return <Shield className="h-4 w-4" />
      default:
        return <User className="h-4 w-4" />
    }
  }

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin':
        return 'Admin'
      case 'captain':
        return 'Capitán'
      default:
        return 'Miembro'
    }
  }

  return (
    <div className="space-y-2">
      {members.map((member) => (
        <div
          key={member.membershipId}
          className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-muted/50"
        >
          <div className="flex items-center gap-3">
            <Avatar fallback={member.displayName} size="sm" />
            <div>
              <p className="text-sm font-medium">
                {member.displayName}
                {member.isCurrentUser && (
                  <span className="text-muted-foreground ml-1">(tú)</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge
              variant={
                member.role === 'admin'
                  ? 'default'
                  : member.role === 'captain'
                  ? 'secondary'
                  : 'outline'
              }
              className="flex items-center gap-1"
            >
              {getRoleIcon(member.role)}
              {getRoleLabel(member.role)}
            </Badge>

            {loading === member.membershipId ? (
              <Spinner size="sm" />
            ) : (
              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() =>
                    setOpenMenu(openMenu === member.membershipId ? null : member.membershipId)
                  }
                  disabled={member.isCurrentUser && adminCount === 1}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>

                {openMenu === member.membershipId && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setOpenMenu(null)}
                    />
                    <div className="absolute right-0 z-20 mt-1 w-48 rounded-md bg-card border shadow-lg py-1">
                      {member.role !== 'admin' && (
                        <button
                          onClick={() => handleRoleChange(member.membershipId, 'admin')}
                          className="flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-muted"
                        >
                          <ShieldCheck className="h-4 w-4" />
                          Hacer admin
                        </button>
                      )}
                      {member.role !== 'captain' && (
                        <button
                          onClick={() => handleRoleChange(member.membershipId, 'captain')}
                          className="flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-muted"
                        >
                          <Shield className="h-4 w-4" />
                          Hacer capitán
                        </button>
                      )}
                      {member.role !== 'member' && (
                        <button
                          onClick={() => handleRoleChange(member.membershipId, 'member')}
                          className="flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-muted"
                          disabled={member.role === 'admin' && adminCount === 1}
                        >
                          <User className="h-4 w-4" />
                          Hacer miembro
                        </button>
                      )}
                      {!member.isCurrentUser && (
                        <>
                          <div className="border-t my-1" />
                          <button
                            onClick={() =>
                              handleRemoveMember(member.membershipId, member.displayName)
                            }
                            className="flex items-center gap-2 w-full px-4 py-2 text-sm text-destructive hover:bg-muted"
                          >
                            <UserMinus className="h-4 w-4" />
                            Eliminar del grupo
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      ))}

      <div className="pt-4 text-xs text-muted-foreground">
        <p><strong>Admin:</strong> Puede gestionar el grupo, miembros y partidos</p>
        <p><strong>Capitán:</strong> Puede crear partidos y armar equipos</p>
        <p><strong>Miembro:</strong> Puede inscribirse y votar</p>
      </div>
    </div>
  )
}
