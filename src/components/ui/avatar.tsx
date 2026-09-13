'use client'

import * as React from 'react'
import { cn } from '@/lib/utils/cn'
import { initials as initialsOf } from '@/lib/utils/initials'

// Pizarra avatar (docs/ui-rework/04-components.md §1). Initials in the display
// face on a raised surface; the circle is the one shape that is not squared.
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string | null
  alt?: string
  fallback: string
  /** `xl` is an alias of `lg` kept for older callers. */
  size?: AvatarSize
}

const sizeClasses: Record<AvatarSize, string> = {
  xs: 'h-[22px] w-[22px] text-[10px]',
  sm: 'h-7 w-7 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-16 w-16 text-xl',
  xl: 'h-16 w-16 text-xl',
}

export function Avatar({
  src,
  alt,
  fallback,
  size = 'md',
  className,
  ...props
}: AvatarProps) {
  const [imageError, setImageError] = React.useState(false)

  const initials = initialsOf(fallback)

  if (src && !imageError) {
    return (
      <div
        className={cn(
          'relative shrink-0 overflow-hidden rounded-full bg-secondary',
          sizeClasses[size],
          className
        )}
        {...props}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt || fallback}
          className="h-full w-full object-cover"
          onError={() => setImageError(true)}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-full bg-secondary font-display font-bold leading-none text-foreground',
        sizeClasses[size],
        className
      )}
      aria-label={alt || fallback}
      {...props}
    >
      {initials}
    </div>
  )
}
