import * as React from 'react'
import { Star } from 'lucide-react'
import type { PlacedPlayer } from '@/lib/formations'
import { CHALK, PITCH, TEAM_DARK, TEAM_LIGHT, TEAM_LIGHT_INK } from '@/lib/brand'
import { cn } from '@/lib/utils/cn'

// Pitch (docs/ui-rework/04-components.md §2, 03-screens.md §4): the coach's
// board. Replaces LineupField's green gradient with the board ground, dashed
// chalk markings and dots with initials. Server-safe: no hooks, no client
// directive, so both the client teams view and server pages can render it.
//
// Coordinates come from src/lib/formations.ts (`placePlayersInFormation`):
// slot.x / slot.y are percentages of a single half-pitch, goalkeeper at the
// bottom, attacking up. With `both`, the dark team keeps that orientation in
// the bottom half and the light team is rotated 180° into the top half.
//
// The pitch is always a board (PITCH / CHALK from src/lib/brand.ts), in both
// themes, so every colour here is an inline fixed brand colour, not a token.

export interface PitchPlayer {
  id?: string
  /** What goes under the dot and feeds the initials: nickname or first name. */
  name: string
  /** Assigned position; used by placePlayersInFormation. */
  position: string
  /** Overall rating, shown only when `showRatings` is set. */
  rating?: number
}

export type PitchTeam = 'dark' | 'light'
export type PitchLabels = 'name' | 'position' | 'both'

export interface PitchProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** One team on a half pitch (attacking up). */
  players?: PlacedPlayer<PitchPlayer>[]
  team?: PitchTeam
  /** Two teams on one board: dark from the bottom half, light mirrored on top. */
  both?: { dark: PlacedPlayer<PitchPlayer>[]; light: PlacedPlayer<PitchPlayer>[] }
  showRatings?: boolean
  labels?: PitchLabels
  /** Team names for the accessible summary ("Oscuras: Nico, Juanma, …"). */
  teamNames?: { dark: string; light: string }
  /** Text shown on an empty board. */
  emptyLabel?: string
  className?: string
}

export function initialsOf(name: string): string {
  return name.trim().slice(0, 2).toUpperCase()
}

// Map a half-pitch slot (y 14..86, GK at 86) into the bottom or top half of
// the combined board, leaving room for the dot and its label at both ends.
function combinedY(y: number, half: 'bottom' | 'top'): number {
  const t = (Math.min(86, Math.max(14, y)) - 14) / 72 // 0 = forwards, 1 = keeper
  const bottom = 55 + t * 37 // 55 (striker) .. 92 (keeper)
  return half === 'bottom' ? bottom : 100 - bottom
}

interface DotProps {
  placed: PlacedPlayer<PitchPlayer>
  team: PitchTeam
  x: number
  y: number
  showRatings: boolean
  labels: PitchLabels
}

function Dot({ placed, team, x, y, showRatings, labels }: DotProps) {
  const { player, slot } = placed
  const dark = team === 'dark'
  return (
    <li
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <span
        className="flex h-[26px] w-[26px] items-center justify-center rounded-full font-display text-[10px] font-extrabold leading-none lg:h-8 lg:w-8 lg:text-[11px]"
        style={{
          backgroundColor: dark ? TEAM_DARK : TEAM_LIGHT,
          color: dark ? TEAM_LIGHT : TEAM_LIGHT_INK,
          border: `2px solid ${CHALK}`,
        }}
      >
        {initialsOf(player.name)}
      </span>
      <span
        className="mt-0.5 flex flex-col items-center whitespace-nowrap font-mono text-[9px] font-medium leading-[11px]"
        style={{ color: TEAM_LIGHT, textShadow: '0 1px 2px rgba(0,0,0,.7)' }}
      >
        {labels !== 'position' && <span>{player.name}</span>}
        {labels !== 'name' && (
          <span style={{ color: CHALK }} className="text-[8px] tracking-[.08em]">
            {slot.position}
          </span>
        )}
        {showRatings && typeof player.rating === 'number' && (
          <span className="flex items-center gap-0.5 tabular-nums">
            <Star className="h-2 w-2" strokeWidth={2} fill="currentColor" aria-hidden="true" />
            {player.rating.toFixed(1)}
          </span>
        )}
      </span>
    </li>
  )
}

// Chalk markings. The viewBox matches the board's aspect ratio so nothing is
// stretched; strokes and dashes are in screen pixels (non-scaling) so the
// chalk line reads the same at 358px and at 600px.
function Markings({ both }: { both: boolean }) {
  const W = 300
  const H = both ? 355 : 400
  const inset = 6
  const boxW = W * 0.5
  // Deep enough that the striker's dot and label sit inside the box line.
  const boxH = H * (both ? 0.17 : 0.24)
  const r = both ? 34 : 38
  const stroke = {
    fill: 'none',
    stroke: CHALK,
    strokeWidth: 1.5,
    strokeDasharray: '6 4',
    vectorEffect: 'non-scaling-stroke' as const,
  }
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <rect x={inset} y={inset} width={W - inset * 2} height={H - inset * 2} rx={2} {...stroke} />
      <line x1={inset} y1={H / 2} x2={W - inset} y2={H / 2} {...stroke} />
      <circle cx={W / 2} cy={H / 2} r={r} {...stroke} />
      <rect x={(W - boxW) / 2} y={inset} width={boxW} height={boxH} {...stroke} />
      <rect x={(W - boxW) / 2} y={H - inset - boxH} width={boxW} height={boxH} {...stroke} />
    </svg>
  )
}

function namesOf(list: PlacedPlayer<PitchPlayer>[]): string {
  return list.map((p) => p.player.name).join(', ')
}

export function Pitch({
  players,
  team = 'dark',
  both,
  showRatings = false,
  labels = 'name',
  teamNames,
  emptyLabel,
  className,
  ...props
}: PitchProps) {
  const teams: Array<{ team: PitchTeam; list: PlacedPlayer<PitchPlayer>[]; half?: 'bottom' | 'top' }> = both
    ? [
        { team: 'dark', list: both.dark, half: 'bottom' },
        { team: 'light', list: both.light, half: 'top' },
      ]
    : [{ team, list: players ?? [] }]

  const isEmpty = teams.every((t) => t.list.length === 0)
  const label = teams
    .map((t) => {
      const name = teamNames?.[t.team] ?? t.team
      return `${name}: ${namesOf(t.list) || '—'}`
    })
    .join('. ')

  return (
    <div className={cn('relative w-full', className)} {...props}>
      <div
        role="img"
        aria-label={label}
        className={cn(
          'relative w-full overflow-hidden rounded-sm',
          both ? 'aspect-[3/3.55]' : 'aspect-[3/4]'
        )}
        style={{ backgroundColor: PITCH }}
      >
        <Markings both={!!both} />
        {teams.map((t) => (
          <ul key={t.team} className="absolute inset-0 m-0 list-none p-0" aria-hidden="true">
            {t.list.map((placed, i) => {
              const rotated = t.half === 'top'
              const x = rotated ? 100 - placed.slot.x : placed.slot.x
              const y = t.half ? combinedY(placed.slot.y, t.half) : placed.slot.y
              return (
                <Dot
                  key={placed.player.id ?? `${t.team}-${i}`}
                  placed={placed}
                  team={t.team}
                  x={x}
                  y={y}
                  showRatings={showRatings}
                  labels={labels}
                />
              )
            })}
          </ul>
        ))}
        {isEmpty && emptyLabel && (
          <p
            className="absolute inset-0 flex items-center justify-center font-mono text-xs"
            style={{ color: CHALK }}
          >
            {emptyLabel}
          </p>
        )}
      </div>
      {/* Screen-reader roster: the role="img" above summarises, this lists. */}
      {teams.map((t) => (
        <ul key={t.team} className="sr-only" aria-label={teamNames?.[t.team] ?? t.team}>
          {t.list.map((placed, i) => (
            <li key={placed.player.id ?? i}>
              {placed.player.name} ({placed.slot.position})
            </li>
          ))}
        </ul>
      ))}
    </div>
  )
}
