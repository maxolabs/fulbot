'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet } from '@/components/ui/sheet'
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { GripVertical, Save, Search, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice, NativeSelect } from '@/components/form-controls'
import { createClient } from '@/lib/supabase/client'
import { TEAM_DARK, TEAM_LIGHT, TEAM_LIGHT_INK } from '@/lib/brand'
import { useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'
import { assignmentPayload, draftProblem, movePlayer, POSITIONS, syncRoster, type BuilderPlayer, type TeamDraft, type TeamSlot } from '@/lib/teams/manual'
import type { Json } from '@/types/database'

function PlayerCard({ player, team, disabled, onMove, onPosition }: {
  player: BuilderPlayer; team: TeamSlot; disabled: boolean
  onMove: (team: TeamSlot) => void; onPosition: (position: string) => void
}) {
  const t = useT()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: player.id, disabled })
  return (
    <li ref={setNodeRef} className={cn('rounded-md border border-border bg-card p-3', isDragging && 'opacity-30')}>
      <div className="flex items-start gap-2">
        <button type="button" {...attributes} {...listeners} disabled={disabled}
          aria-label={t('ui.builder.drag', { name: player.displayName })}
          className="-ml-2 -mt-2 flex h-11 w-8 shrink-0 touch-none items-center justify-center rounded-sm text-muted-foreground hover:bg-accent active:cursor-grabbing">
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold">{player.displayName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{player.guestPlayerId ? t('ui.guest') : player.nickname && player.nickname !== player.displayName ? player.nickname : player.mainPosition} · {player.overallRating.toFixed(1)}</p>
        </div>
      </div>
      {team === 'pool' ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(['dark', 'light'] as const).map((destination) => (
            <Button key={destination} type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onMove(destination)} aria-label={t('ui.builder.assignTo', { name: player.displayName, team: t(`ui.teamsScreen.${destination}`) })}>
              {t(`ui.teamsScreen.${destination}`)}
            </Button>
          ))}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <NativeSelect value={player.position} disabled={disabled} wrapperClassName="min-w-0 flex-1" className="h-10 px-2 text-xs" aria-label={t('ui.builder.positionFor', { name: player.displayName })} onChange={(e) => onPosition(e.target.value)}>
            {POSITIONS.map((position) => <option key={position} value={position}>{position}</option>)}
          </NativeSelect>
          <NativeSelect value={team} disabled={disabled} wrapperClassName="min-w-0 flex-1 basis-24" className="h-10 text-xs" aria-label={t('ui.builder.teamFor', { name: player.displayName })} onChange={(e) => onMove(e.target.value as TeamSlot)}>
            <option value="dark">{t('ui.teamsScreen.dark')}</option>
            <option value="light">{t('ui.teamsScreen.light')}</option>
            <option value="pool">{t('ui.teamsScreen.unassigned')}</option>
          </NativeSelect>
        </div>
      )}
    </li>
  )
}

function TeamZone({ team, players, children, disabled, activeSlot }: { team: TeamSlot; players: BuilderPlayer[]; children: React.ReactNode; disabled: boolean; activeSlot: TeamSlot }) {
  const t = useT()
  const { setNodeRef, isOver } = useDroppable({ id: team, disabled })
  const average = players.length ? players.reduce((sum, p) => sum + p.overallRating, 0) / players.length : 0
  return (
    <section ref={setNodeRef} aria-label={t(team === 'pool' ? 'ui.teamsScreen.unassigned' : `ui.teamsScreen.${team}`)} className={cn('min-w-0 rounded-md border border-border bg-card lg:block', activeSlot !== team && 'hidden', isOver && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-md border-b border-border p-3" style={team === 'pool' ? undefined : { backgroundColor: team === 'dark' ? TEAM_DARK : TEAM_LIGHT, color: team === 'dark' ? TEAM_LIGHT : TEAM_LIGHT_INK }}>
        <h3 className="font-display text-base font-bold">{t(team === 'pool' ? 'ui.teamsScreen.unassigned' : `ui.teamsScreen.${team}`)}</h3>
        <span className="font-mono text-xs tabular-nums">{players.length}</span>
        {team !== 'pool' && <p className="w-full text-xs">{t('ui.teamsScreen.level', { n: average.toFixed(1) })}</p>}
      </div>
      <div className="min-h-28 space-y-3 p-2 sm:p-3">{children}</div>
    </section>
  )
}

export function DraggableTeams({ matchId, darkPlayers, lightPlayers, unassignedPlayers, hasTeams, onSaved, onCancel }: {
  matchId: string; darkPlayers: BuilderPlayer[]; lightPlayers: BuilderPlayer[]; unassignedPlayers: BuilderPlayer[]
  hasTeams: boolean; onSaved: () => void; onCancel: () => void
}) {
  const t = useT()
  const router = useRouter()
  const [discardTarget, setDiscardTarget] = useState<string | null>(null)
  const [draft, setDraft] = useState<TeamDraft>({ pool: unassignedPlayers, dark: darkPlayers, light: lightPlayers })
  const [activeSlot, setActiveSlot] = useState<TeamSlot>(unassignedPlayers.length ? 'pool' : 'dark')
  const [active, setActive] = useState<BuilderPlayer | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor))
  const total = draft.pool.length + draft.dark.length + draft.light.length
  const problem = draftProblem(draft)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // The editor replaces the button that opened it; keep keyboard focus here.
  useEffect(() => { headingRef.current?.focus() }, [])

  // A refresh after a failed save may bring a changed confirmed roster:
  // merge it instead of discarding the captain's work.
  const roster = [...unassignedPlayers, ...darkPlayers, ...lightPlayers]
  const rosterKey = roster.map((p) => p.id).sort().join(',')
  const seenRoster = useRef(rosterKey)
  useEffect(() => {
    if (seenRoster.current === rosterKey) return
    seenRoster.current = rosterKey
    setDraft((current) => syncRoster(current, roster))
    // `roster` is rebuilt every render; its identity is captured by rosterKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey])

  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const beforeNavigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) return
      const destination = new URL(link.href, window.location.href)
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return
      event.preventDefault()
      event.stopPropagation()
      setDiscardTarget(destination.href)
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', beforeNavigate, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', beforeNavigate, true)
    }
  }, [dirty, t])

  const move = (id: string, destination: TeamSlot) => {
    if (saving) return
    const player = [...draft.pool, ...draft.dark, ...draft.light].find((p) => p.id === id)
    setDraft((current) => movePlayer(current, id, destination))
    setDirty(true)
    // Assigning the last unplaced player leaves an empty pool tab on mobile.
    if (activeSlot === 'pool' && destination !== 'pool' && draft.pool.length === 1) setActiveSlot(destination)
    if (player) setAnnouncement(t('ui.builder.moved', { name: player.displayName, team: t(destination === 'pool' ? 'ui.teamsScreen.unassigned' : `ui.teamsScreen.${destination}`) }))
  }
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActive(null)
    if (over && ['pool', 'dark', 'light'].includes(String(over.id))) move(String(active.id), over.id as TeamSlot)
  }
  const save = async () => {
    if (problem || saving) return
    setSaving(true)
    setError(null)
    try {
      const { error } = await createClient().rpc('publish_match_teams', {
        p_match_id: matchId,
        p_assignments: assignmentPayload(draft) as unknown as Json,
        p_snapshot: null,
      })
      if (error) throw error
      setDirty(false)
      onSaved()
    } catch (error) {
      console.error('Error publishing teams:', error)
      // Database messages are Spanish-only; the most common cause is a
      // roster change, so refresh it and let the captain review and retry.
      setError(t('ui.builder.saveError'))
      router.refresh()
    } finally { setSaving(false) }
  }
  const cancel = () => {
    if (dirty) setDiscardTarget('cancel')
    else onCancel()
  }

  return (
    <div className="space-y-5 pb-28" aria-busy={saving}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-xl font-bold focus:outline-none lg:sr-only">{t('ui.builder.title')}</h2>
          <p className="max-w-xl text-sm text-muted-foreground">{t('ui.builder.instructions')}</p>
        </div>
        <Button type="button" variant="outline" onClick={cancel} disabled={saving}><X className="h-4 w-4" aria-hidden="true" />{t('common.cancel')}</Button>
      </div>
      <p className="sr-only" role="status">{announcement}</p>
      {error && <FormNotice kind="error">{error}</FormNotice>}
      <div className="sticky top-12 z-20 -mx-4 grid grid-cols-3 gap-1 border-y border-border bg-background px-4 py-2 lg:hidden" role="group" aria-label={t('ui.builder.title')}>
        {(['pool', 'dark', 'light'] as const).map((slot) => (
          <button key={slot} type="button" aria-pressed={activeSlot === slot} onClick={() => setActiveSlot(slot)} className={cn('min-h-12 rounded-sm px-1 py-2 text-xs transition-colors', activeSlot === slot ? 'bg-accent font-semibold text-foreground ring-1 ring-border' : 'text-muted-foreground hover:bg-accent')}>
            {t(slot === 'pool' ? 'ui.teamsScreen.unassigned' : `ui.teamsScreen.${slot}`)} <span className="ml-1 font-mono tabular-nums">{draft[slot].length}</span>
          </button>
        ))}
      </div>
      <DndContext accessibility={{ announcements: {
        onDragStart: ({ active }) => t('ui.builder.drag', { name: [...draft.pool, ...draft.dark, ...draft.light].find((p) => p.id === active.id)?.displayName ?? '' }),
        onDragOver: () => undefined,
        onDragEnd: () => undefined,
        onDragCancel: () => t('common.cancel'),
      } }} sensors={sensors} collisionDetection={closestCenter} onDragStart={({ active }) => setActive([...draft.pool, ...draft.dark, ...draft.light].find((p) => p.id === active.id) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          {(['pool', 'dark', 'light'] as const).map((team) => {
            const list = draft[team].filter((player) => team !== 'pool' || `${player.displayName} ${player.nickname ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
            return (
              <TeamZone key={team} team={team} players={draft[team]} disabled={saving} activeSlot={activeSlot}>
                {team === 'pool' && draft.pool.length > 0 && <div className="relative"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" /><Input value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('ui.builder.search')} placeholder={t('ui.builder.search')} className="pl-9" /></div>}
                <ul className="space-y-2">
                  {list.map((player) => <PlayerCard key={player.id} player={player} team={team} disabled={saving} onMove={(destination) => move(player.id, destination)} onPosition={(position) => { setDraft((current) => ({ ...current, [team]: current[team].map((p) => p.id === player.id ? { ...p, position } : p) })); setDirty(true) }} />)}
                </ul>
                {list.length === 0 && <p className="px-2 py-5 text-center text-sm text-muted-foreground">{t(team === 'pool' ? draft.pool.length ? 'ui.builder.noResults' : 'ui.builder.allAssigned' : 'ui.builder.dropHere')}</p>}
              </TeamZone>
            )
          })}
        </div>
        <DragOverlay dropAnimation={null}>{active && <div className="rounded-md border-2 border-primary bg-card p-4 text-sm font-semibold">{active.displayName}</div>}</DragOverlay>
      </DndContext>
      <Sheet open={discardTarget !== null} onOpenChange={(open) => { if (!open) setDiscardTarget(null) }} title={t('ui.builder.unsavedTitle')} description={t('ui.builder.discardConfirm')}>
        <div className="flex flex-wrap gap-3 pt-4">
          <Button variant="outline" onClick={() => setDiscardTarget(null)}>{t('ui.builder.keepEditing')}</Button>
          <Button variant="destructive" onClick={() => { const target = discardTarget; setDirty(false); setDiscardTarget(null); if (target === 'cancel') onCancel(); else if (target) router.push(target) }}>{t('ui.builder.discard')}</Button>
        </div>
      </Sheet>
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-card px-4 py-3 lg:left-60 lg:bottom-0">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div aria-live="polite" className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4" aria-hidden="true" />{t('ui.builder.assigned', { n: total - draft.pool.length, total })}</p>
            <p className="mt-1 text-xs text-muted-foreground">{problem ? t(`ui.builder.${problem}`) : t('ui.builder.ready', { dark: draft.dark.length, light: draft.light.length })}</p>
          </div>
          <Button type="button" onClick={save} disabled={!!problem || saving || (hasTeams && !dirty)}>
            {saving ? <Spinner size="sm" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            {t(saving ? 'ui.builder.saving' : hasTeams ? 'common.save' : 'ui.builder.publish')}
          </Button>
        </div>
      </div>
    </div>
  )
}
