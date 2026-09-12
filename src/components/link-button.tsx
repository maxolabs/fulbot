'use client'

import * as React from 'react'
import Link from 'next/link'
import type { VariantProps } from 'class-variance-authority'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'

// A next/link dressed as a Button. `buttonVariants` lives in a 'use client'
// module, so a server component cannot call it (it only receives a client
// reference); server pages render this component instead.

export interface LinkButtonProps
  extends React.ComponentPropsWithoutRef<typeof Link>,
    VariantProps<typeof buttonVariants> {}

export function LinkButton({ className, variant, size, ...props }: LinkButtonProps) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
