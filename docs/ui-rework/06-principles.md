# 06 · Design principles and resolved questions

Added 2026-09-11 by the implementation orchestrator on top of `01`–`05`. These are the rules
that the spec leaves to taste. Where this file and `01`–`05` disagree, `01`–`05` win.

## 1. Resolved open questions (`05-plan.md` §5)

Implemented as the spec assumes, so no track has to ask:

1. Public pages (`/`, auth, `/invite*`, `/m/*`) always render on the board (`PublicFrame`
   forces `.dark`). A signed-in visitor's theme cookie is ignored there.
2. `Partido` tab with no upcoming match goes to `…/matches`.
3. `/groups` redirects to the dashboard when the user has exactly one active membership.
4. Ratings are hidden on the combined mobile pitch, visible in the browser view.
5. Landing `/` stays, restyled.
6. `01-brand §4` (wordmark alone on the mobile group dashboard) is superseded by
   `02-shell §2` / `03-screens §2`: the top bar shows the group-switcher title there.

## 2. Hierarchy: one hero, one action, one orange

- Every screen has exactly one hero (the page title in the browser, the hero block on
  mobile) and reads top-down: eyebrow → title → meta → content. Nothing above the hero
  competes with it.
- One primary action per screen, in cone. On mobile it lives in the `ActionBar` when the
  screen has one; otherwise it is the last element of the form. Everything else is a chalk
  outline or a text button. Exception: long multi-form settings pages
  (`/groups/[slug]/settings`, `/settings`) keep one primary per form card, because each
  card submits independently; toggles' on-state is cone.
- Status is a `Badge`, never coloured text on its own. Success/warning tokens appear only in
  badges, the `SpotsMeter` bar and inline notices, never on buttons.

## 3. Rows over cards

- Lists (groups, matches, players, notifications, rosters) are **rows**: full-width, solid
  `border-b` between them, the whole row is the tap target (`<a>` or `<button>` wrapping the
  row, `min-h-11`). No card per item.
- A dashed `Card` is reserved for a *thing* the screen is about: the next match, a pitch, a
  pending rating, a settings section. If a screen would show more than four dashed cards,
  most of them should be rows or sections with a solid `border-t`.
- Nested content inside a card is separated with `border-t` (solid), never another card.

## 4. Rhythm and density

- 4px grid. Spacing scale in use: `1 2 3 4 6 8` (Tailwind units). Section gap `space-y-6`,
  inside a card `space-y-3`, between a label and its control `space-y-1.5`.
- Page gutters `px-4` on mobile and `px-8` at `lg`. Mobile pages that have an `ActionBar`
  end with `pb-32`; pages that do not end with `pb-20` (tab bar clearance).
- Row height 44px minimum on mobile; 40px in the browser is fine for dense tables.
- Numbers are always `font-mono tabular-nums` and right-aligned in tables.

## 5. Typography discipline

- Display face (Syne) only for: page and hero titles, card titles, team names, the wordmark,
  score digits, avatar initials. Never for body copy or buttons.
- Mono only for: eyebrows, positions, counts, times/dates in lists, table numbers, list
  indices, codes. Never for a sentence.
- `text-balance` on titles, `text-pretty` on paragraphs longer than one line.
- Buttons are sentence-case verbs in vos form ("Anotarme", "Armar equipos", "Enviar al
  grupo"). No exclamation marks anywhere in the UI. No emoji in chrome (emoji only where the
  product already uses them inside WhatsApp text).

## 6. Colour and theme

- Only tokens. The `dark:` prefix is forbidden in components (the tokens flip; the only
  `.dark`-scoped rule is the chalk-dust texture in `globals.css`). A `grep -rn "dark:" src`
  should return nothing in `.tsx` when done.
- No opacity-modified tokens for text (`text-foreground/60` etc.); use `text-muted-foreground`.
  Opacity modifiers are allowed for backgrounds (`bg-background/90` in the top bar, the
  `ActionBar` gradient) and for disabled states.
- Team colours (`#1C1C1E` / `#F3F0E6`) and the pitch (`#173129`) are the only hex literals
  allowed in `.tsx`, and they live in one place: `src/lib/brand.ts` (`TEAM_DARK`,
  `TEAM_LIGHT`, `TEAM_LIGHT_INK`, `PITCH`, `CHALK`, `CONE`, `INK`), imported by the pitch,
  the export route and the icons script.

## 7. States

- **Empty**: one sentence in `text-muted-foreground` plus, when there is one, the single
  action that fills it ("Todavía no hay partidos. Creá el primero."). No illustrations.
- **Loading**: navigation never shows a spinner; server pages stream. Client-side fetches
  inside a mounted page show chalk-faded skeleton rows (`bg-muted animate-pulse rounded-sm`)
  of the same height as the real rows, never a centred spinner in a card.
- **Error**: inline, under the control or at the top of the card, `text-destructive text-sm`
  with a `CircleAlert` icon. Never a toast for form errors.
- **Disabled**: `opacity-50` and `cursor-not-allowed`, with a one-line reason in
  `text-muted-foreground` next to it when the reason is not obvious ("Cerrado a las 12:00").

## 8. Motion

- Sheets slide up in 150ms; popovers, tabs and everything else are instant.
- `@media (prefers-reduced-motion: reduce)` disables the slide and the `animate-pulse`.
- No hover transforms, no shadows on hover, no colour transitions longer than 100ms.

## 9. Accessibility floor (applies to every track)

- Every icon-only button has `aria-label`. The tab bar uses `<nav aria-label="Principal">`
  and `aria-current="page"` on the active tab; the sidebar the same with `aria-label="Grupo"`.
- Rosters and lists are `<ul>/<li>` (or `<ol>` when the index matters).
- Focus ring: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
  focus-visible:ring-offset-background` on every interactive element, including rows.
- `Sheet` and `Popover` are `<dialog>`-based, close on `Escape` and on backdrop click, return
  focus to the trigger on close. The sheet's title is the dialog's `aria-labelledby`.
- Colour is never the only carrier of meaning: the active tab's icon is orange **and** its
  label is bold (the label itself stays chalk — cone text on paper is 2.5:1), an
  unread notification has the dot **and** a bold title, a full match has the success bar
  **and** the word "Completo".
- Contrast is checked against `05-plan.md` §3 in both themes.

## 10. Responsiveness rules

- The shell choice is CSS (`hidden lg:flex` / `lg:hidden`), never a `useMediaQuery`.
- Pages pass the same data to `PageHeader` (browser) and to their mobile hero. No page
  branches on viewport in JS.
- Nothing scrolls horizontally except a table wrapped in `overflow-x-auto`.
- The mobile teams pitch must fit one 390×844 screen without scrolling (spec §4); verify
  with a screenshot, not by reading the JSX.
- Images, avatars and the pitch have explicit `aspect-ratio` or fixed sizes so nothing
  jumps while fonts or images load.

## 11. Code conventions for the rework

- New layout components go in `src/components/layout/`, new primitives in
  `src/components/ui/`. Feature components stay where they are.
- Props in `04-components.md` are the contract between tracks. Do not rename them. Extra
  optional props are fine.
- New UI strings are added to both `src/i18n/es.json` and `src/i18n/en.json` under a
  `ui.*` or the relevant existing namespace; never hard-code a Spanish string in a shared
  component.
- No new dependencies. Fonts through `next/font/google`; the two `.ttf` files for the
  export route are static assets under `src/assets/fonts/`.
- `npm run type-check && npm run lint && npm run build` green in the worktree before
  reporting. Screenshots at 390×844 and 1280×800 of every touched screen, in both themes,
  attached as absolute PNG paths in the report.
