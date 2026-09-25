# fulbot — complete feature & use-case inventory (as built, 2026-09-10)

This document describes **what the app does today**, feature by feature, written as use cases
(who does what, from where, what happens). It is meant to be annotated: after every feature
there is a `Your notes` block where you can write **keep / change / add / remove**.

Reviewed code: branch `maxolabs/rework` fast-forwarded to local `main` (`1a10d02`, the Sep 5
rework with tracks T1–T6, demo seed and invite page). Spec: `init-prompt.md`. Contract:
`docs/rework-plan.md`. Five detailed per-area reports with file:line evidence live in
`docs/review/area-*.md`; this document is the synthesis.

Legend used on every feature:

| Mark | Meaning |
|---|---|
| ✅ | works as described |
| ⚠️ | works with a caveat, bug or gap (explained inline) |
| ❌ | in the spec / implied by the UI but not implemented |
| 💀 | code or data that exists but is unused, unreachable or dead |
| 🔒 | security / integrity concern |
| 🧭 | a product decision you need to make |

UI strings are quoted in their original language (Spanish). "Admin/captain" means the check
is `is_group_admin_or_captain`; "admin" means admin only.

---

## 0. The product in one page

**Purpose.** Replace the weekly WhatsApp ritual of "Fútbol lunes": open 14 spots on Sunday
12:00, first 14 play, build two balanced 7-a-side teams (dark vs light), share the lineup,
track who played and who was MVP.

**Actors.**

| Actor | How they get there | What they can do (summary) |
|---|---|---|
| Visitor (no account) | WhatsApp link `/m/<matchId>` or invite link `/invite/<code>` | see the match card and names, sign up as a one-off guest by name, cancel that signup |
| Member | registered + joined a group | see everything in the group, sign up / drop out, vote MVP, rate, see stats, get in-app notifications |
| Captain | promoted by an admin | member + generate/edit teams, edit match, change match status, add/remove guests, load results, mark no-shows |
| Admin | group creator or promoted | captain + group settings, roles, notification settings, recurring pattern, create matches, delete matches, rules |
| System | Vercel cron (daily 12:00 UTC) + lazy calls | create recurring matches, send reminders, drain WhatsApp outbox |

**Core objects.** `users` (auth), `player_profiles` (one per user, **global** stats),
`groups`, `group_memberships` (role, active flag), `matches`, `match_signups` (confirmed /
waitlist / cancelled / did_not_show), `guest_players`, `teams` (dark/light) +
`team_assignments`, `rule_sets`, `match_events` (goals/assists), `match_mvp_votes`,
`match_ratings`, `player_badges`, `recurring_patterns`, `notifications` /
`notification_reads` / `notification_outbox`, `notification_settings` (per group).

**Screens.**

| Route | Screen |
|---|---|
| `/` | landing (public) |
| `/login`, `/register` | auth |
| `/groups` | dashboard: my groups, next match per group, "Votá el MVP" nudge |
| `/groups/new` | create group |
| `/groups/[slug]` | group home: upcoming matches, recent results, members, invite link |
| `/groups/[slug]/matches` | all matches of the group |
| `/groups/[slug]/matches/new`, `/[id]/edit` | create / edit match |
| `/groups/[slug]/matches/[id]` | **match page** (signups, admin actions, rules, announcement, results, voting) |
| `/groups/[slug]/matches/[id]/teams` | teams page (generate, lineup, manual edit, share) |
| `/groups/[slug]/players`, `/players/[id]` | roster and player profile |
| `/groups/[slug]/settings` | group settings (general, members, notifications, recurring, danger zone) |
| `/profile` | my player profile (editable) |
| `/settings` | language, theme, notification prefs |
| `/notifications` | in-app notification feed |
| `/invite`, `/invite/[code]` | join a group |
| `/m/[matchId]` | **public match page** (the WhatsApp link) |

**Match status machine (as enforced by `admin_set_match_status`).**

```
draft ──► signup_open ◄──► signup_closed
             ▲  │  ▲              │
             │  ▼  │              │
             └─ full ─────────────┼──► teams_created ──► finished (terminal)
                                  │
   any non-finished ──────────────┴──► cancelled (terminal)
```

- `signup_open ⇄ full` is automatic on the confirmed count.
- `teams_created` cannot go back to any signup state.
- Nothing ever moves a match to `finished` automatically; an admin/captain must click.
- ⚠️ Three code paths change status **outside** this machine: admin "Agregar invitado" can
  flip `draft`/`signup_closed`/`teams_created` to `full`; team generation sets
  `teams_created` from **any** status (even `finished`/`cancelled`); the create form inserts
  directly as `draft` or `signup_open`.

---

## 1. Getting in: landing, register, login, session, PWA

### 1.1 Landing page `/`
- **Who:** anyone. **Entry:** root URL, logo in auth pages.
- **UC 1.1.1 Discover the product.** Visitor sees "ful**bot**", the tagline, three feature
  rows ("Inscripción rápida", "Equipos con IA", "Estadísticas") and two buttons: "Crear
  cuenta" → `/register`, "Iniciar sesión" → `/login`. ✅
- ⚠️ A logged-in user who opens `/` still sees the signup CTAs (no redirect to `/groups`).
- ⚠️ The three feature rows look tappable (hover + chevron) but do nothing.
- Language follows the `fulbot_lang` cookie; `<html lang>` is hardcoded `es`.

> **Your notes (1.1):**

### 1.2 Register `/register`
- **Who:** visitor. **Entry:** landing, "Registrate" link on login, invite page "Crear cuenta".
- **UC 1.2.1 Create an account.** Fields "Nombre", "Email", "Contraseña" (min 6),
  "Confirmar contraseña", "Idioma" (Español/English). On submit Supabase creates the auth
  user; a DB trigger creates `users` + a `player_profiles` row with defaults (position CM,
  right-footed, GK willingness 0, rating 3.0, reliability 1.0). Redirect to `/groups`. ✅
- ⚠️ Arriving from an invite (`/register?redirect=/invite/<code>`) the redirect is ignored:
  the new user lands on an empty dashboard and must reopen the link.
- ⚠️ If email confirmation is enabled on the Supabase project, signup returns no session and
  the user bounces to `/login` with no "check your inbox" message.
- ⚠️ Any Supabase error other than "already registered" is shown raw in English.
- ❌ No onboarding after signup: nothing asks the player to fill positions / foot / GK
  willingness, which is exactly what the team balancer needs (see 5.3).
- ❌ No password reset, no change email/password, no delete account (an `auth.forgotPassword`
  i18n key exists but no UI).
- 💀 `/api/auth/callback` (OAuth/magic-link exchange) exists but nothing in the app leads to
  it; its `?error=auth_failed` is never displayed.

> **Your notes (1.2):**

### 1.3 Login `/login` and session
- **UC 1.3.1 Log in.** Email + password → `/groups` or the `?redirect=` path. Wrong
  credentials → "Email o contraseña incorrectos". ✅
- **UC 1.3.2 Deep link while logged out.** Middleware redirects protected paths (`/groups`,
  `/profile`, `/settings`, `/notifications`) to `/login?redirect=<path>` and back after
  login. ✅ (query string of the original URL is dropped.)
- **UC 1.3.3 Log out.** Avatar menu → "Cerrar sesión" → `/login`. ✅
- 🔒 **Open redirect:** `redirect` (login form) and `next` (auth callback) are not validated;
  `/login?redirect=https://evil.example` navigates off-site after a successful login.
- ⚠️ Middleware also runs on `/manifest.json`, `/sw.js`, `/api/*`, `/m/*`, hitting Supabase
  `getUser()` on every such request.
- 💀 `createServiceClient()` in `src/lib/supabase/server.ts` binds the service-role key to the
  user's cookie session; unused and dangerous. Delete.

> **Your notes (1.3):**

### 1.4 App shell (header, navigation)
- Sticky header: logo → `/groups`; one nav item "Grupos"; bell with unread count →
  `/notifications`; avatar dropdown with "Mi perfil", "Configuración", "Cerrar sesión". ✅
- ⚠️ Mobile hamburger contains a single entry ("Grupos") that duplicates the logo link.
  Profile/settings/notifications are only in the avatar dropdown.
- ⚠️ Header shows `users.name` (set once at signup) while the profile form edits
  `player_profiles.display_name`; after the first rename the two diverge forever.
- ⚠️ Unread badge counts notifications the user has muted in `/settings` (see 7.3).
- No back affordance in the shell; each page has its own "Volver a…" link.

> **Your notes (1.4):**

### 1.5 PWA (install on phone)
- Manifest (`start_url: /groups`, standalone, portrait, SVG icons) + a service worker that
  caches `/` and every visited page network-first. ✅ Android install works.
- ⚠️ iOS: no `apple-touch-icon` PNG, no favicon; header has no safe-area padding under the
  status bar.
- ⚠️ Offline is nominal: JS/CSS chunks are not cached, no offline fallback page; after a deploy
  cached HTML references chunks that no longer exist.
- 🔒 Service worker caches authenticated pages (rosters, profile) and never clears them on
  logout (shared-device leak).
- ⚠️ `maximumScale: 1` disables pinch-zoom (accessibility).
- Brand leftovers: "FUTBOT" in i18n `common.appName`, `/invite` header, SW cache name
  `futbot-v1`; slug prefix shows `futbot.app/groups/`.

> **Your notes (1.5):**

---

## 2. Groups, membership, people

### 2.1 Dashboard `/groups`
- **Who:** any logged-in user. **Entry:** post-login landing, PWA start URL, logo.
- **UC 2.1.1 See my groups and jump to the next match.** One card per active membership:
  name, role badge ("Admin"/"Capitán"/"Miembro"), description, and either
  "{Día} {HH:mm} · {n}/{max} confirmados" linking to the match, or "Sin partidos
  programados". Button "Crear grupo". ✅
- **UC 2.1.2 First-time empty state.** "No tenés grupos todavía" with "Crear grupo" and
  "Unirse con código" (→ `/invite`). ✅ This is the entire onboarding.
- **UC 2.1.3 MVP nudge.** Yellow card "Votá el MVP de {grupo} — {fecha}" for the most recent
  finished match (last 7 days) the user played and has not voted in. ✅
- ⚠️ The "next match" query ignores `signup_closed` (and `draft`): a match whose list the
  admin closed disappears from the card. Same bug on the group home and the invite page.
- ⚠️ "Unirse con código" is only offered in the empty state; a user with one group has no
  way from the dashboard to join a second one.

> **Your notes (2.1):**

### 2.2 Create a group `/groups/new`
- **UC 2.2.1 Create.** "Nombre del grupo", "URL del grupo" (auto-slug, prefixed by the literal
  `futbot.app/groups/`), "Descripción", "Día habitual", "Hora habitual", "Jugadores máximos"
  (4–30, default 14). Creator becomes admin; a default `notification_settings` row is
  created; redirect to the group home. ✅
- ⚠️ No timezone field; the group silently gets `America/Argentina/Buenos_Aires` and it can
  never be changed from the UI. The recurring pattern has its **own** timezone field, so the
  two can diverge (display uses the group's, generation uses the pattern's).
- ⚠️ "Día/Hora habitual" only pre-fill the create-match form; the weekly auto-creation uses
  the recurring pattern's own fields (two sources of truth).
- 💀 `GET /api/groups` exists and nothing calls it.

> **Your notes (2.2):**

### 2.3 Group home `/groups/[slug]`
- **Who:** active members only (others get 404).
- **UC 2.3.1 Overview.** Header (name, my role, "{Día} HH:MM · N jugadores"), buttons "Crear
  partido" (admin/captain) and a gear (admin). "Invitar jugadores" card with the invite URL
  and a copy button. "Próximos partidos" (max 5, with status pill and n/max) + "Ver todos".
  "Partidos recientes" (last 3 finished). Sidebar "Miembros (N)" with first 10 (name,
  matches, MVP count, role badge) + "Ver todos". ✅
- Side effect: every render lazily calls `generate_recurring_matches` for the group (this is
  the real safety net for Sunday 12:00, see 3.2).
- ⚠️ `signup_closed` matches are hidden from "Próximos partidos".
- ⚠️ Captains see "Crear partido" but the DB only lets admins insert matches → generic error.
- ❌ Spec §5.2 asks for players "with basic stats and badges"; no badges here or in the
  roster.
- Member rows are not links; plain members get an empty role pill.

> **Your notes (2.3):**

### 2.4 Invite & join `/invite`, `/invite/[code]`
- **UC 2.4.1 Enter a code by hand.** `/invite`: "Código de invitación" → "Continuar" →
  `/invite/<code>`. ✅
- **UC 2.4.2 Open an invite link without an account.** Card "Te invitaron a {grupo}" with
  schedule and member count; "Iniciar sesión" / "Crear cuenta" (both carry `?redirect`, but
  register ignores it). Below, if there is an open match: "Próximo partido … {n}/{max}
  anotados" and "Anotarme como invitado (sin cuenta)" → `/m/<matchId>`. ✅
- **UC 2.4.3 Join as a logged-in non-member.** "Unirme al grupo" → membership inserted as
  `member` → group home. ✅ (Done with a direct table insert, not the RPC.)
- **UC 2.4.4 Rejoin after being removed.** Button reads "Volver al grupo" but the update is
  blocked by RLS (admin-only) and silently affects 0 rows; the user is then sent to a 404.
  The public-page path (`join_group_via_invite`) also refuses ("Already a member"). **A
  removed member can never come back on their own, and admins have no "re-add" either.** ⚠️
- Invite codes never expire or rotate; there is no UI to regenerate one.
- 🔒 `groups` has a `USING (TRUE)` read policy: every group row **including invite codes** is
  readable by any authenticated user (the RPC `get_public_group_by_invite` made this policy
  unnecessary).
- 🔒 The membership INSERT policy lets any authenticated user insert **themselves into any
  group with any role, including admin** (the self-join branch does not constrain `role`).
  Together with the previous point, anyone can become admin of any group with one REST call.

> **Your notes (2.4):**

### 2.5 Members & roles (group settings → "Miembros")
- **Who:** admin.
- **UC 2.5.1 Change a role.** "⋮" menu per member → "Hacer admin" / "Hacer capitán" / "Hacer
  miembro". Last-admin protection is client-side only. ✅
- **UC 2.5.2 Remove a member.** "Eliminar del grupo" → `confirm()` → membership
  `is_active = false`. The player loses access; the group disappears from their dashboard. ✅
- ⚠️ Removal does **not** touch their signups: a removed player stays `confirmed` on next
  Monday's match, occupying a spot they cannot cancel.
- ⚠️ Removed members keep their role on the inactive row; nothing re-activates them (2.4.4).
- ❌ No "leave group" for members. No "add member" (only the invite link). No list of
  inactive members.
- ⚠️ Legend says "Capitán: Puede crear partidos y armar equipos" — creating is admin-only in
  the DB.
- Native `alert()`/`confirm()` dialogs.

**What each role can actually do (DB truth):**

| Capability | Member | Captain | Admin |
|---|---|---|---|
| Read group, matches, signups, teams, rules | ✅ | ✅ | ✅ |
| Sign up / drop out, vote MVP, rate | ✅ | ✅ | ✅ |
| Create match | ❌ (UI offers it to captains, DB refuses) | ❌ | ✅ |
| Edit match, change status, cancel | ❌ | ✅ | ✅ |
| Delete match | ❌ | ❌ (UI offers it) | ✅ |
| Add / remove guests | ❌ | ✅ (🧭 owner decision #2 said admins only) | ✅ |
| Rules editor | ❌ | ✅ | ✅ |
| Generate / edit teams | ❌ | ✅ | ✅ |
| Load results, mark no-shows | ❌ | ✅ | ✅ |
| Group settings, roles, notification settings, recurring pattern | ❌ | ❌ | ✅ |
| Delete group | ❌ | ❌ | ❌ (no DELETE policy, see 2.6) |

> **Your notes (2.5):**

### 2.6 Group settings `/groups/[slug]/settings` (admin)
- **UC 2.6.1 General.** Name, description, "Día habitual", "Hora habitual", "Jugadores máx."
  → "Guardar cambios". ✅ Slug, timezone, invite code not editable.
- **UC 2.6.2 Notifications.** See 7.4.
- **UC 2.6.3 Recurring match.** See 3.2.
- **UC 2.6.4 Delete group ("Zona de peligro").** Type the group name → "Confirmar
  eliminación" → the app navigates to `/groups` but **nothing is deleted**: there is no DELETE
  policy on `groups`, so RLS silently drops the statement. ⚠️ If it worked, cascades would
  remove matches/signups/teams/etc. but **not** player stats or badges (they are global), so
  the copy "Se eliminarán … estadísticas" would be wrong anyway.

> **Your notes (2.6):**

### 2.7 Players directory `/groups/[slug]/players`
- **UC 2.7.1 Browse the roster.** Card per member: avatar, name, role, nickname, main
  position, "Partidos / Goles / Asist. / MVPs", rating, footedness, fitness badge. Sorted by
  matches played. Click → profile. ✅
- ⚠️ All numbers are **global across groups** (one profile per user): "Partidos" in "Fútbol
  jueves" counts Monday games too. 🧭 Per-group stats or global?
- ❌ No badges, no search/filter.
- Three different hand-written position-label maps across pages (e.g. "Volante Def." vs
  "Volante Defensivo" vs "Mediocampista defensivo").

> **Your notes (2.7):**

### 2.8 Player profile `/groups/[slug]/players/[id]`
- **UC 2.8.1 View a player.** Header (avatar, name, nickname, position/foot/fitness badges,
  rating), "Posiciones preferidas", stats grid (Partidos, Goles, Asistencias, MVPs),
  "Estadísticas detalladas" (Vallas invictas, Confiabilidad %, Rating promedio recibido,
  Voluntad de arquero, Goles por partido), "Insignias", "Últimos partidos". ✅
- ⚠️ "Últimos partidos" is really "all my signups": not filtered by group, includes
  **future** matches ("Pendiente"), shows no score/team, and a no-show looks like a played
  match.
- ⚠️ Two ratings can disagree: header "Rating" = stored `overall_rating` (only refreshed at
  results-finalize time) vs "Rating promedio recibido" = live average.
- ⚠️ Badge labels include two that are never awarded ("MVP Streak", "Primera vez"); the same
  badge earned in several matches shows as repeated tiles.
- ⚠️ The page does not check that the player belongs to the group in the URL.
- No edit affordance when viewing yourself (editing lives at `/profile`, with different
  labels for the same fields).

> **Your notes (2.8):**

### 2.9 My profile `/profile`
- **UC 2.9.1 See my stats.** Avatar initials, name, nickname, main position, rating;
  "Estadísticas" (Partidos jugados, Goles, Asistencias, MVPs, Vallas invictas);
  "Confiabilidad" bar. ✅
- **UC 2.9.2 Edit my player info.** "Nombre", "Apodo", "Posición principal", "Otras
  posiciones que jugarías (máx. 4)" (chips with raw codes), "Pie hábil", "Disposición para
  atajar" (0–3 slider with funny labels), "Estado físico actual" (Bien/Limitado/Lesionado) →
  "Guardar cambios". ✅ These are exactly the inputs the AI balancer uses.
- ❌ No avatar upload (`avatar_url` is never written), no badges, no recent matches here
  (spec §5.4 lists all three).
- ❌ Not translated (English users get a Spanish profile page).
- ⚠️ Positions LM/RM/CF can be assigned by the AI but cannot be chosen as preferences here.

> **Your notes (2.9):**

### 2.10 App settings `/settings`
- **UC 2.10.1 Language.** Español/English → saved to `users.preferred_language` + cookie;
  applies after save + refresh. ✅ (Only the surfaces migrated in T6 are translated: landing,
  auth, header, dashboard, settings, match page header/status/signup card, edit form.
  Everything else stays Spanish.)
- **UC 2.10.2 Theme.** Claro / Oscuro / Automático, live preview, stored in a cookie only
  (per device, not per account). ✅
- **UC 2.10.3 Notification preferences.** Four toggles (waitlist promotion, teams created,
  reminder, results). ⚠️ They are saved but **only hide items in the `/notifications` list**;
  they do not stop creation, the bell count, or the WhatsApp outbox. 🧭 Mute or real opt-out?
- Duplicated heading ("Configuración" twice).

> **Your notes (2.10):**

---

## 3. Organizing a match

### 3.1 Create a one-off match `/groups/[slug]/matches/new`
- **Who:** admin (captains see the button, RLS refuses).
- **UC 3.1.1 Create.** "Fecha" (pre-filled with the next habitual day), "Hora", "Lugar
  (opcional)", "Jugadores máximo" (4–30), "Notas (opcional)", checkbox "Abrir inscripciones
  inmediatamente" (default on; off = `draft`). → match page with the announcement card. ✅
- ⚠️ Default date is computed in server time (UTC on Vercel), so on Monday evening BA it may
  propose *next* Monday.
- ⚠️ No `match_created` notification for manual matches (only recurring ones emit it); no
  lower bound on the date; location is not defaulted from anything.

> **Your notes (3.1):**

### 3.2 Recurring match (auto-created weekly)
- **Who:** admin configures; system creates.
- **UC 3.2.1 Configure the pattern** (group settings → "Partido recurrente"). "Día del
  partido", "Hora del partido", "Lugar", "Jugadores máx.", "Día en que abre inscripción"
  (default: day before), "Hora en que abre inscripción" (default 12:00), "Zona horaria"
  (8 presets + free text) → "Guardar"; "Desactivar"/"Activar". One pattern per group in the
  UI. ✅
- **UC 3.2.2 The match appears by itself.** At the signup-open moment the system inserts the
  next occurrence as `signup_open` (location, max from the pattern) and emits a
  `match_created` notification (+ WhatsApp outbox if configured). Idempotent, race-safe. ✅
- **When does it actually run?** Only when something calls the RPC: (a) the single Vercel
  cron at **12:00 UTC = 09:00 Buenos Aires** (Hobby plan: one daily cron, ±59 min), or (b)
  any member opening the group home. For "abre Domingo 12:00 BA" the cron is too early, so
  the match materialises **when the first member opens the group page after 12:00**, else
  Monday 09:00. ⚠️ The public page and match list do not trigger it. 🧭 This is the single
  most important operational gap for the Monday use case.
- ⚠️ The match row does not exist before the open moment: nobody can see or announce "next
  Monday" in advance.
- ⚠️ Editing a generated match's date makes the generator create a **duplicate** for the
  original slot; deleting a cancelled recurring match resurrects it.
- ⚠️ An invalid free-text timezone in one pattern aborts the cron sweep for **all** groups.
- ⚠️ No `notes`, no rules carried over to the generated match.

> **Your notes (3.2):**

### 3.3 Edit a match `/groups/[slug]/matches/[id]/edit`
- **Who:** admin/captain. **UC 3.3.1** Date, time, location, max players, notes →
  "Guardar". ✅
- ⚠️ Changing `max_players` reconciles nothing: lowering it leaves everyone confirmed;
  raising it on a `full` match keeps status `full` and does **not** promote the waitlist, so
  the next newcomer jumps the queue.
- ⚠️ No status gating: finished/cancelled matches are editable.

> **Your notes (3.3):**

### 3.4 Match page `/groups/[slug]/matches/[id]` — the admin's control panel
- **Who:** members (non-members get 404, not a redirect to the public page).
- **Layout.** Header: "{Día} {d/M/yyyy}", status badge, "MVP: {name}" when set, time,
  location, "{n}/{max} jugadores", "Editar" (admin/captain). Notes card. "Anuncio del
  partido" card (only while `signup_open`/`full`). Left: signup card, "Confirmados
  ({n}/{max})", "Lista de espera ({n})", results/voting when finished. Right: "Administrar
  partido", "Agregar invitado", "Reglas para armar equipos", "Estadísticas" (Inscritos / En
  espera / Disponibles).
- **UC 3.4.1 Admin actions** ("Administrar partido", admin/captain):

  | Status | Buttons |
  |---|---|
  | `draft` | "Abrir inscripciones", "Cancelar partido", "Eliminar partido" |
  | `signup_open` / `full` | "Cerrar inscripciones", "Armar equipos" (≥4 confirmed), "Cancelar partido" |
  | `signup_closed` | "Reabrir inscripciones", "Armar equipos", "Cancelar partido" |
  | `teams_created` | "Marcar como finalizado", "Cancelar partido" |
  | `finished` | (card hidden) |
  | `cancelled` | "Eliminar partido" |

  ✅ Transitions validated in SQL. ⚠️ "Cancelar partido" and "Marcar como finalizado" have
  no confirmation and are irreversible. ⚠️ Errors collapse into `alert('Error al actualizar
  el estado')` even though SQL raises readable Spanish messages.
- ⚠️ **After teams are generated there is no link to the lineup anywhere** ("Armar equipos"
  disappears, and the match page never shows the teams until `finished`). Members never get a
  link at all. Spec §5.3 expects the lineup on the match page.
- ⚠️ Realtime refresh is wired for `match_signups` but no migration adds the table to the
  realtime publication, so it only works if enabled by hand in the Supabase dashboard.
- Language mix on one screen: header/status via i18n, everything else hardcoded Spanish;
  "Inscritos" (peninsular) vs "anotados"; "Tú" vs vos.

> **Your notes (3.4):**

### 3.5 Announcement text ("Anuncio del partido")
- **Who:** everyone who can see the match page, while `signup_open`/`full`.
- **UC 3.5.1 Copy or share.** "Copiar" (→ "Copiado") and "Compartir por WhatsApp"
  (`wa.me`). ✅ Template:

  ```
  ⚽ {grupo} — {Lunes 7/9} {21:00}
  📍 {lugar}                                  (if set)
  👥 {n}/{max} anotados — faltan {k} lugares   (or "no quedan lugares")
  👉 Anotate acá: {APP_URL}/m/{matchId}
  Remera oscura/clara según tu equipo.
  ```
- ⚠️ Falls back to `http://localhost:3000` if `NEXT_PUBLIC_APP_URL` is unset. No year in the
  date. Not shown for `draft`/`signup_closed`.
- The automatic `match_created` notification uses a different wording ("¡Partido
  confirmado! … Quedan {max} lugares …").

> **Your notes (3.5):**

---

## 4. Signing up (the core weekly flow)

### 4.1 Member signs up / drops out (in-app, match page)
- **UC 4.1.1 Sign up.** Card "Inscribite al partido" / "Hay lugar disponible" → "Anotarme".
  If full: "El partido está completo" / "Podés anotarte en la lista de espera" → "Anotarme
  en espera". RPC `signup_for_match` (row-locked, so two people racing for the last spot are
  serialized correctly). Confirmed or waitlisted with position; match flips to `full` at
  capacity. ✅
- **UC 4.1.2 Drop out.** Green card "Ya estás anotado" → "Bajarme" → `confirm()` →
  `cancel_my_signup` → first waitlisted player is promoted automatically and gets a
  `waitlist_promoted` notification; status reconciled. ✅
- **UC 4.1.3 Leave the waitlist.** Yellow card "Estás en la lista de espera / Posición #n" →
  "Salir de espera". ✅ ⚠️ Remaining waitlist positions are not renumbered (gaps like #1, #3).
- **UC 4.1.4 Re-sign after cancelling.** Allowed while open; goes to the back of the line. ✅
- ⚠️ Dropping out is allowed in `signup_closed` and `teams_created` (no status check). After
  teams exist the promoted player is confirmed but on no team, and nobody is told the lineup
  is stale.
- ⚠️ In `draft`/`teams_created` the card still says "Hay lugar disponible" with a disabled
  button and no explanation.
- ❌ The RPC accepts per-match notes and position preference (spec §3.6) but there is no UI
  for them.
- 🔒 Leftover RLS policies let a member insert/update their own `match_signups` row directly
  (bypass capacity, closed list, waitlist order). Should be dropped now that RPCs exist.
- Reliability penalties for late cancels are computed only when the match is later finalized
  (see 6.6).

> **Your notes (4.1):**

### 4.2 Waitlist & auto-replacement
- Promotion order: `waitlist_position`, then signup time. Runs on member cancel, guest cancel,
  admin remove, admin status change. ✅
- ⚠️ Not run when `max_players` is raised (3.3).
- ⚠️ The in-app `waitlist_promoted` notification goes to the promoted **player** only (spec
  §4.4 says notify the group). If the promoted signup is a guest it goes to the whole group.

> **Your notes (4.2):**

### 4.3 Guests added by the admin
- **Who:** admin/captain (🧭 decision #2 said admins only). **Entry:** "Agregar invitado"
  (any status except finished/cancelled).
- **UC 4.3.1 Add a guest.** "Nombre *", "Notas" → "Agregar". Placed confirmed or waitlisted
  automatically by count ("Quedan {n} lugares disponibles." / "El invitado irá a lista de
  espera."). ✅
- ⚠️ Spec §4.4 "added directly to confirmed **or** waitlist": there is no choice.
- ⚠️ Every add creates a brand-new `guest_players` row: "Juan" ×10 over a season, no reuse,
  no guest management, and the AI history treats each as a different person. 🧭 Persistent
  guests (pick from previous) or one-offs?
- ⚠️ Adding a guest in `draft`/`signup_closed`/`teams_created` can flip the match to `full`,
  silently reopening a closed list or reverting a `teams_created` match.
- **UC 4.3.2 Remove anyone.** "X" (title "Sacar del partido") next to any player or guest,
  in any status including `finished` → `confirm()` → cancelled + waitlist promoted. ✅
  ⚠️ On a finished match this rewrites attendance history; on `teams_created` the assignment
  is orphaned.

> **Your notes (4.3):**

### 4.4 Public match page `/m/[matchId]` — the link people tap in WhatsApp
- **Who:** anyone with the link. Data comes from an anon-callable RPC: group name, date,
  location, notes, status, max, and the **full names** of confirmed and waitlisted people.
- **UC 4.4.1 Visitor with no account signs up as a guest.**
  1. Sees badge ("Inscripción abierta" / "Completo" / "Inscripción cerrada"), group, date,
     time, location, "{n}/{max} jugadores", notes, an input "Tu nombre", button "Anotarme"
     (or "Anotarme en lista de espera"), the numbered "Confirmados" list and "Lista de espera",
     and "¿Tenés cuenta? Iniciá sesión".
  2. Types a name → a guest row + signup are created; a 1-year httpOnly cookie
     `fulbot_guest_<matchId>` remembers them on this device.
  3. Page now shows "Estás anotado (invitado)" + "Bajarme" (or "En lista de espera (#n) -
     invitado" + "Salir"); their name is in the list. ✅
  4. "Bajarme" → confirm → signup cancelled, waitlist promoted, cookie cleared. ✅
  - ⚠️ Another device/browser = no cookie = can sign up again under the same name (no
    name-based dedup). Re-signing after cancelling creates a new guest row (old one orphaned).
  - ⚠️ No "Crear cuenta" link on this page; register ignores `redirect` anyway.
  - ⚠️ Guests have no notification channel; once teams exist the public page only says "Los
    equipos ya fueron armados" — a guest never learns which shirt to bring unless someone
    tells them.
  - 🔒 `public_guest_signup` / `cancel_guest_signup` are granted to `anon` even though the
    route handler uses the service role: anyone with the anon key can fill a match and its
    waitlist with junk names in a loop (no rate limit, no server-side name length cap).
  - 🧭 Full names and match notes are exposed to anyone holding the UUID (links get
    forwarded).
- **UC 4.4.2 Logged-in non-member.** Single button "Unirme al grupo e inscribirme" → joins
  via invite code, then signs up. ✅ ⚠️ Fails forever for ex-members with an inactive
  membership ("Already a member"). ⚠️ A logged-in user without a player profile falls through
  to the guest form.
- **UC 4.4.3 Logged-in member.** "Inscribirme" / "Anotarme en lista de espera"; then "Estás
  inscripto" + "Ver partido" + "Bajarme". ✅ (Wording differs from the in-app card:
  "Inscribirme"/"Estás inscripto" vs "Anotarme"/"Ya estás anotado".)
- **UC 4.4.4 Non-signup statuses.** One line: "Las inscripciones aún no están abiertas" /
  "Los equipos ya fueron armados" / "Este partido ya terminó" / "Este partido fue cancelado";
  logged-in users get "Ver detalles del partido" (404 for non-members). Past match: "Este
  partido ya pasó". ✅
- Not found: "Partido no encontrado". ✅

> **Your notes (4.4):**

---

## 5. Teams

### 5.1 Getting to the teams page
- Only link in the app: "Armar equipos" in the admin card, while `signup_open`/`full`/
  `signup_closed` and ≥4 confirmed. ⚠️ Threshold is a hardcoded 4, unrelated to
  `max_players` (spec: "e.g. 14"). ⚠️ Gone after generation (3.4). Members can only reach
  `/teams` by typing the URL.

> **Your notes (5.1):**

### 5.2 Teaming rules ("Reglas para armar equipos", match page sidebar)
- **Who:** admin/captain. Shown only while `signup_open`/`full` (⚠️ not in `signup_closed`,
  the natural pre-generation state, nor `teams_created` when you would tweak and regenerate).
- **UC 5.2.1 Add a pair rule.** "+ Separar jugadores" (`avoid_pair`) / "+ Juntar jugadores"
  (`force_pair`) → "Jugador A", "Jugador B" (all group members; guests not selectable) →
  "Guardar". ✅
- **UC 5.2.2 Add a minimum.** "+ Mín. defensores" / "+ Mín. arqueros" → "Cantidad mínima por
  equipo" (1–5). ✅
- **UC 5.2.3 Remove.** X ("Quitar regla") → soft-deactivated. ✅
- Rules created here are **per match**. ❌ No UI for group-level (permanent) rules, although
  the schema supports them; a legacy group rule shows without a scope marker and "Quitar"
  deactivates it group-wide. 🧭 Do you want permanent "these two never together" rules?
- 💀 `balance_rating` rule type exists in the enum with no UI or generator support.
- Empty state: "No hay reglas configuradas. La IA armará equipos balanceados por rating."

> **Your notes (5.2):**

### 5.3 Generate teams with AI (teams page)
- **Who:** admin/captain. **UC 5.3.1 Generate.** "Generar equipos con IA" card → "Generar
  equipos" ("Generando..."). Server: loads confirmed players (members with full profile,
  guests with invented defaults), active rules, the last 5 finished matches' teammate pairs;
  builds an English prompt for OpenAI (`gpt-4o-mini`, JSON mode); validates hard constraints
  (everyone exactly once, sizes differ ≤1, avoid/force pairs, ≥1 GK-willing player per team);
  retries once with the violations listed; falls back to a deterministic snake draft. Saves
  dark/light assignments atomically, sets `teams_created`, stores a snapshot, emits
  `teams_created` (in-app + WhatsApp outbox: "¡Se armaron los equipos! Oscuro: … Claro: …").
  UI shows the "Análisis" card (badge "IA" or "Determinístico", reasoning, "Balance: 87%",
  warnings), the share buttons and both fields. ✅
- **What the AI receives per player:** name/nickname, rating, main + preferred positions,
  foot, GK willingness, fitness, reliability %, matches/goals/assists, guest flag; rules by
  name; teammate-pair counts. **Not** sent: match/group info, formation preference per team,
  recent form (spec §4.5). Full prompt in `docs/review/area-D-teams.md`.
- ⚠️ **The GK constraint is always on, but the profile default is "never" (0).** In any group
  where fewer than two people set GK willingness, every generation burns two OpenAI calls and
  silently ends in the fallback. Guests are invented as GK-willing, which masks it oddly.
  🧭 Should the GK minimum only apply when a rule exists, or be a warning?
- ⚠️ Guest defaults are invented (rating 2.5, right foot, GK 1, reliability 0.8) and guests
  are not marked as guests anywhere on the teams page, lineup, text or image.
- ⚠️ The AI answers in English ("reasoning"/"warnings" shown verbatim in the Spanish UI).
- ⚠️ The route ignores match status (can regenerate a `finished` or `cancelled` match and
  regress it to `teams_created`).
- ⚠️ Snapshot stores a reduced input (id/name/rating), not the full prompt (contract §2.3).
- **UC 5.3.2 Regenerate ("Redo").** "Regenerar equipos": no confirmation, discards manual
  edits, re-emits `teams_created` to the whole group every time; the previous proposal is not
  passed to the model; in fallback mode the result is byte-identical. ⚠️
- Fallback: force-pairs merged into units, GK-willing seeds, snake draft by rating,
  avoid-pair aware, formation `GK, CB, RB, CDM, CM, CM, ST` for 7. Ignores `min_defenders`
  and history.

> **Your notes (5.3):**

### 5.4 Lineup view ("Vista de cancha")
- **Who:** all members. Two cards "Equipo Oscuro" / "Equipo Claro" with "{n} jugadores ·
  {avg} avg", each a pitch with one token per player at its position (abbreviation in a
  circle, nickname or first name, ★ rating). Side by side on desktop, stacked on phones. ✅
- ⚠️ No formation concept: layout is keyed by stored position strings (fallback gives a right
  back and no left back).
- 🧭 Every member sees everyone's ★ rating on the field, in the list and in the shared PNG.
  Spec frames ratings as internal; is broadcasting them OK?
- ⚠️ "Jugadores sin asignar (n)" lists confirmed players not on any team (e.g. promoted after
  generation) but offers no action.

> **Your notes (5.4):**

### 5.5 Manual editing ("Vista de lista (editable)")
- **Who:** admin/captain (no status check: teams of a `finished` match can be edited).
- **UC 5.5.1 Move a player.** Drag onto a row of the other team, or "→ Claro" / "→ Oscuro".
  ✅ **UC 5.5.2 Change position.** Select with 13 positions. ✅ **UC 5.5.3 Save.** "Hay
  cambios sin guardar" → "Guardar cambios" → atomic RPC replaces all assignments as
  `manual`. ✅
- ⚠️ Dragging within a team does not reorder (snaps back); dropping onto an empty team does
  nothing (no droppable registered).
- ⚠️ Switching back to "Vista de cancha" or navigating away silently discards unsaved edits.
- ⚠️ No validation on save (empty team, no GK, rules violated); the stale "Análisis" card
  stays above the edited teams.
- ❌ Cannot add an unassigned player or remove one; the only fix is "Regenerar", which
  destroys manual work.
- ⚠️ Manual save emits no notification; regeneration does.

> **Your notes (5.5):**

### 5.6 Share the lineup
- **Who:** all members. Buttons "Copiar", "WhatsApp", "Imagen".
- **UC 5.6.1 Copy / share text.** Dropdown "Formato simple" / "Con posiciones" / "Con
  emojis"; "WhatsApp" opens `wa.me` with the text. ✅ Example ("Con emojis"):

  ```
  ⚽ *Fútbol lunes* ⚽
  📅 Lunes 7/9 - 21:00

  🖤 *EQUIPO OSCURO*
  ⚫ Juan (GK)
  …
  🤍 *EQUIPO CLARO*
  ⚪ Pedro (CB)
  …
  ¡Nos vemos en la cancha! 🏟️
  ```
  ⚠️ Date/time use the **browser's** timezone, not the group's. Two "Juan"s are
  indistinguishable (first name only). No location, no link, no guest marker.
- **UC 5.6.2 Download PNG.** "Imagen" → 820×630 image with both pitches, names, positions and
  ratings, "Generado con Fulbot". ✅ ⚠️ It is a file download, not a share sheet: on phones the
  user must find the file and attach it; failures are silent.
- 🔒 The image endpoint `/api/export/lineup-image` is unauthenticated and unvalidated:
  anyone can render arbitrary text into a Fulbot-branded image; malformed input crashes it.

> **Your notes (5.6):**

---

## 6. After the match

### 6.1 Finish the match
- **UC 6.1.1** Admin/captain, status `teams_created` → "Marcar como finalizado" → `finished`.
  ✅ No confirmation, irreversible, no time check, **no notification** ("vote now" does not
  exist as a message; the only prompt is the dashboard nudge).
- ⚠️ A match that never had teams generated can never be finished, so it never gets results,
  votes, badges or attendance.
- ❌ No auto-finish when the date passes (every match must be closed by hand).

> **Your notes (6.1):**

### 6.2 Load results (goals & assists)
- **Who:** admin/captain, on a finished match with teams. Card "Cargar resultado".
- **UC 6.2.1 Enter goals.** Per team, "Gol" adds a row: "Seleccionar goleador..." (mandatory)
  + "Asistencia (opcional)". Score = number of goal rows. → "Guardar resultados". Server
  finalizes: `matches_played +1` for confirmed registered players, goals/assists/clean sheets
  incremented, reliability recomputed, badges awarded, `results_posted` emitted ("Resultado
  cargado: Oscuro 3 - Claro 2."). Members then see the "Resultado" card with scorers. ✅
- **UC 6.2.2 Correct results later.** Same editor ("Actualizar goles"). ⚠️ Only the score,
  goal list and **new** badges are updated; player counters are never corrected, badges never
  revoked, and a duplicate `results_posted` notification goes out every save. The UI copy
  ("Podés corregir los goles sin duplicar stats") hides this.
- ⚠️ A score cannot be recorded without naming every scorer; no own goals; a genuine 0-0
  renders nothing for members.
- ⚠️ The save is a client-side delete + N inserts (non-atomic): a mid-way failure leaves
  partial events.
- ⚠️ Admin sees the score twice (editor + card); the "Estadísticas" sidebar still shows
  Inscritos/En espera/Disponibles on a finished match.

> **Your notes (6.2):**

### 6.3 Vote MVP + rate teammates
- **Who:** shown to every member on a finished match; the DB only accepts votes from players
  with a **confirmed** signup, within **7 days of the match date**.
- **UC 6.3.1 Vote.** Card "Votá al MVP del partido" / "¿Quién fue el mejor jugador?": tap a
  candidate (all confirmed registered players except yourself), optionally give 1–5 stars to
  each ("Calificá a tus compañeros (opcional)"), "Enviar voto". Then "¡Voto registrado!" with
  the top-3 tally. The MVP is recomputed on every vote (most votes, tie → earliest), updates
  `mvp_count` and the `mvp` badge live, and appears in the match header. ✅
- ⚠️ Members who did not play see the form and only learn they cannot vote via
  `alert('Error al enviar los votos')`.
- ⚠️ Ratings cannot be sent without an MVP vote; "compañeros" includes opponents.
- ⚠️ No re-vote, no change of rating (no UPDATE policy).
- ⚠️ MVP is "decided" from the first vote and flips as votes arrive; no quorum, no close, no
  announcement. 🧭 Should there be a voting window that closes and announces?
- ⚠️ Window counts from kickoff, not from when the admin finished the match.
- ⚠️ **Teammate ratings almost never affect the stored rating.** `overall_rating` is only
  recomputed inside the *first* results-finalize pass, for ratings that exist at that moment.
  Ratings cast after the admin loads the score (the normal order) are ignored forever. ❌
  "Recent form" (spec §4.7) does not exist.

> **Your notes (6.3):**

### 6.4 No-shows
- **UC 6.4.1** Admin/captain on a finished match: ghost icon "Marcar que no vino" on each
  confirmed row → status `did_not_show`, reliability recomputed; badge "No vino" visible to
  everyone; player drops out of MVP candidates and loses voting rights. "Marcar como
  presente" reverts. ✅
- ⚠️ Order matters silently: a no-show marked **after** results were saved keeps their
  `matches_played +1`.
- 🧭 "No vino" is shown to the whole group (spec: avoid shaming UI).

> **Your notes (6.4):**

### 6.5 Badges
| Badge | Condition (as coded) | Shown as |
|---|---|---|
| `hat_trick` | ≥3 goals in the match | ⚽ |
| `playmaker` | ≥2 assists in the match | 🎯 |
| `safe_hands` | assigned GK on a team whose opponent scored 0 | 🧤 |
| `ironman` | confirmed in all of the group's 10 most recent finished matches (re-awarded every match once reached) | 💪 |
| `mvp` | current top-voted player of the match (moves with the votes) | 🏆 |

- Shown as up to 3 emoji next to names in the match signup lists (tooltip = raw keys like
  `hat_trick`) and as tiles on the group player profile. ❌ Not on `/profile`, not on the
  group page or roster. Guests never earn badges.
- ⚠️ Never revoked on corrected results; `ironman` accumulates one row per match.
- 🔒 `player_badges` INSERT policy is `WITH CHECK (TRUE)`: any user can forge any badge for
  anyone via the REST API.

> **Your notes (6.5):**

### 6.6 Stats, rating, reliability (how the numbers are computed)
- **matches_played / goals / assists / clean_sheets**: incremented once at the first
  results-finalize of each match. Never corrected afterwards.
- **mvp_count**: live via the MVP trigger.
- **overall_rating**: average of **all** ratings ever received (all groups, no recency), but
  only recomputed at finalize time (see 6.3). Default 3.0.
- **reliability_score**: `1 − 0.05 × late cancels (< 6 h before kickoff) − 0.15 × no-shows`,
  clamped 0–1, lifetime across all groups; attendance never raises it; recomputed at finalize
  and on no-show toggles only.
- 🧭 All of these are **global per person**, not per group.

> **Your notes (6.6):**

---

## 7. Notifications & WhatsApp

### 7.1 What gets emitted

| Type | When | In-app recipient | Text |
|---|---|---|---|
| `match_created` | only when a **recurring** match is auto-created (gated by "Enviar link de inscripción") | whole group | "¡Partido confirmado! Lunes 7/9 21:00hs en {lugar} -- {grupo}. Quedan {max} lugares. Anotate acá: {url}" |
| `waitlist_promoted` | someone is promoted from the waitlist (gated by group toggle) | the promoted player (whole group if a guest) | "¡{nombre} entró! Se liberó un lugar en la lista de espera y ahora está confirmado/a." |
| `teams_created` | every AI generation / regeneration, not manual saves (gated by group toggle) | whole group | "¡Se armaron los equipos! Oscuro: … Claro: …" |
| `match_reminder` | daily cron, matches starting within `reminder_hours_before` | whole group (not only signed-up players) | "Hoy 21:00 -- {grupo} -- remera oscura/clara según tu equipo" |
| `results_posted` | every results save | whole group | "Resultado cargado: Oscuro 3 - Claro 2." |

Not emitted: manual match created, match finished / "vote now", match cancelled, match
edited, MVP decided, signup confirmation.

> **Your notes (7.1):**

### 7.2 Bell + `/notifications`
- **UC 7.2.1** Bell shows the unread count (refreshed on navigation, no realtime/polling).
  Page lists the last 100 group notifications with icon, text, "{grupo} · {fecha}", unread
  dot; each links to the match or group. "Marcar todo como leído". ✅
- ⚠️ No per-item mark-as-read; opening one does not mark it.
- ⚠️ Count ignores the user's prefs while the list hides muted types and "Marcar todo" only
  marks visible ones → a badge that can never be cleared.
- Page is hardcoded Spanish.

> **Your notes (7.2):**

### 7.3 Per-user preferences (`/settings`)
- Four toggles; effect = hide those types in the list only (2.10.3). ⚠️ The reminder copy
  ("un partido en el que estás anotado") is inaccurate: reminders are group-wide.

> **Your notes (7.3):**

### 7.4 Group notification settings (admin)
- "Enviar link de inscripción" (⚠️ copy says "copiar automáticamente el link"; real effect =
  gate `match_created` for recurring matches), "Recordatorio antes del partido" (hours,
  0–48), "Notificar promoción de lista de espera", "Notificar cuando se armen equipos",
  "Webhook de WhatsApp (opcional)". ✅ Saved per group.
- ⚠️ Help text claims compatibility with "Twilio, WhatsApp Business API": they do not accept
  this payload; a bridge is required.

> **Your notes (7.4):**

### 7.5 WhatsApp delivery (what really happens)
- **There is no WhatsApp integration.** If the group has a webhook URL, each notification
  also creates an outbox row; a cron drains it by POSTing
  `{ "text": "...", "type": "...", "payload": {...} }` to that URL (10 s timeout, up to 5
  attempts). Someone must run a bridge that forwards to WhatsApp. ✅ as an abstraction.
- ⚠️ **The outbox is drained only by the daily cron at 12:00 UTC**, so every WhatsApp message
  (lineup, promotion, result) arrives up to ~24 h late, i.e. the morning after. Reminders
  emitted by the same cron run are drained on the **next** day's run, after the match.
- ⚠️ In-app reminders: with the default 3 h window and a 09:00 BA cron, a 21:00 match never
  gets one. Effectively **reminders do not work** on the current schedule.
- 🔒 SSRF: the admin-supplied webhook URL is fetched server-side with no allow-list.
- ⚠️ Outbox text is rendered without the group timezone; no UI shows failures; no retry
  button; rows are only created if the URL existed at emission time.
- 🧭 Decide the real channel: manual copy/paste (today's practical path), a WhatsApp Cloud
  API integration, or a Telegram/other bot. The cron schedule (Hobby: 1/day) constrains
  anything automatic.

> **Your notes (7.5):**

### 7.6 Cron
- `vercel.json` registers one job, `/api/cron/daily` at 12:00 UTC: recurring generation →
  outbox drain → reminders. Guarded by `CRON_SECRET`. Individual routes
  `/api/cron/recurring|notifications|reminders` exist for manual runs. ✅

> **Your notes (7.6):**

---

## 8. Cross-cutting findings

### 8.1 Security / integrity (fix regardless of product decisions)
1. 🔒 Any authenticated user can insert themselves as **admin** of any group (membership
   INSERT policy) and all groups + invite codes are world-readable (2.4).
2. 🔒 Open redirects in login `redirect` and auth-callback `next` (1.3).
3. 🔒 `player_badges` insertable by anyone (6.5).
4. 🔒 Anonymous guest signup RPCs granted to `anon` with no rate limit (4.4).
5. 🔒 Leftover member INSERT/UPDATE policies on `match_signups` bypass the signup RPCs (4.1).
6. 🔒 Webhook SSRF (7.5); unauthenticated image endpoint (5.6); `get_recent_match_history`
   readable across groups; service worker caches private pages (1.5).
7. 🔒 Unused `createServiceClient` binding the service-role key to a user session (1.3).

### 8.2 Silent no-ops and dead ends (things that look like they work)
- "Eliminar grupo" deletes nothing (2.6).
- "Volver al grupo" for removed members updates nothing → 404 (2.4).
- Captains offered "Crear partido" / "Eliminar partido" → generic error (2.3, 3.4).
- "Enviar link de inscripción" toggle: copy describes a feature that does not exist (7.4).
- Notification prefs: cosmetic filter (2.10).
- Teammate ratings: stored, almost never used (6.3).
- Reminders and WhatsApp outbox: emitted, effectively never delivered on time (7.5).
- Realtime signup refresh: not enabled in the DB (3.4).
- Drag within a team / drop on an empty team: no-ops (5.5).
- Avatar upload, recent matches and badges on `/profile`: absent (2.9).
- Badge labels "MVP Streak" / "Primera vez", rule type `balance_rating`, i18n keys for
  teams/rules/players/positions, `GET /api/groups`, `calculateTeamMetrics`: dead.

### 8.3 Data-model decisions to make 🧭
- **Stats scope:** one global profile per person vs per-group stats/ratings/reliability.
- **Guests:** one-off rows (today) vs persistent guest identities you can pick again, and
  whether guests can ever become members while keeping history.
- **Ratings visibility:** ratings shown to everyone on lineups/PNG vs private inputs.
- **Group timezone:** one field (group) vs two (group + pattern); make it editable.
- **Users vs player_profiles name:** one name or two.

### 8.4 Language & copy
- Contract says Rioplatense "vos"; older pages use "tú" ("Crea", "Comparte", "Elige",
  "Arrastra"), one badge says "Tú", "Inscritos" is peninsular.
- Only T6 surfaces are bilingual; profile, group pages, players, matches lists, teams,
  results, voting, notifications, invite and public page are Spanish-only.
- AI reasoning/warnings arrive in English.
- Terminology drift: "Anotarme" / "Inscribirme" / "Inscribite"; "Bajarme" / "Salir";
  "avg" in Spanish UI; "Determinístico".

### 8.5 Hardcoded values worth surfacing
Minimum 4 players to generate teams; max players 4–30; guest name 60 chars (UI only);
5 upcoming / 3 recent on group home; last 5 matches for rotation; 2 AI attempts; 2-hour
"match in progress" grace; 6-hour late-cancel threshold; reliability penalties 0.05 / 0.15;
7-day voting window; badge thresholds 3 goals / 2 assists / 10 matches; reminder default 3 h;
cron 12:00 UTC; `http://localhost:3000` fallback URL; cookie 1 year; timezone preset list of 8.

### 8.6 Engineering hygiene
- No tests of any kind. 15 `(supabase as any)` casts remain. No CLAUDE.md / README.
- Migrations are applied by hand (no Supabase CLI config); `00006`–`00016` are pending on
  the live project per `docs/rework-plan.md §4`.
- N+1 queries on group home and match list; 7 sequential queries on the dashboard.
- Native `alert()`/`confirm()` used for every error and confirmation.

---

## 9. Suggested reading order for your annotations

The weekly loop is 3.2 → 3.5 → 4.4 → 4.1/4.2 → 5.3 → 5.6 → 6.1 → 6.2 → 6.3. If you annotate
only those sections plus 8.3, I can turn the result into a rework contract. Everything else
(profiles, badges, notifications, PWA) can be decided in a second pass.

Detailed evidence per area (file:line for every claim above): `docs/review/area-A-onboarding.md`,
`area-B-groups.md`, `area-C-matches.md`, `area-D-teams.md`, `area-E-postmatch-notifications.md`.
