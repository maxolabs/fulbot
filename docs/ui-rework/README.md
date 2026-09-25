# UI rework — "Pizarra" on fulbot

Spec folder for the visual and structural rework of the app. Written 2026-09-11 on top of
main `5650474` (PRs #1–#3 merged: peer ratings, crowd-sourced results, member scoring).

## Decisions (owner, 2026-09-11)

1. **Visual direction: C · Pizarra** (chalkboard). See `branding-proposals.html`, section
   "Direction C", for the mockups this spec is derived from. The other four directions and
   the name proposals stay in that file for reference.
2. **Name stays "fulbot" for now.** The wordmark and icon are redrawn in the Pizarra
   language; no route, cookie, storage key or copy changes because of the name. The names
   section of the proposals doc is the shortlist if this is revisited.
3. **Two shells, one app.** A sidebar shell for the browser (`lg` and up) and a tab-bar shell
   for phones. Same routes, same components, same tokens.
4. **Dark-first stays the default** (the board). Light mode becomes "papel": chalk-cream
   ground with board-green ink, same cone orange.

## Files

| File | What it fixes |
|---|---|
| `01-brand.md` | Tokens (light and dark, as the existing HSL variables), type, shape, wordmark, icon, manifest, exported image |
| `02-shell.md` | Browser sidebar shell, mobile tab-bar shell, top bar, sticky action bar, breakpoints, current-group memory |
| `03-screens.md` | Screen-by-screen anatomy: what each page shows in the browser and on a phone |
| `04-components.md` | Changes to `src/components/ui/*` and the new layout components, with props |
| `05-plan.md` | Tracks, order, verification, non-goals, open questions |
| `06-principles.md` | Resolved open questions, hierarchy/density/state/motion/a11y rules, code conventions for the tracks |
| `branding-proposals.html` | The five directions and the name proposals (standalone, open in a browser) |

## Scope in one paragraph

Restyle every screen in `src/app` to the Pizarra tokens and type, replace the single top
header with a responsive shell, make the match and lineup screens phone-first with a sticky
primary action, and redraw the pitch, the exported lineup image, the PWA icon and the
manifest in the same language. No new features, no database changes, no route changes.
Feature work that is in flight (results, member scoring) is restyled, not redesigned.

## Conventions carried over from `docs/rework-plan.md` §1

Spanish UI in "vos" form, mobile-first, reuse `src/components/ui/*`, typed Supabase client,
no new dependencies unless listed in `05-plan.md`, no background processes, and
`npm run type-check && npm run lint && npm run build` green before reporting done.
