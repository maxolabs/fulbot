# 05 · Plan, verification, non-goals, open questions

## 1. Tracks

Ordered so each track leaves `main` shippable. U0 and U1 are sequential; U2–U4 can run in
parallel worktrees after U1 merges.

| Track | Scope | Touches | Done when |
|---|---|---|---|
| **U0 Foundation** | Tokens (`01-brand.md` §1), fonts, Tailwind config, restyled primitives, new `ui/*` primitives except `pitch`, remove glow, replace colour literals in shared components | `globals.css`, `tailwind.config.ts`, `layout.tsx`, `components/ui/*` | App runs with the new look on the old shell; no page is broken; `grep` for colour literals is clean in `components/` |
| **U1 Shell** | `AppShell`, `Sidebar`, `TopBar`, `TabBar`, `ActionBar`, `PageHeader`, `PublicFrame`, `GroupSwitcher`, `Wordmark`, `fulbot_group` cookie, single-group redirect on `/groups`, delete `header.tsx` | `(dashboard)/layout.tsx`, `components/layout/*`, `(auth)/*`, `/m`, `/invite`, `/` | Every route renders inside the right shell at 390px and 1280px; tab bar hidden on `new`/`edit` |
| **U2 Group and match** | Screens §1, §2, §3, §5, §6 of `03-screens.md`: dashboard two-column + mobile tiles, match hero, roster rows, action bar wiring, admin sheet/popover, announcement and guest form placement, matches list | `groups/page.tsx`, `groups/[slug]/page.tsx`, `matches/*` (not `teams/`) | Screenshot parity with mockups C §2 and C §3 |
| **U3 Pitch and export** | `ui/pitch.tsx`, teams screen (§4), delete `lineup-field.tsx`, export image restyle with bundled fonts, PWA icons and manifest, favicon | `teams/*`, `api/export/lineup-image/route.tsx`, `public/*`, `src/assets/fonts/*` | Exported PNG and the mobile teams screen match mockup C §4; icons pass a maskable check |
| **U4 Everything else** | Screens §7–§12: players, player detail, rate, group settings, profile (`Yo` tab rows), preferences (theme labels), notifications, auth, landing, public match, invite | remaining pages | No page still uses a colour literal, `Inter`, or the old header spacing |

Estimated size: U0 ~1 day, U1 ~1.5 days, U2 ~1.5 days, U3 ~1 day, U4 ~1.5 days.

## 2. Dependencies

None new. Fonts through `next/font/google` (already a dependency via `next`). The two
`.ttf` files for the export route are static assets, not packages. `Sheet` and `Popover`
are hand-rolled on `<dialog>` and the existing backdrop pattern.

## 3. Verification

- `npm run type-check && npm run lint && npm run build` per track, in the worktree.
- Visual: Playwright screenshots at `390×844` (iPhone) and `1280×800` for `/groups`,
  the dashboard, the match (open, full, finished), the teams screen, `/m/[id]` and `/login`,
  in both themes, against the local Supabase stack with the seed (`nico@test.local`).
  Store them under the track's scratchpad and attach the paths to the report; they are
  not committed.
- Manual checklist per screen: one orange element; nothing clipped under the action bar
  (`pb-32`); tab bar respects the safe area; back link from a deep link lands on the
  group, not on a blank history.
- Accessibility floor: 4.5:1 for chalk on board (`#F3F0E6` on `#173129` = 12.3:1), muted
  chalk on board (`#9FB4A8` on `#173129` = 6.0:1), dark ink on cone (`#1A1A1A` on
  `#FF8A3D` = 8.4:1); focus rings visible on every interactive element; the tab bar has
  `aria-current="page"`.

## 4. Non-goals

- No new features, RPCs, migrations or route changes. Results and member scoring are
  restyled as they are.
- No rename: "fulbot" stays in copy, cookies (`fulbot_theme`, `fulbot_group`), manifest and
  metadata. If a rename happens later it is a separate, mostly mechanical pass.
- No animation system. Sheets slide up (150ms), everything else is instant;
  `prefers-reduced-motion` disables the slide.
- No English-copy pass; the i18n keys stay, only new UI strings are added (in `es.json`
  and `en.json`).
- No drag-and-drop redesign; `DraggableTeams` gets tokens only.

## 5. Open questions for the owner

1. **Public pages on the board regardless of theme?** `03-screens.md` §12 forces the board
   on `/m`, `/invite`, auth. Alternative: honour the cookie for signed-in visitors. The
   spec assumes the board.
2. **`Partido` tab target when the group has no upcoming match**: matches list (assumed)
   or the last finished match with its result?
3. **Single-group redirect** from `/groups` to the dashboard (assumed yes). It makes the
   group list one tap further for the few users with two groups.
4. **Ratings on the mobile teams pitch** for admins/captains: assumed hidden on the
   combined pitch (it is the one that gets screenshotted), visible in the browser view.
5. **Landing `/`**: keep it (assumed, restyled) or redirect to `/login` now that invites
   are the real entry point.
