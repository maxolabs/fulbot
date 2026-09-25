'use client'

import { useRouter } from 'next/navigation'
import { Segmented } from '@/components/ui/segmented'
import { useT } from '@/i18n/provider'

// Sort control of the players list (docs/ui-rework/03-screens.md §7): a
// segmented control in mono that keeps today's `?sort=score` URL contract,
// so the server page keeps owning the ordering.

export type PlayersSort = 'matches' | 'score'

export function PlayersSortControl({ value, basePath }: { value: PlayersSort; basePath: string }) {
  const t = useT()
  const router = useRouter()

  return (
    <Segmented<PlayersSort>
      aria-label={t('memberScore.sortBy')}
      size="sm"
      value={value}
      onChange={(next) => router.push(next === 'score' ? `${basePath}?sort=score` : basePath)}
      options={[
        { value: 'matches', label: t('memberScore.sortByMatches') },
        { value: 'score', label: t('memberScore.sortByScore') },
      ]}
    />
  )
}
