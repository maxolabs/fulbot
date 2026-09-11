'use client'

import { Hourglass, Lock, UserX, type LucideIcon } from 'lucide-react'
import { useT } from '@/i18n/provider'
import { formatMatchDateShort, formatMatchTime } from '@/lib/utils/datetime'

export type SignupPolicyReason = 'priority_window' | 'reserved' | 'cooldown'

interface SignupPolicyNoticeViewProps {
  reason: SignupPolicyReason
  // When the policy stops applying: the end of the priority window, or the
  // moment reserved spots are released. Null for the cooldown.
  untilIso: string | null
  timeZone: string
  threshold: number
  reservedSpots: number
}

const ICONS: Record<SignupPolicyReason, LucideIcon> = {
  priority_window: Hourglass,
  reserved: Lock,
  cooldown: UserX,
}

export function SignupPolicyNoticeView({
  reason,
  untilIso,
  timeZone,
  threshold,
  reservedSpots,
}: SignupPolicyNoticeViewProps) {
  const t = useT()
  const Icon = ICONS[reason]

  // Formatted here, in the client component, with the deterministic zone-aware
  // helpers: the member sees the group's wall clock and the server render
  // matches the browser byte for byte (docs/rework-plan.md, datetime.ts).
  const when = untilIso
    ? { date: formatMatchDateShort(untilIso, timeZone), time: formatMatchTime(untilIso, timeZone) }
    : { date: '', time: '' }
  const thresholdLabel = threshold.toFixed(1)

  let title: string
  let body: string
  switch (reason) {
    case 'priority_window':
      title = t('signupPolicy.priorityWindowUntil', when)
      body = t('signupPolicy.priorityWindowBody', { threshold: thresholdLabel })
      break
    case 'reserved':
      title = t('signupPolicy.reservedUntil', when)
      body = t('signupPolicy.reservedBody', { threshold: thresholdLabel, spots: reservedSpots })
      break
    case 'cooldown':
      title = t('signupPolicy.cooldownTitle')
      body = t('signupPolicy.cooldownBody')
      break
  }

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3"
    >
      <Icon className="h-5 w-5 mt-0.5 shrink-0 text-yellow-600" />
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-yellow-700 dark:text-yellow-500">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}
