import * as React from 'react'
import { BOARD, CHALK, TEAM_LIGHT } from '@/lib/brand'
import { cn } from '@/lib/utils/cn'

// Wordmark and mark (docs/ui-rework/01-brand.md §4). Server-safe: no hooks.
// `ful` in chalk (the foreground token), `bot` in cone, Syne 800, -0.01em.
// The mark is a board-green rounded square with an inset dashed chalk border
// and the `X O` glyphs: a tactics board, not letters. Its colours are fixed
// brand colours from src/lib/brand.ts, so it looks the same in both themes.

export type WordmarkSize = 'sm' | 'md' | 'lg'

export interface WordmarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: WordmarkSize
  withMark?: boolean
}

const textSize: Record<WordmarkSize, string> = {
  sm: 'text-[13px]',
  md: 'text-[15px]',
  lg: 'text-[28px]',
}

const markSize: Record<WordmarkSize, number> = {
  sm: 18,
  md: 22,
  lg: 40,
}

export function Mark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', className)}
    >
      <rect width="100" height="100" rx="22" fill={BOARD} />
      <rect
        x="12"
        y="12"
        width="76"
        height="76"
        rx="12"
        fill="none"
        stroke={CHALK}
        strokeWidth="2"
        strokeDasharray="6 4"
      />
      <text
        x="50"
        y="51"
        textAnchor="middle"
        dominantBaseline="central"
        fill={TEAM_LIGHT}
        fontFamily="var(--font-display), system-ui, sans-serif"
        fontWeight="800"
        fontSize="40"
        letterSpacing="-0.04em"
      >
        X O
      </text>
    </svg>
  )
}

export function Wordmark({ size = 'md', withMark = false, className, ...props }: WordmarkProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)} {...props}>
      {withMark && <Mark size={markSize[size]} />}
      <span
        className={cn(
          'font-display font-extrabold leading-none tracking-[-0.01em] text-foreground',
          textSize[size]
        )}
      >
        ful<span className="text-primary">bot</span>
      </span>
    </span>
  )
}
