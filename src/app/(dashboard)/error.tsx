'use client'

import { ErrorScreen } from '@/app/(auth)/error-screen'

// Error boundary for every signed-in screen: renders inside the shell (the
// layout and its LanguageProvider stay mounted), with retry and /groups.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorScreen error={error} reset={reset} framed={false} />
}
