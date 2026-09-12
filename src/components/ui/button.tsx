'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils/cn'

// Pizarra buttons (docs/ui-rework/04-components.md §1): solid 3px corners,
// 44px tall on phones and 40px in the browser. `default` is the one cone
// orange fill per screen and always carries dark ink; everything else is a
// chalk outline, a flat surface or text. No glow, no shadow.
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[3px] text-sm font-semibold transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:brightness-105',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border border-border bg-transparent text-foreground hover:bg-accent',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-4 lg:h-10',
        sm: 'h-9 px-3',
        lg: 'h-11 px-6',
        xl: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    // `asChild` renders the single child element (typically a <Link>) with the
    // button classes merged in, so server pages get link-styled buttons
    // without calling `buttonVariants` from a client module.
    if (asChild && React.isValidElement(props.children)) {
      const { children, ...rest } = props
      const child = children as React.ReactElement<{ className?: string }>
      return React.cloneElement(child, {
        ...rest,
        className: cn(buttonVariants({ variant, size, className }), child.props.className),
      })
    }
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
