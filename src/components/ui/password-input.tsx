'use client'

import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'
import { Input, type InputProps } from './input'

export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<InputProps, 'type'>>(
  ({ className, disabled, ...props }, ref) => {
    const t = useT()
    const [visible, setVisible] = React.useState(false)
    const Icon = visible ? EyeOff : Eye

    return (
      <div className="relative">
        <Input {...props} ref={ref} type={visible ? 'text' : 'password'} disabled={disabled} className={cn('pr-12', className)} />
        <button
          type="button"
          disabled={disabled}
          aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
          aria-controls={props.id}
          onClick={() => setVisible((value) => !value)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    )
  }
)
PasswordInput.displayName = 'PasswordInput'
