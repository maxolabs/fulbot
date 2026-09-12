'use client'

import * as React from 'react'

// TopBarSlot (docs/ui-rework/04-components.md §3): the mobile top bar reads
// its title / back / action from this context, and pages write to it from a
// small client leaf. Server pages drop `<TopBarConfig title=… back=… />`
// anywhere in their JSX; client components may call `useTopBar(...)`.
// The config is reset when the leaf unmounts, so the next route starts from
// the default (wordmark, no back, no action).

export interface TopBarConfigValue {
  title?: React.ReactNode
  /** `true` = history back; a string = explicit href (preferred for deep links). */
  back?: string | true
  action?: React.ReactNode
  /** Show the wordmark instead of a title. */
  brand?: boolean
}

const EMPTY: TopBarConfigValue = {}

const TopBarStateContext = React.createContext<TopBarConfigValue>(EMPTY)
const TopBarSetterContext = React.createContext<((v: TopBarConfigValue) => void) | null>(null)

export function TopBarProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = React.useState<TopBarConfigValue>(EMPTY)
  return (
    <TopBarSetterContext.Provider value={setConfig}>
      <TopBarStateContext.Provider value={config}>{children}</TopBarStateContext.Provider>
    </TopBarSetterContext.Provider>
  )
}

/** What the top bar should currently show. */
export function useTopBarState(): TopBarConfigValue {
  return React.useContext(TopBarStateContext)
}

/**
 * Publish the top bar config for the page that calls this. Call it from a
 * client component that lives for the whole page (or use <TopBarConfig />).
 */
export function useTopBar({ title, back, action, brand }: TopBarConfigValue) {
  const set = React.useContext(TopBarSetterContext)
  React.useEffect(() => {
    if (!set) return
    set({ title, back, action, brand })
    return () => set(EMPTY)
    // React elements passed as title/action get a new identity on every
    // render of the page; that is fine, the effect just re-publishes them.
  }, [set, title, back, action, brand])
}

/** Leaf component so server pages can set the top bar from JSX. Renders nothing. */
export function TopBarConfig(props: TopBarConfigValue) {
  useTopBar(props)
  return null
}
