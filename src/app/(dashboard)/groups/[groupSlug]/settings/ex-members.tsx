'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice } from '@/components/form-controls'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'

// "Ex miembros" (OD-1): players an admin removed. They cannot rejoin with the
// invite link until an admin brings them back here (admin_readd_member, 00033),
// which restores them as a plain member. Rows, like the members list above.

export interface ExMember {
  membershipId: string
  displayName: string
  /** Already formatted in the group's time zone. */
  removedOn: string
  removedBy: string | null
}

export function ExMembers({ exMembers }: { exMembers: ExMember[] }) {
  const t = useT()
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (exMembers.length === 0) return null

  const readd = async (membershipId: string) => {
    setLoading(membershipId)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('admin_readd_member', { p_membership_id: membershipId })
      if (rpcError) throw rpcError
      router.refresh()
    } catch (err) {
      console.error('Error re-adding member:', err)
      setError(t('ui.membership.readdError'))
    } finally {
      setLoading(null)
    }
  }

  return (
    <section aria-labelledby="ex-members-title" className="space-y-2 border-t border-border pt-4">
      <Eyebrow as="h3" id="ex-members-title">
        {t('ui.membership.exMembers')} · {exMembers.length}
      </Eyebrow>
      <p className="text-xs text-muted-foreground text-pretty">{t('ui.membership.exMembersHint')}</p>
      {error && <FormNotice kind="error">{error}</FormNotice>}
      <ul className="[&>li:last-child]:border-b-0">
        {exMembers.map((m) => (
          <li key={m.membershipId} className="flex min-h-11 items-center gap-3 border-b border-border py-2">
            <Avatar fallback={m.displayName} size="xs" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-muted-foreground">{m.displayName}</span>
              <span className="block text-xs text-muted-foreground text-pretty">
                {m.removedBy
                  ? t('ui.membership.removedMeta', { date: m.removedOn, admin: m.removedBy })
                  : t('ui.membership.removedMetaNoAdmin', { date: m.removedOn })}
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={loading !== null}
              onClick={() => readd(m.membershipId)}
              aria-label={t('ui.membership.readdLabel', { name: m.displayName })}
            >
              {loading === m.membershipId ? (
                <Spinner size="sm" />
              ) : (
                <UserPlus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              )}
              {t('ui.membership.readd')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
