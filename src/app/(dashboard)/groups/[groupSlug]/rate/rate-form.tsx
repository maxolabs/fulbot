'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, ChevronUp, Pencil } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Eyebrow } from '@/components/ui/eyebrow'
import { PositionChip } from '@/components/ui/player-row'
import { Spinner } from '@/components/ui/spinner'
import { ActionBar } from '@/components/layout/action-bar'
import { FormNotice } from '@/components/form-controls'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'
import type { Database } from '@/types/database'
import {
  DIMENSION_HINTS,
  DIMENSION_LABELS,
  DIMENSION_SHORT,
  PLAYER_TAGS,
  RATING_DIMENSIONS,
  RATING_SCALE_LABELS,
  tagLabel,
  type RatingDimension,
} from '@/lib/ratings'

// Rating queue (docs/ui-rework/03-screens.md §8). Closed members are rows;
// the one being rated is a dashed card holding the form. The card's own
// "Guardar" / "Omitir" show in the browser; on mobile the same form is
// driven from the ActionBar through the `form` attribute, so the RPC logic
// lives in exactly one place.

export interface RateMember {
  id: string
  displayName: string
  nickname: string | null
  mainPosition: string
}

export interface ExistingRating {
  skipped: boolean
  goalkeeping: number | null
  defense: number | null
  attack: number | null
  physical: number | null
  tags: string[]
  is_baseline: boolean
}

interface RateMembersFormProps {
  groupId: string
  groupSlug: string
  voterPlayerId: string
  isBaseline: boolean
  focusPlayerId: string | null
  members: RateMember[]
  existing: Record<string, ExistingRating>
}

type Draft = {
  dims: Partial<Record<RatingDimension, number>>
  tags: string[]
}

const FORM_ID = 'rate-member-form'

function draftFrom(entry: ExistingRating | undefined): Draft {
  if (!entry || entry.skipped) return { dims: {}, tags: [] }
  return {
    dims: {
      goalkeeping: entry.goalkeeping ?? undefined,
      defense: entry.defense ?? undefined,
      attack: entry.attack ?? undefined,
      physical: entry.physical ?? undefined,
    },
    tags: entry.tags,
  }
}

export function RateMembersForm({
  groupId,
  groupSlug,
  voterPlayerId,
  isBaseline,
  focusPlayerId,
  members,
  existing,
}: RateMembersFormProps) {
  const t = useT()
  const router = useRouter()
  const supabase = createClient()

  const [entries, setEntries] = useState<Record<string, ExistingRating>>(existing)
  const [openId, setOpenId] = useState<string | null>(() => {
    if (focusPlayerId && members.some((m) => m.id === focusPlayerId)) return focusPlayerId
    return members.find((m) => !existing[m.id])?.id ?? null
  })
  const [draft, setDraft] = useState<Draft>(() => draftFrom(openId ? existing[openId] : undefined))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pending first (the focused player at the very top), then skipped, then rated.
  const ordered = useMemo(() => {
    const rank = (m: RateMember) => {
      if (m.id === focusPlayerId) return 0
      const e = entries[m.id]
      if (!e) return 1
      if (e.skipped) return 2
      return 3
    }
    return [...members].sort((a, b) => rank(a) - rank(b))
  }, [members, entries, focusPlayerId])

  const doneCount = members.filter((m) => entries[m.id]).length
  const ratedCount = members.filter((m) => entries[m.id] && !entries[m.id].skipped).length
  const pendingCount = members.length - doneCount

  const open = (playerId: string) => {
    setError(null)
    setOpenId(playerId)
    setDraft(draftFrom(entries[playerId]))
  }

  const advance = (fromId: string, nextEntries: Record<string, ExistingRating>) => {
    const next = ordered.find((m) => m.id !== fromId && !nextEntries[m.id])
    if (next) {
      setOpenId(next.id)
      setDraft(draftFrom(undefined))
    } else {
      setOpenId(null)
    }
  }

  const persist = async (playerId: string, row: ExistingRating) => {
    setSaving(true)
    setError(null)
    try {
      const payload: Database['public']['Tables']['peer_ratings']['Insert'] = {
        group_id: groupId,
        voter_player_id: voterPlayerId,
        rated_player_id: playerId,
        skipped: row.skipped,
        goalkeeping: row.goalkeeping,
        defense: row.defense,
        attack: row.attack,
        physical: row.physical,
        tags: row.tags,
        is_baseline: row.is_baseline,
      }
      const { error: upsertError } = await supabase
        .from('peer_ratings')
        .upsert(payload, { onConflict: 'group_id,voter_player_id,rated_player_id' })
      if (upsertError) throw upsertError

      const nextEntries = { ...entries, [playerId]: row }
      setEntries(nextEntries)
      advance(playerId, nextEntries)
      router.refresh()
    } catch (err) {
      console.error('Error saving rating:', err)
      setError(t('ui.screens.rate.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const draftComplete = RATING_DIMENSIONS.every((dim) => draft.dims[dim] !== undefined)

  const handleSave = (playerId: string) => {
    if (!draftComplete) return
    void persist(playerId, {
      skipped: false,
      goalkeeping: draft.dims.goalkeeping!,
      defense: draft.dims.defense!,
      attack: draft.dims.attack!,
      physical: draft.dims.physical!,
      tags: draft.tags,
      is_baseline: isBaseline,
    })
  }

  const handleSkip = (playerId: string) => {
    void persist(playerId, {
      skipped: true,
      goalkeeping: null,
      defense: null,
      attack: null,
      physical: null,
      tags: [],
      is_baseline: isBaseline,
    })
  }

  const toggleTag = (key: string) => {
    setDraft((d) => ({
      ...d,
      tags: d.tags.includes(key) ? d.tags.filter((t) => t !== key) : [...d.tags, key],
    }))
  }

  if (members.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('ui.screens.rate.noMembers')}</p>
  }

  const progressPct = (doneCount / members.length) * 100

  const renderRow = (member: RateMember) => {
    const entry = entries[member.id]
    const status = !entry ? 'pending' : entry.skipped ? 'skipped' : 'rated'
    return (
      <button
        type="button"
        onClick={() => open(member.id)}
        aria-expanded={false}
        className="flex min-h-11 w-full items-center gap-3 border-b border-border py-2 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Avatar src={null} fallback={member.displayName} size="xs" aria-hidden="true" />
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-sm font-medium">{member.displayName}</span>
          {member.nickname && <span className="truncate text-xs text-muted-foreground">({member.nickname})</span>}
        </span>
        {status === 'rated' && (
          <span className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[.08em] text-muted-foreground sm:flex">
            {RATING_DIMENSIONS.map((dim) => (
              <span key={dim}>
                {DIMENSION_SHORT[dim]} <span className="text-foreground">{entry![dim]}</span>
              </span>
            ))}
          </span>
        )}
        <PositionChip position={member.mainPosition} />
        <Badge variant={status === 'rated' ? 'secondary' : 'outline'}>
          {status === 'pending'
            ? t('ui.screens.rate.statusPending')
            : status === 'skipped'
              ? t('ui.screens.rate.statusSkipped')
              : t('ui.screens.rate.statusRated')}
        </Badge>
        {status === 'pending' ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        )}
      </button>
    )
  }

  const renderOpenCard = (member: RateMember) => (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setOpenId(null)}
          aria-expanded={true}
          className="flex w-full items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <Avatar src={null} fallback={member.displayName} size="md" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-base font-bold leading-tight">
              {member.displayName}
              {member.nickname && (
                <span className="ml-1.5 font-sans text-sm font-normal text-muted-foreground">({member.nickname})</span>
              )}
            </span>
            <span className="mt-1 block">
              <PositionChip position={member.mainPosition} />
            </span>
          </span>
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </CardHeader>
      <CardContent>
        <form
          id={FORM_ID}
          onSubmit={(e) => {
            e.preventDefault()
            handleSave(member.id)
          }}
          className="space-y-5 border-t border-border pt-4"
        >
          {RATING_DIMENSIONS.map((dim) => {
            const value = draft.dims[dim]
            return (
              <div key={dim} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{DIMENSION_LABELS[dim]}</span>
                  <span className="text-xs text-muted-foreground">
                    {value ? RATING_SCALE_LABELS[value] : DIMENSION_HINTS[dim]}
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={DIMENSION_LABELS[dim]}>
                  {[1, 2, 3, 4, 5].map((n) => {
                    const selected = value === n
                    const below = value !== undefined && n < value
                    return (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={`${DIMENSION_LABELS[dim]} ${n}`}
                        onClick={() => setDraft((d) => ({ ...d, dims: { ...d.dims, [dim]: n } }))}
                        className={cn(
                          'h-11 rounded-[3px] border font-mono text-sm tabular-nums transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card lg:h-10',
                          selected
                            ? 'border-foreground bg-accent font-semibold text-foreground'
                            : below
                              ? 'border-border bg-accent/60 text-foreground'
                              : 'border-border text-muted-foreground hover:bg-accent/60'
                        )}
                      >
                        {n}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          <div className="space-y-1.5">
            <p className="text-sm font-medium">
              {t('ui.screens.rate.tagsTitle')}{' '}
              <span className="font-normal text-muted-foreground">{t('ui.screens.rate.optional')}</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PLAYER_TAGS.map((tag) => {
                const active = draft.tags.includes(tag.key)
                return (
                  <button
                    key={tag.key}
                    type="button"
                    onClick={() => toggleTag(tag.key)}
                    aria-pressed={active}
                    className={cn(
                      'rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-[.08em] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                      active
                        ? 'border-foreground bg-accent text-foreground'
                        : 'border-border text-muted-foreground hover:bg-accent/60'
                    )}
                  >
                    {tagLabel(tag.key)}
                  </button>
                )
              })}
            </div>
          </div>

          {error && <FormNotice kind="error">{error}</FormNotice>}

          {/* Browser: the card's own actions. On mobile the ActionBar drives this form. */}
          <div className="hidden items-center justify-end gap-2 lg:flex">
            <Button type="button" variant="ghost" onClick={() => handleSkip(member.id)} disabled={saving}>
              {t('ui.screens.rate.skip')}
            </Button>
            <Button type="submit" disabled={saving || !draftComplete}>
              {saving ? <Spinner size="sm" /> : <Check className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />}
              {t('common.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )

  const openMember = openId ? members.find((m) => m.id === openId) ?? null : null

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="space-y-1.5">
        <div
          role="meter"
          aria-label={t('ui.screens.rate.progress')}
          aria-valuemin={0}
          aria-valuemax={members.length}
          aria-valuenow={doneCount}
          className="h-1.5 w-full overflow-hidden rounded-sm bg-muted"
        >
          <div className="h-full rounded-sm bg-muted-foreground" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="flex items-baseline justify-between gap-3 font-mono text-xs tabular-nums text-muted-foreground">
          <span>
            <strong className="font-medium text-foreground">{doneCount}</strong>{' '}
            {t('ui.screens.rate.progressOf', { total: members.length })}
            {' · '}
            {t('ui.screens.rate.progressRated', { n: ratedCount })}
          </span>
          {pendingCount === 0 ? (
            <Badge variant="success">{t('ui.spots.full')}</Badge>
          ) : (
            <span>{t('ui.screens.rate.progressPending', { n: pendingCount })}</span>
          )}
        </div>
      </div>

      {error && !openMember && <FormNotice kind="error">{error}</FormNotice>}

      {pendingCount === 0 && openId === null && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between lg:pt-5">
            <div>
              <p className="flex items-center gap-2 font-medium">
                <Check className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                {t('ui.screens.rate.doneTitle')}
              </p>
              <p className="text-sm text-muted-foreground">{t('ui.screens.rate.doneHint')}</p>
            </div>
            <Link href={`/groups/${groupSlug}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {t('ui.screens.rate.backToGroup')}
            </Link>
          </CardContent>
        </Card>
      )}

      {openMember && renderOpenCard(openMember)}

      <div className="space-y-2">
        <Eyebrow as="h2">{t('ui.screens.rate.listTitle')}</Eyebrow>
        <ul className="[&>li:last-child>button]:border-b-0">
          {ordered
            .filter((m) => m.id !== openId)
            .map((member) => (
              <li key={member.id}>{renderRow(member)}</li>
            ))}
        </ul>
      </div>

      {openMember && (
        <ActionBar>
          <Button size="xl" type="submit" form={FORM_ID} disabled={saving || !draftComplete}>
            {saving && <Spinner size="sm" />}
            {t('common.save')}
          </Button>
          <Button size="xl" variant="outline" type="button" onClick={() => handleSkip(openMember.id)} disabled={saving}>
            {t('ui.screens.rate.skip')}
          </Button>
        </ActionBar>
      )}
    </div>
  )
}
