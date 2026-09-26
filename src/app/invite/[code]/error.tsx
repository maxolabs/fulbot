'use client'

import { ErrorScreen } from '@/app/(auth)/error-screen'

// Error boundary for the invite landing.
export default function InviteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorScreen error={error} reset={reset} />
}
