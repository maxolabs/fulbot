'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice } from '@/components/form-controls'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'

// "Salir del grupo" as a row (docs/ui-rework/06-principles.md §3) that asks in a
// Sheet before calling leave_group (00028). The RPC frees the player's spots on
// upcoming matches (the waitlist promotes) and refuses the last active admin.

interface LeaveGroupRowProps {
  groupId: string
  groupName: string
  /** The viewer is the only active admin: the row is disabled with a reason. */
  isLastAdmin?: boolean
  className?: string
}

function isLastAdminError(err: unknown) {
  const e = err as { message?: string; details?: string } | null
  const text = `${e?.message ?? ''} ${e?.details ?? ''}`
  // leave_group raises 'last_admin'; the membership guard (00024) raises the Spanish text.
  return text.includes('last_admin') || text.includes('al menos un admin activo')
}

export function LeaveGroupRow({ groupId, groupName, isLastAdmin = false, className }: LeaveGroupRowProps) {
  const t = useT()
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function leave() {
    setLoading(true)
    setError(null)
    try {
      const { error: rpcError } = await (supabase as any).rpc('leave_group', { p_group_id: groupId })
      if (rpcError) throw rpcError
      setOpen(false)
      router.push('/groups')
      router.refresh()
    } catch (err) {
      console.error('Error leaving group:', err)
      setError(isLastAdminError(err) ? t('ui.membership.lastAdmin') : t('ui.membership.leaveError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={cn('border-t border-border', className)}>
      <button
        type="button"
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
        disabled={isLastAdmin}
        className="flex min-h-11 w-full items-center gap-3 py-2 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
      >
        <LogOut className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{t('ui.membership.leave')}</span>
          <span className="block text-xs text-muted-foreground text-pretty">
            {isLastAdmin ? t('ui.membership.lastAdmin') : t('ui.membership.leaveHint')}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
      </button>

      <Sheet
        open={open}
        onOpenChange={(next) => { if (!loading) setOpen(next) }}
        title={t('ui.membership.leaveConfirm', { name: groupName })}
        description={t('ui.membership.leaveBody')}
      >
        <div className="space-y-4 pt-4">
          {error && <FormNotice kind="error">{error}</FormNotice>}
          <div className="flex flex-wrap gap-3">
            <Button variant="destructive" disabled={loading} onClick={leave}>
              {loading && <Spinner size="sm" />}
              {t('ui.membership.leave')}
            </Button>
            <Button variant="outline" disabled={loading} onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  )
}
