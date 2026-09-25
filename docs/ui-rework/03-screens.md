# 03 · Screens

For every route: what it shows, how it lays out in the browser shell and in the mobile
shell, and which action goes in the action bar. "Aside" means the 320px right column of the
two-column grid; on mobile the aside content stacks **after** the main column unless said
otherwise. Existing section order and copy are kept unless a line below changes them.

Mockups: `branding-proposals.html` → Direction C shows §2 (browser), §3 (mobile) and §4
(mobile) of this file.

## 1. `/groups` — Mis grupos

- Browser: one column `max-w-3xl`. Page header "Mis grupos" with "Crear grupo" and "Unirme
  con código" as actions. Group rows (not cards): name in display face, role badge, next
  match line in mono, chevron. The results nudge block stays at the top as a dashed card.
- Mobile: top bar shows the wordmark; no back. Same rows, full width. The two actions move
  to a single "Crear o unirme" button at the bottom of the list (no action bar; the list is
  short).
- Single-group users: after login, `/groups` redirects to the group dashboard (server side,
  when the user has exactly one active membership). The tab bar's `Grupo` tab makes the
  list reachable through the group switcher.

## 2. `/groups/[slug]` — Group dashboard (Inicio)

- Browser: page header = group name, subtitle "Lunes 20:00 · Cancha … · 14 lugares · N
  miembros", actions "Invitar" (outline, copies the invite link) and "Crear partido"
  (primary, admin/captain). Two columns:
  - Main: **Próximo partido** card (dashed): status badge, date in display face, location
    and close time, `SpotsMeter`, the confirmed roster in two columns (`PlayerRow` with
    index, avatar, name, position chip), waitlist line, buttons "Armar equipos" (admin,
    primary when the match is full or signups are closed) / "Compartir por WhatsApp" /
    "Sumar invitado" (admin). Below it: "Próximos partidos" (the remaining ones, rows) and
    "Partidos recientes" (rows with score when a result exists).
  - Aside: "Tabla · últimos 10" (PJ, G, MVP; admin/captain see the rating column, as
    today's visibility rules), "Próximas fechas" (recurring pattern), "Último resultado",
    the pending-ratings card ("Puntuar") when applicable, and the member-score nudge card.
- Mobile: top bar shows the group name as the switcher button; right action is the
  settings gear (admin). Main column only; the aside cards collapse to a horizontal row of
  two compact tiles (Tabla, Último resultado) under the next-match card, each linking to
  its full view (`…/players`, the finished match). No action bar: the next-match card's
  own "Ver partido" row is the tap target, and the `Partido` tab does the same.

## 3. `/groups/[slug]/matches/[id]` — Match

- Browser: page header = match date as the hero ("Lunes 14 sep · 20:00"), subtitle with
  location, status badge and "11 / 14 jugadores" in mono. Actions: "Compartir" (outline),
  "Gestionar" (outline, admin, opens the admin popover with the contents of today's
  `MatchAdminActions` card). Two columns:
  - Main, in this order: signup policy notice (if any), `SignupActions` (member state:
    not signed → primary "Anotarme"; confirmed → "Estás anotado" + outline "Bajarme";
    waitlist → position + reason + outline "Salir de la lista"), **Confirmados** card with
    the roster, **Lista de espera** card, then the post-match blocks in their current
    order (report form, consensus, admin results editor, voting, conduct check).
  - Aside: `MatchAnnouncement` (the WhatsApp text with copy), "Sumar un invitado" (admin,
    today's `AddGuestForm` card), rules manager (admin), "Estadísticas" card. Admin cards
    keep their solid dividers; only the outer card is dashed.
- Mobile: top bar = "Fútbol lunes" as the back label, right action "Gestionar" (admin,
  opens the admin **sheet**). Content: hero block (eyebrow "Próximo partido", date in
  display 30px, location line), `SpotsMeter` with "11 de 14" and "3 lugares", then the
  roster as one list (index, avatar, name, position chip), waitlist under a mono eyebrow.
  Aside content moves into the admin sheet (announcement, add guest, rules) except
  "Estadísticas", which is dropped on mobile (it lives on the player pages).
  **Action bar**: the current user's signup action, exactly one primary. Admin extra:
  when the match is `full` or `signup_closed` and has no teams, the action bar shows
  "Armar equipos" as primary and the signup action as secondary.
- Post-match state (finished): hero shows the score in display face where the count was;
  the action bar holds "Reportar resultado" until the user has reported, then nothing.

## 4. `/groups/[slug]/matches/[id]/teams` — Equipos

- Browser: page header "Equipos", subtitle = match date, badge "Formación 1-2-3-1".
  Actions: "Editar" (toggles the draggable editor, admin), "Enviar al grupo" (primary,
  opens today's `WhatsAppShare`). Two columns of pitches (Oscuras | Claras), each a dashed
  card with the team header (name in display, "Nivel 3.6" mono for admin/captain, "7
  jugadores") over a `Pitch`. Below: the balance explanation card and the warnings card.
- Mobile: single `Pitch` with **both teams** on one board (Oscuras attacking up from the
  bottom half, Claras from the top half), team headers as two tiles above it (dark tile
  and chalk tile). This is the screenshot people send, so it must fit one phone screen
  without scrolling: pitch aspect `3/3.55`, tiles 56px. The draggable editor stays a
  separate mode below (admin), reached with the secondary action.
  **Action bar**: "Enviar al grupo" primary, "Editar" secondary (admin) or "Copiar"
  (members).
- `Pitch` replaces `LineupField`'s green gradient: board ground, dashed chalk lines,
  dots with initials and the slot position under each (from `src/lib/formations.ts`).

## 5. `/groups/[slug]/matches` — Partidos

Rows grouped under mono eyebrows "PRÓXIMOS" and "ANTERIORES": date in display 16px, time
and location in mono, status badge or score. Browser one column `max-w-3xl`; page header
action "Crear partido" (admin/captain). Mobile: same list, the create action is a top-bar
`Plus` icon.

## 6. `matches/new`, `matches/[id]/edit`

One-column forms `max-w-xl`. Mobile: tab bar hidden, submit button at the end of the form
(not sticky). Date and time inputs in mono.

## 7. `/groups/[slug]/players` and `players/[id]`

- List: page header "Jugadores" with the sort select (matches / score) as a segmented
  control in mono. Rows: avatar, name, positions as chips, matches played, member score
  stars (where visible). Browser `max-w-3xl`; mobile same.
- Detail: header with avatar 64px, name in display, role and positions. Two columns in
  the browser: main = "Estadísticas detalladas", "Últimos partidos"; aside = member score
  card with event log, "Insignias", skills (`PlayerSkills`, admin/captain). Mobile stacks
  main then aside.

## 8. `/groups/[slug]/rate` — Puntuar

The pending-ratings queue. One column `max-w-xl`. Each pending player is a dashed card
with the four dimension controls and tags; "Omitir" as a text button. Mobile: action bar
"Guardar" primary, "Omitir" secondary; the form scrolls under it.

## 9. `/groups/[slug]/settings` — Ajustes

One column `max-w-3xl`, cards in today's order (general, compromiso, miembros,
notificaciones, partido recurrente, zona de peligro). Browser: a sticky in-page mono index
on the left of the column is **not** added; sections are short enough. Danger zone card
uses a solid destructive border, not dashed.

## 10. `/profile`, `/settings`, `/notifications`

- Profile: avatar, name in display, "Editar" action; cards for Estadísticas, Compromiso
  (per group), Información del jugador. On mobile this is the `Yo` tab: add a row at the
  top linking to `/notifications` with the unread count, and a row to `/settings`
  ("Preferencias"); "Salir" at the bottom as a text button.
- Settings (preferences): language, theme (light / dark / system, labelled "Papel",
  "Pizarra", "Sistema"), notification prefs. Theme preview logic stays.
- Notifications: rows with a mono time, unread rows carry a 6px cone dot at the left,
  "Marcar todo como leído" as the page header action.

## 11. Auth: `/login`, `/register`, `/`

`PublicFrame`. Landing `/` keeps its three feature blocks but as three dashed cards in a
row (stack on mobile), tagline in display face, one primary "Crear cuenta" and a text
"Iniciar sesión". Forms `max-w-sm`, labels in mono eyebrow style, inputs 44px tall.

## 12. Public match `/m/[matchId]` and invite `/invite`, `/invite/[code]`

These are the first screens a guest sees, usually at noon from WhatsApp.

- `/m/[matchId]`: `PublicFrame` with the match hero (group name eyebrow, date in
  display, location, `SpotsMeter`), the confirmed list (names only, no positions, no
  ratings), and the guest form (name) when signups are open. Action bar at the bottom of
  the viewport: "Anotarme como invitado" primary; when the user is signed in, "Ver el
  partido" instead. Full match state shows "Está lleno · lista de espera" as the primary.
- `/invite/[code]`: card "Te invitaron a {group}", member count, next match line, primary
  "Unirme" (or "Crear cuenta para unirme" when signed out), plus the guest path to the next
  open match as a secondary link, as today.
- Both render on the board regardless of the theme cookie (the cookie belongs to a
  signed-in user; visitors get the brand). Open question in `05-plan.md` §5.
