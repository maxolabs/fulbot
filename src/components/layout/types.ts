// Shared shapes for the shell (docs/ui-rework/04-components.md §3). Plain
// types, importable from server and client modules alike.

export type ShellRole = 'admin' | 'captain' | 'member'

export interface ShellUser {
  name: string
  email: string
  avatar_url?: string | null
}

export interface ShellGroup {
  slug: string
  name: string
  role: ShellRole
}

export interface ShellCurrentGroup extends ShellGroup {
  /** Members the user still has to rate in this group. */
  pendingRatings: number
  /** The next non-finished match, target of the `Partido` tab. */
  nextMatchId?: string
}
