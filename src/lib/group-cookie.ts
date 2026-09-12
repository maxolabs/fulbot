// The "current group" memory (docs/ui-rework/02-shell.md §3): the last
// visited group slug, set by the middleware on every /groups/[slug] request
// and read by the dashboard layout to feed the tab bar on routes that have
// no slug (/profile, /notifications, /settings).
export const GROUP_COOKIE = 'fulbot_group'
export const GROUP_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

const GROUP_PATH = /^\/groups\/([A-Za-z0-9_-]+)(?:\/|$)/

/** The group slug a pathname is inside of, or null (`/groups/new` is not a group). */
export function groupSlugFromPathname(pathname: string): string | null {
  const m = pathname.match(GROUP_PATH)
  if (!m || m[1] === 'new') return null
  return m[1]
}
