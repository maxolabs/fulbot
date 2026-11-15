'use client'

import { ErrorScreen } from '@/app/(auth)/error-screen'

// Error boundary for the public match page (opened from WhatsApp, often in
// the standalone PWA, where a blank screen is a dead end).
export default function PublicMatchError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorScreen error={error} reset={reset} />
}
