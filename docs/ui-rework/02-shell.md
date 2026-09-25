# 02 · Shell: browser and mobile

The dashboard layout (`src/app/(dashboard)/layout.tsx`) currently renders one sticky top
header on every width, with a hamburger on phones that reveals a single link. This is
replaced by an `AppShell` that picks one of two shells by viewport width. Both are rendered
from the same server layout; the choice is CSS (`hidden lg:flex` / `lg:hidden`), not JS,
so there is no flash and no hydration mismatch.

Breakpoint: **`lg` (1024px)**. Tablets in portrait get the mobile shell; in landscape the
browser shell.

## 1. Browser shell (`lg` and up)

```
┌──────────┬──────────────────────────────────────────────┐
│ mark+word│  Page header: title, subtitle, actions        │
│ [group ▾]│ ─────────────────────────────────────────────  │
│          │  ┌───────────────────────┐ ┌───────────────┐  │
│ Inicio   │  │ main column (1fr)     │ │ aside (320px) │  │
│ Partidos │  │                       │ │               │  │
│ Jugadores│  │                       │ │               │  │
│ Puntuar  │  │                       │ │               │  │
│ Ajustes  │  └───────────────────────┘ └───────────────┘  │
│          │                                               │
│ 🔔 Avisos│                                               │
│ (avatar) │                                               │
└──────────┴──────────────────────────────────────────────┘
```

- **Sidebar** `w-60` (240px), full height, `sticky top-0`, `bg-card`, solid `border-r`.
  Contents top to bottom:
  1. Brand row (mark + wordmark), links to `/groups`.
  2. **Group switcher**: a button showing the current group name with a chevron. Opens a
     popover listing the user's active groups plus "Crear grupo". Hidden when the route is
     not inside a group (`/groups`, `/profile`, `/settings`, `/notifications`); the nav
     then shows only the global items.
  3. **Group nav** (only inside `/groups/[slug]/…`):
     `Inicio` → `/groups/[slug]`, `Partidos` → `…/matches`, `Jugadores` → `…/players`,
     `Puntuar` → `…/rate` (shown only when the user has pending ratings or is admin/captain,
     with a count badge), `Ajustes` → `…/settings` (admin only).
     Active item: `bg-accent text-foreground font-semibold`; others `text-muted-foreground`.
  4. Spacer.
  5. `Avisos` → `/notifications` with the unread count badge (moves out of the header; the
     existing `get_unread_notification_count` fetch moves into this component).
  6. User row: avatar + name; click opens the existing menu (Perfil, Preferencias, Salir).
- **Main** `flex-1 min-w-0`, `max-w-6xl` (1152px) `px-8 py-8`.
- **Page header** is a component (`PageHeader`, see `04-components.md`): title, optional
  subtitle line, optional actions slot on the right. It replaces the ad-hoc `<h1>` rows in
  each page.
- **Two-column pages** (dashboard, match, teams, player detail) use
  `grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6`. Everything else is one
  column `max-w-3xl`.
- Keyboard: sidebar links are plain `<a>`; focus ring is the cone token. No shortcuts in
  this rework.

## 2. Mobile shell (below `lg`)

```
┌────────────────────────────┐
│ ‹  Title            action │  top bar, 48px, sticky
├────────────────────────────┤
│                            │
│  one column, px-4          │
│                            │
│                            │
│ ┌────────────────────────┐ │
│ │  primary action (cone) │ │  action bar, sticky above tabs, only on some screens
│ └────────────────────────┘ │
├────────────────────────────┤
│  Partido    Grupo     Yo   │  tab bar, 56px + safe-area
└────────────────────────────┘
```

- **Top bar** `h-12 sticky top-0 bg-background/90 backdrop-blur border-b`. Left: back
  chevron when the route has a parent (match → group, player → players, …), else nothing.
  Centre-left: screen title in display face 17px (or the wordmark on the group dashboard
  and `/groups`). Right: one optional context action (icon button), e.g. share on the
  match screen, settings gear on the dashboard for admins.
- **Tab bar** `fixed bottom-0 inset-x-0`, `bg-card border-t`, `pb-[env(safe-area-inset-bottom)]`.
  Three tabs, icon 20px over a 10px label:
  | Tab | Icon | Goes to |
  |---|---|---|
  | `Partido` | `CalendarCheck` | the next non-finished match of the current group (`/groups/[slug]/matches/[id]`); if none, `…/matches` |
  | `Grupo` | `Users` | `/groups/[slug]` (or `/groups` if no current group) |
  | `Yo` | `CircleUser` | `/profile`; shows the unread-notification dot |
  Active tab in cone orange; others faded chalk. The tab bar is hidden on `/groups/new`,
  match `new`/`edit`, and any screen that opens a full-height form, so the form's own
  submit button is the bottom element.
- **Action bar** (`ActionBar`): `sticky bottom-14` (above the tab bar), `px-4 pb-3 pt-6`,
  with a gradient from transparent to `--background` behind it so the list fades under
  it. Holds one primary button and at most one secondary. Present on: match (Anotarme /
  Bajarme / Lista de espera; Armar equipos for admins), teams (Enviar al grupo + Editar),
  `/m/[matchId]` (Anotarme como invitado), rate (Guardar). Pages add
  `pb-32` to their content so the last row is reachable.
- **Group switching on mobile**: the top bar title on the group dashboard is a button that
  opens a bottom sheet with the user's groups and "Crear grupo". Same component as the
  sidebar popover, different presentation (`Sheet` variant).
- **Admin actions on mobile** move out of the main flow: the match screen's admin block
  (announce, close signups, edit, cancel, add guest, rules) becomes a "Gestionar" button in
  the top bar that opens a sheet. Members never see it.

## 3. Current group memory

The tab bar needs to know "the current group" on routes that have no slug (`/profile`,
`/notifications`). Store the last visited group slug in a cookie `fulbot_group` (set from
the group layout on the server, one year, `SameSite=Lax`). Fallback order: cookie → the
user's only group → `/groups`. This is the only new piece of state in the rework.

## 4. Routes without a shell

`(auth)/login`, `(auth)/register`, `/invite`, `/invite/[code]`, `/m/[matchId]` and `/`
render inside a `PublicFrame`: full-height board, centred column `max-w-md`, wordmark at
the top, no tabs, no sidebar. `/m/[matchId]` keeps its action bar (sticky bottom without a
tab bar underneath, so `bottom-0`).

## 5. What is removed

- `src/components/layout/header.tsx` (replaced by `Sidebar`, `TopBar`, `TabBar`).
- The hamburger and the `nav.groups` single link.
- `max-w-7xl` page containers in the dashboard layout.
