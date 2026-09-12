'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shield, ShieldCheck, User, MoreVertical, UserMinus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Popover } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'

// Members of a group with their role, as rows (docs/ui-rework/06-principles.md
// §3). The per-member menu is the Popover primitive; the role badge is never
// cone so the page keeps its one orange for the save buttons.

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

const menuItemClassName =
  'flex min-h-10 w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'

export function MembersManager({ members }: MembersManagerProps) {
  const t = useT()
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState<string | null>(null)

  const adminCount = members.filter((m) => m.role === 'admin').length

  const handleRoleChange = async (membershipId: string, newRole: 'admin' | 'captain' | 'member') => {
    setLoading(membershipId)
    try {
      const { error } = await (supabase as any)
        .from('group_memberships')
        .update({ role: newRole })
        .eq('id', membershipId)

      if (error) throw error
      router.refresh()
    } catch (err) {
      console.error('Error changing role:', err)
      alert(t('ui.screens.members.roleError'))
    } finally {
      setLoading(null)
    }
  }

  const handleRemoveMember = async (membershipId: string, displayName: string) => {
    if (!confirm(t('ui.screens.members.removeConfirm', { name: displayName }))) {
      return
    }

    setLoading(membershipId)
    try {
      const { error } = await (supabase as any)
        .from('group_memberships')
        .update({ is_active: false })
        .eq('id', membershipId)

      if (error) throw error
      router.refresh()
    } catch (err) {
      console.error('Error removing member:', err)
      alert(t('ui.screens.members.removeError'))
    } finally {
      setLoading(null)
    }
  }

  const roleIcon = (role: string) => {
    switch (role) {
      case 'admin':
        return <ShieldCheck className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
      case 'captain':
        return <Shield className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
      default:
        return null
    }
  }

  return (
    <div className="space-y-4">
      <ul className="[&>li:last-child]:border-b-0">
        {members.map((member) => (
          <li
            key={member.membershipId}
            className="flex min-h-11 items-center gap-3 border-b border-border py-2"
          >
            <Avatar fallback={member.displayName} size="xs" aria-hidden="true" />
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="truncate text-sm font-medium">{member.displayName}</span>
              {member.isCurrentUser && (
                <span className="shrink-0 text-xs text-muted-foreground">{t('ui.screens.members.you')}</span>
              )}
            </span>

            <Badge
              variant={member.role === 'admin' ? 'secondary' : 'outline'}
              className={cn('gap-1', member.role === 'member' && 'border-transparent text-muted-foreground')}
            >
              {roleIcon(member.role)}
              {t(`groups.roles.${member.role}`)}
            </Badge>

            {loading === member.membershipId ? (
              <span className="inline-flex h-9 w-9 items-center justify-center">
                <Spinner size="sm" />
              </span>
            ) : (
              <Popover
                align="right"
                aria-label={t('ui.screens.members.menu', { name: member.displayName })}
                triggerClassName="inline-flex h-9 w-9 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                className="w-52"
                trigger={<MoreVertical className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />}
              >
                {({ close }) => (
                  <div className="py-1">
                    {member.role !== 'admin' && (
                      <button
                        type="button"
                        onClick={() => {
                          close()
                          handleRoleChange(member.membershipId, 'admin')
                        }}
                        className={menuItemClassName}
                      >
                        <ShieldCheck className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                        {t('ui.screens.members.makeAdmin')}
                      </button>
                    )}
                    {member.role !== 'captain' && (
                      <button
                        type="button"
                        onClick={() => {
                          close()
                          handleRoleChange(member.membershipId, 'captain')
                        }}
                        className={menuItemClassName}
                      >
                        <Shield className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                        {t('ui.screens.members.makeCaptain')}
                      </button>
                    )}
                    {member.role !== 'member' && (
                      <button
                        type="button"
                        onClick={() => {
                          close()
                          handleRoleChange(member.membershipId, 'member')
                        }}
                        className={menuItemClassName}
                        disabled={member.role === 'admin' && adminCount === 1}
                      >
                        <User className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                        {t('ui.screens.members.makeMember')}
                      </button>
                    )}
                    {!member.isCurrentUser && (
                      <>
                        <div className="my-1 border-t border-border" />
                        <button
                          type="button"
                          onClick={() => {
                            close()
                            handleRemoveMember(member.membershipId, member.displayName)
                          }}
                          className={cn(menuItemClassName, 'text-destructive')}
                        >
                          <UserMinus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                          {t('ui.screens.members.remove')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </Popover>
            )}
          </li>
        ))}
      </ul>

      <div className="space-y-0.5 text-xs text-muted-foreground">
        <p>
          <strong className="font-medium text-foreground">{t('groups.roles.admin')}:</strong> {t('ui.screens.members.adminHint')}
        </p>
        <p>
          <strong className="font-medium text-foreground">{t('groups.roles.captain')}:</strong> {t('ui.screens.members.captainHint')}
        </p>
        <p>
          <strong className="font-medium text-foreground">{t('groups.roles.member')}:</strong> {t('ui.screens.members.memberHint')}
        </p>
      </div>
    </div>
  )
}
