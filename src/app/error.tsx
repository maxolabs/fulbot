'use client'

import { ErrorScreen } from '@/app/(auth)/error-screen'

// Error boundary for the pages directly under the root layout (landing, login,
// register, password screens). It renders inside the root layout, so the
// theme, fonts and stylesheet are all there; global-error.tsx is left for a
// failure of the root layout itself.
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorScreen error={error} reset={reset} />
}
