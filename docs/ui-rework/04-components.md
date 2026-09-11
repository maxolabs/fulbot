# 04 · Components

Everything stays in `src/components`. `ui/*` keeps the cva pattern. New layout pieces go in
`src/components/layout/`. Props listed are the contract; internals are free.

## 1. Restyled primitives (`src/components/ui`)

| Component | Change |
|---|---|
| `button.tsx` | Base: `rounded` (3px), `font-semibold text-sm`, `h-11` default on mobile and `lg:h-10`. `default` = cone bg + dark ink, no glow. `outline` = `border-border bg-transparent text-foreground hover:bg-accent` (chalk outline). `secondary` = `bg-secondary`. `ghost`, `link`, `destructive` as today. New size `xl` (`h-12 text-base`) for action bars. |
| `card.tsx` | Adds `variant`: `chalk` (default: `border border-dashed border-border bg-card rounded-md`) and `solid` (solid border, for nested/admin cards). `CardTitle` renders in `font-display text-base font-bold`. Padding `p-4 lg:p-5` (down from `p-6`). |
| `badge.tsx` | `rounded-sm`, mono 10px uppercase tracking. Variants map to tokens: `default` cone, `secondary`, `success` (`bg-success text-success-foreground`), `warning`, `destructive`, `outline`. Remove the `green-500` / `yellow-500` literals. |
| `input.tsx`, `label.tsx` | Input `h-11 rounded border-border bg-background`; `Label` becomes the mono eyebrow style (`font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground`). |
| `avatar.tsx` | Fallback initials in `font-display font-bold`, `bg-secondary text-foreground`. Sizes `xs` 22px, `sm` 28px, `md` 40px, `lg` 64px. |
| `spinner.tsx`, `copy-button.tsx` | Colour tokens only. |

Remove `.glow-sm` / `.glow-md` from `globals.css` and every `glow-*` class use.

## 2. New primitives (`src/components/ui`)

| Component | Props | Notes |
|---|---|---|
| `eyebrow.tsx` | `children`, `as?` | The mono uppercase label. Used above hero blocks, list groups, sections. |
| `spots-meter.tsx` | `confirmed: number`, `max: number`, `waitlist?: number`, `size?: 'sm' \| 'md'` | Bar `h-1.5` / `h-2.5`, cone fill, chalk-faded track; caption row "**11** de 14 anotados" (mono, bold count) and "3 lugares · 2 en espera" on the right. Full state: bar in success, caption "Completo". |
| `player-row.tsx` | `index?: number`, `name`, `nickname?`, `avatarUrl?`, `position?: string`, `guest?: boolean`, `trailing?: ReactNode`, `href?` | The single roster row used by the dashboard, match, players list, `/m`. Index in mono faded, avatar `xs`, name, "invitado" in faded 10px, position chip (`font-mono text-[9px] border rounded-sm px-1.5`) at the far right or `trailing`. Solid `border-b` between rows. |
| `pitch.tsx` | `players: PlacedPlayer[]` (from `placePlayersInFormation`), `team?: 'dark' \| 'light'`, `both?: {dark: PlacedPlayer[]; light: PlacedPlayer[]}`, `showRatings?`, `labels?: 'name' \| 'position' \| 'both'` | Replaces `LineupField`. Board ground, dashed chalk outline, halfway line, centre circle, two boxes (SVG, `stroke-dasharray`). Dots 26px on mobile, 32px on `lg`, chalk stroke, initials in display; label under the dot in mono 9px chalk with a text shadow. `both` draws the dark team from the bottom half and the light team mirrored in the top half. |
| `segmented.tsx` | `options: {value,label}[]`, `value`, `onChange` | Mono labels, chalk outline, active segment `bg-accent`. Used for the players sort and the theme picker. |
| `sheet.tsx` | `open`, `onOpenChange`, `title`, `children` | Bottom sheet on mobile (`fixed inset-x-0 bottom-0 rounded-t-lg bg-card border-t shadow-lg`, drag handle, `max-h-[85vh] overflow-y-auto`), centred dialog on `lg`. No library; `<dialog>` element with a small client wrapper, `Escape` and backdrop close, focus trapped by the element itself. |
| `popover.tsx` | `trigger`, `children`, `align?` | Anchored panel for the sidebar group switcher and "Gestionar" in the browser. Same `<dialog>`-less pattern as today's user menu (backdrop `fixed inset-0`), tokens applied. |

## 3. Layout (`src/components/layout`)

| Component | Props | Notes |
|---|---|---|
| `app-shell.tsx` (server) | `user`, `groups: {slug,name,role}[]`, `currentGroup?: {slug,name,role,pendingRatings,nextMatchId?}`, `unreadCount`, `children` | Renders `<Sidebar>` (`hidden lg:flex`) + `<main>`, and `<TopBar>` + `<TabBar>` (`lg:hidden`). Reads the `fulbot_group` cookie. Mounted from `(dashboard)/layout.tsx`; the group-level data (`groups`, `currentGroup`) is fetched there with one query on `group_memberships`. |
| `sidebar.tsx` (client) | same as above minus `children` | Section 1 of `02-shell.md`. Owns the unread count refresh on route change (moved from `header.tsx`). |
| `top-bar.tsx` (client) | `title?: ReactNode`, `back?: string \| true`, `action?: ReactNode`, `brand?: boolean` | `true` back = `router.back()`; a string = explicit href (preferred, so a deep link from WhatsApp has somewhere to go). Pages set it through a `TopBarSlot` context (`useTopBar({title, back, action})` from a client leaf) so the server layout does not need per-route knowledge. Default when nothing is set: wordmark, no back. |
| `tab-bar.tsx` (client) | `currentGroup?`, `unread: boolean` | Section 2 of `02-shell.md`. Hidden on routes matched by `/new$` and `/edit$`. |
| `action-bar.tsx` | `children`, `public?: boolean` | Sticky bottom container with the gradient backdrop; `bottom-14` inside the app, `bottom-0` when `public`. Renders only `lg:hidden` unless `public` (the public match page keeps it on every width, centred `max-w-md`). |
| `page-header.tsx` | `title`, `subtitle?`, `actions?`, `eyebrow?` | Browser-only header row (`hidden lg:flex`); on mobile the same props feed the hero block through the page itself, so pages pass the data once and render `PageHeader` + their own mobile hero. |
| `public-frame.tsx` | `children`, `width?: 'sm' \| 'md'` | Board ground forced (`className="dark"` on the wrapper so tokens resolve dark regardless of the cookie), wordmark at top, centred column. |
| `group-switcher.tsx` (client) | `groups`, `current?`, `presentation: 'popover' \| 'sheet'` | List of groups with role badge, "Crear grupo", "Unirme con código". |
| `wordmark.tsx` | `size?: 'sm' \| 'md' \| 'lg'`, `withMark?: boolean` | `ful` + `bot` in the two colours; mark is the inline SVG of `01-brand.md` §4. |

## 4. Feature components that change shape

- `matches/[matchId]/match-admin-actions.tsx`: becomes the **content** of the admin
  popover/sheet; loses its own `Card`. Keeps every button and confirm dialog.
- `matches/[matchId]/signup-actions.tsx`: exposes the current action as data
  (`{primary: {label, onClick, disabled}, secondary?}`) through a small hook so the page
  can render it inline in the browser and in the `ActionBar` on mobile without
  duplicating the RPC logic.
- `teams/lineup-field.tsx` → deleted, replaced by `ui/pitch.tsx`. `teams-view.tsx` renders
  two `Pitch`es on `lg` and one `Pitch` with `both` below.
- `teams/whatsapp-share.tsx`: the share text is unchanged; the image comes from the
  restyled export route (`01-brand.md` §6).
- `member-score.tsx`, `player-skills.tsx`, `signup-policy-notice*.tsx`,
  `result-consensus.tsx`, `report-form.tsx`, `match-results.tsx`, `conduct-check.tsx`,
  `rate-form.tsx`: tokens and primitives only; stars keep their shape but use cone for
  filled and faded chalk for empty. Any `text-gray-*`, `dark:text-white`, `bg-green-*`,
  `text-yellow-700` literal is replaced by a token (`grep -rn "gray-\|green-\|yellow-\|slate-" src` must return nothing in `.tsx` when done).

## 5. Tailwind config additions

```ts
fontFamily: { display: ['var(--font-display)'], sans: ['var(--font-body)'], mono: ['var(--font-mono)'] },
colors: { success: {DEFAULT:'hsl(var(--success))', foreground:'hsl(var(--success-foreground))'},
          warning: {DEFAULT:'hsl(var(--warning))', foreground:'hsl(var(--warning-foreground))'} },
```

`darkMode: 'class'` and the cookie-driven theme in `layout.tsx` stay exactly as they are.
