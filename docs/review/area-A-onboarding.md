# Area A — Onboarding, Account, Navigation, Dashboard, i18n, PWA

Review of `/Users/maxo/orca/workspaces/fulbot/rework` (branch `maxolabs/rework`). All paths below are relative to that root. Spec references: `init-prompt.md` §4.1, §5.1, §5.4, §5.6, PWA bullet in §5; rework contract `docs/rework-plan.md` §2.7.

Files read completely: `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `public/manifest.json`, `public/sw.js`, `next.config.mjs`, `src/middleware.ts`, `src/lib/supabase/{admin,client,middleware,server}.ts`, `src/app/(auth)/**`, `src/app/api/auth/callback/route.ts`, `src/app/(dashboard)/layout.tsx`, `src/app/(dashboard)/groups/page.tsx`, `src/app/(dashboard)/profile/**`, `src/app/(dashboard)/settings/**`, `src/components/layout/header.tsx`, `src/components/ui/*`, `src/i18n/**`, migrations `00001`, `00002`, `00009` (plus targeted greps into `00003`, `00012`, `00014`, `src/app/invite/page.tsx`, `notifications/notification-list.tsx`).

---

## Cross-cutting map (read this first)

| Concern | Where it lives | Notes |
|---|---|---|
| Session refresh + route guard | `src/middleware.ts` → `src/lib/supabase/middleware.ts` | Protected prefixes: `/groups`, `/profile`, `/settings`, `/notifications`. Auth prefixes: `/login`, `/register`. Everything else (`/`, `/invite`, `/m/*`, `/api/*`) is public. |
| Auth | Supabase email/password from client components (`login-form.tsx`, `register-form.tsx`) | No server action; no password reset; no email-change. |
| User rows | `public.users` (created by trigger `handle_new_user`, `00002`) + `public.player_profiles` (also created by the trigger) | `users.name` is written once at signup and never again; `player_profiles.display_name` is what the profile form edits. |
| Language source of truth | **Three** sources: `users.preferred_language` (dashboard layout, `/groups`, `/settings`), cookie `fulbot_lang` (`/`, `/login`, `/register`), and `<html lang="es">` (hardcoded) | Login never syncs the cookie from the DB; see issues A-I1. |
| Theme | Cookie `fulbot_theme` only (not in DB); root layout applies `.dark` class server-side | Per-device, not per-account. |
| i18n mechanics | `src/i18n/core.ts` (pure), `server.ts` (`getT`), `provider.tsx` (`LanguageProvider`, `useT`), `use-translations.ts` (client hook) | `es.json`/`en.json` are in full key parity (213 keys each). |
| PWA | `public/manifest.json`, `public/sw.js`, inline SW registration in `src/app/layout.tsx:64-74` | SVG icons only, no PNG, no `apple-touch-icon`, no favicon at all. |

---

### Feature: Landing page

- **Actors:** visitor (and, incidentally, logged-in member — the page does not check the session)
- **Entry points:** route `/`; logo link in the auth layout header (`(auth)/layout.tsx:18`) and in the `/invite` header.
- **Implementation:** `src/app/page.tsx` (server component). Reads `fulbot_lang` cookie (`:8-10`), renders brand "ful**bot**", tagline `t('landing.tagline')` ("Organiza partidos de fútbol con tus amigos"), three feature cards ("Inscripción rápida", "Equipos con IA", "Estadísticas"), two CTAs and a footer.

**UC: Visitor discovers the product and picks a CTA**
- Preconditions: none.
- Steps: open `/`. See the brand, tagline, three feature rows with chevrons (they are not links, `:52-65`), then the buttons "Crear cuenta" (`/register`) and "Iniciar sesión" (`/login`), footer "Hecho para organizar partidos de fútbol amateur".
- Result: navigation only; nothing written.
- Variants: If the `fulbot_lang` cookie is `en`, the same page renders in English. A logged-in user landing on `/` still sees "Crear cuenta"/"Iniciar sesión"; tapping either bounces via middleware to `/groups` (`lib/supabase/middleware.ts:61-66`). There is no "Ir a mis grupos" for logged-in users.

**Implemented vs stubbed:** fully implemented, static. Feature cards have hover styling and a chevron that suggests navigation but do nothing (`page.tsx:52-65`).

**Observed issues**
- A-L1 (UX): logged-in users are not redirected to `/groups` from `/`; landing shows signup CTAs to an authenticated user. `src/app/page.tsx` never calls `supabase.auth.getUser()`.
- A-L2 (UX): feature cards look tappable (`group hover:` + `ChevronRight`) but are inert (`page.tsx:52-65`).
- A-L3 (language): `landing.tagline` = "Organiza partidos…" is tú-form; plan §1 mandates vos ("Organizá"). Same for `groups.subtitle`, `groups.noGroupsDescription` ("Crea un grupo… únete a uno"), `settings` strings are vos, so the app mixes registers within the same screen (`src/i18n/es.json:60,71,75`).
- A-L4 (i18n): `<html lang="es">` is hardcoded in `src/app/layout.tsx:54` regardless of language; `metadata.title/description` (`layout.tsx:18-19`) are Spanish-only.

---

### Feature: Registration (sign up)

- **Actors:** visitor
- **Entry points:** `/register`; "Crear cuenta" on landing; link "Registrate" under the login form (`login-form.tsx:109-111`).
- **Implementation:** `src/app/(auth)/register/page.tsx` (server; reads cookie, wraps `RegisterForm` in `LanguageProvider`) + `register-form.tsx` (client; calls `supabase.auth.signUp` directly from the browser with `options.data = { name, preferred_language }`, `:55-64`). DB side: trigger `on_auth_user_created` → `handle_new_user()` (`00002:4-33`) inserts `public.users` (name from metadata or email local-part, language cast to `user_language` enum) and a `player_profiles` row with `display_name = name`.

**UC: Visitor creates an account**
- Preconditions: not logged in (middleware redirects authenticated users away from `/register`, `middleware.ts:61-66`).
- Steps: heading "Crear cuenta", subtitle "Ingresá tus datos para registrarte en fulbot". Fields: "Nombre" (placeholder "Tu nombre"), "Email" ("tu@email.com"), "Contraseña" ("Mínimo 6 caracteres"), "Confirmar contraseña" ("Repetí tu contraseña"), select "Idioma" with "Español"/"English". Button "Crear cuenta" (spinner while loading). Footer "¿Ya tenés cuenta? Iniciá sesión".
- Result: on success the form sets cookie `fulbot_lang=<lang>` (`:75`, also already set on select change `:33-36`), then `router.push('/groups')` + `router.refresh()`. Data written: `auth.users` row → trigger writes `public.users {id,email,name,preferred_language}` and `public.player_profiles {user_id, display_name}` with all defaults (`main_position 'CM'`, `overall_rating 3.00`, `reliability 1.00`, etc., `00001:37-59`).
- Variants & edge cases:
  - Client validation only: mismatch → "Las contraseñas no coinciden"; `<6` chars → "La contraseña debe tener al menos 6 caracteres". No name trim / length check; a name of spaces passes `required`.
  - Supabase error containing "already registered" → "Este email ya está registrado"; **any other Supabase error is shown raw in English** (`register-form.tsx:70`), e.g. rate limits, weak-password policy.
  - If the Supabase project has **email confirmation enabled**, `signUp` returns no session; the form still pushes to `/groups`, middleware bounces to `/login?redirect=/groups` with no message telling the user to check their inbox. The form does not pass `emailRedirectTo`, so the confirmation link goes to the Supabase Site URL, not to `/api/auth/callback`.
  - Changing "Idioma" writes the cookie immediately but does **not** re-render the form in the chosen language (the `LanguageProvider` value is fixed server-side; `register/page.tsx:12-14`). The select is effectively "language after you register".
  - If metadata `preferred_language` is not `es|en`, the enum cast in `handle_new_user` (`00002:15`) raises and Supabase returns "Database error saving new user" — cannot happen from this UI, but the trigger is not defensive.
  - No onboarding after signup: the user lands on the empty `/groups` state (see Dashboard). No prompt to complete the player profile (positions, foot, GK willingness) which the AI balancer relies on.

**Implemented vs stubbed:** fully implemented. `auth.forgotPassword` translation key exists (`es.json:50`) but there is **no** forgot-password UI or route anywhere (`grep resetPasswordForEmail` → none).

**Observed issues**
- A-R1 (spec 4.1 partial): "picks name and default language" ✔; email confirmation edge case unhandled (above).
- A-R2 (language mixing): raw Supabase error messages in English (`register-form.tsx:70`, `login-form.tsx:38`).
- A-R3 (data model): `users.name` and `player_profiles.display_name` are seeded identical but diverge after the first profile edit; the header keeps showing `users.name` forever (`(dashboard)/layout.tsx:25,36`; `header.tsx:112,125`). Nothing ever updates `users.name`.
- A-R4 (security, low): `supabase.auth.signUp` runs client-side with the anon key — standard for Supabase, but there is no server-side name sanitization; `display_name` is rendered as-is across the app (React escapes, so XSS is not an issue, but 500-char names are).
- A-R5 (i18n): placeholders "Tu nombre", "Mínimo 6 caracteres", "Repetí tu contraseña", "tu@email.com" are hardcoded Spanish inside an otherwise translated form (`register-form.tsx:110,140,155`; `login-form.tsx:74`).

---

### Feature: Login

- **Actors:** visitor
- **Entry points:** `/login`; "Iniciar sesión" on landing; "Iniciá sesión" link under register; header "Iniciar sesión" button when `user` is undefined (`header.tsx:160-165`, only reachable if the dashboard layout failed to load the `users` row); middleware redirect from any protected path (`?redirect=<path>`).
- **Implementation:** `(auth)/login/page.tsx` + `login-form.tsx` (client, `signInWithPassword`, wrapped in `Suspense` because of `useSearchParams`).

**UC: Returning user logs in**
- Preconditions: has an account.
- Steps: heading "Iniciar sesión", subtitle "Ingresá tu email y contraseña para acceder", fields "Email", "Contraseña", button "Iniciar sesión", footer "¿No tenés cuenta? Registrate".
- Result: `router.push(redirect ?? '/groups')` + `router.refresh()`. Session cookies set by `@supabase/ssr`. No DB writes.
- Variants: "Invalid login credentials" → "Email o contraseña incorrectos"; other errors raw English. Network/throw → "Ocurrió un error al iniciar sesión".
- Deep-link: `/groups/foo` while logged out → middleware sends to `/login?redirect=/groups/foo` (`lib/supabase/middleware.ts:53-58`); after login the form pushes to that path (`login-form.tsx:19,43`).

**UC: Auth callback (OAuth / magic link / email confirmation)**
- `GET /api/auth/callback?code=…&next=…` exchanges the code (`route.ts:9-11`), then redirects to `next` (default `/groups`). On failure → `/login?error=auth_failed` (`:28`).
- Not wired to anything in the UI: no OAuth buttons, no `emailRedirectTo` on signUp, no magic link.

**Implemented vs stubbed:**
- Login: implemented.
- Callback: implemented but effectively **dead** (nothing in the app generates a flow that lands on it) and `?error=auth_failed` is **never read** by the login page (`login-form.tsx` does not read `error`).
- Password reset: **missing entirely** (key `auth.forgotPassword` unused).

**Observed issues**
- A-A1 (security, open redirect): `login-form.tsx:19,43` does `router.push(searchParams.get('redirect'))` with no validation. `router.push('https://evil.example')` in the App Router falls back to a hard navigation, so `/login?redirect=https://evil.example` becomes a phishing-friendly open redirect after a successful login. Fix: accept only paths starting with a single `/`.
- A-A2 (security, open redirect): `api/auth/callback/route.ts:20` builds `https://${forwardedHost}${next}` with unvalidated `next`; `next=@evil.example` yields `https://myhost@evil.example` → browser goes to evil.example. Also `next=//evil.example` on `:18/:22` (`${origin}${next}` → `https://host//evil.example` — same host, harmless — but the `forwardedHost` branch is exploitable).
- A-A3 (dead code / footgun): `src/lib/supabase/server.ts:33-56` `createServiceClient()` binds the **service-role key to the user's cookie session**. Unused (grep → only its definition) and contradicts the plan §1 which sanctions `admin.ts`. Should be deleted.
- A-A4 (UX): after logout `header.tsx:30-33` pushes to `/login` without `router.refresh()`; Next's client router cache may keep the dashboard shell until next hard navigation (middleware protects the data, so it is cosmetic).
- A-A5 (i18n): auth layout footer "Hecho para organizar partidos de fútbol amateur" is hardcoded Spanish (`(auth)/layout.tsx:33`) even though `landing.footer` exists; the auth layout does not read the language cookie.
- A-A6 (UX): no "remember me"/session length control, no password visibility toggle, no `autoComplete` attributes on inputs (`login-form.tsx:71-95`), which hurts password managers on mobile.

---

### Feature: Session & route protection (middleware)

- **Actors:** system
- **Implementation:** `src/middleware.ts` (matcher excludes `_next/static`, `_next/image`, `favicon.ico`, image extensions) → `updateSession()` refreshes the Supabase session cookie on every matched request and enforces the two redirect rules.

**UC: Unauthenticated hit on protected path** → 302 to `/login?redirect=<pathname>` (query string of the original URL is dropped, `middleware.ts:54-57`).
**UC: Authenticated hit on `/login` or `/register`** → 302 to `?redirect` or `/groups` (`:61-66`); `url.pathname = redirectTo` here is safe (pathname setter cannot change host).
**UC: Dashboard layout double-check** — `(dashboard)/layout.tsx:14-20` calls `getUser()` again and `redirect('/login')` (without `?redirect=`), so a direct server render is also guarded.

**Observed issues**
- A-M1 (perf): `/manifest.json`, `/sw.js`, `/api/*` and `/m/*` all pass through the middleware, so every SW/manifest fetch triggers a `supabase.auth.getUser()` network call (`lib/supabase/middleware.ts:36-38`). Add them to the matcher exclusion. Comment at `middleware.ts:16` claims API routes are excluded — they are not.
- A-M2 (UX): dropped query string on redirect means `/groups/x/matches/y?tab=teams` → after login lands on `/groups/x/matches/y`.
- A-M3 (robustness): `NEXT_PUBLIC_SUPABASE_URL!` non-null assertions in `lib/supabase/middleware.ts:10-11` and `server.ts:9-10,37-38` vs. explicit throw in `client.ts:8-13` / `admin.ts:12-16` — inconsistent; a missing env var in middleware yields an opaque `createServerClient` error on every request.

---

### Feature: App shell / navigation (header, dashboard layout)

- **Actors:** member (any logged-in user)
- **Entry points:** every route under `src/app/(dashboard)/`.
- **Implementation:** `(dashboard)/layout.tsx` (server: fetches `users {name,email,avatar_url,preferred_language}`, wraps in `LanguageProvider`, renders `<Header user=…>` + `<main class="max-w-7xl …">`); `components/layout/header.tsx` (client).

**UC: Navigate via header**
- Sticky header with logo "ful**bot**" → `/groups`; desktop nav has exactly one item "Grupos" (`header.tsx:54-56`); bell icon (`aria-label="Notificaciones"`) → `/notifications` with unread badge from RPC `get_unread_notification_count` (refetched on every `pathname` change, `:37-52`); avatar button opens a dropdown showing name/email and "Mi perfil" (`/profile`), "Configuración" (`/settings`), "Cerrar sesión" (destructive red).
- Mobile (`<md`): hamburger toggles a panel that contains only "Grupos" (`:184-203`); profile/settings/logout remain in the avatar dropdown.
- Result of "Cerrar sesión": `supabase.auth.signOut()` then `router.push('/login')`.

**Implemented vs stubbed:** implemented. The mobile hamburger is functionally redundant (one link that duplicates the logo's destination).

**Observed issues**
- A-N1 (UX, mobile-first violated): hamburger menu with a single "Grupos" entry (`header.tsx:184-203`). Either drop it or move Profile/Settings/Notifications/Logout into it.
- A-N2 (UX): no "back" affordance anywhere in the shell; deep pages rely on their own back links.
- A-N3 (a11y): mobile menu button has no `aria-label`/`aria-expanded` (`:169-179`); user-menu button has no `aria-label`/`aria-haspopup` (`:106-109`); dropdown closes via an invisible full-screen div, no Escape handling.
- A-N4 (i18n): `aria-label="Notificaciones"` hardcoded (`:94`).
- A-N5 (data): if the `users` row is missing, `Header` receives `user=undefined` and renders an "Iniciar sesión" button inside the authenticated shell (`:159-165`) instead of failing loudly.
- A-N6 (badge accuracy): header count comes from `get_unread_notification_count()` (`00012:292-311`) which ignores `users.notification_prefs`, while `/notifications` filters by prefs client-side (`notification-list.tsx:68-72`). A user who disabled "Equipos armados" sees a badge "3" and an empty list.
- A-N7 (perf): `(dashboard)/layout.tsx` fetches `users` and each page (`groups/page.tsx:41-47`, `settings/page.tsx:16-22`) fetches it again for `preferred_language` (2× per request; unavoidable without a shared server cache, but `React.cache` would fix it).
- A-N8 (UX): active-link logic `pathname.startsWith('/groups')` (`:78,194`) — fine today, but `/groups/new` etc. all highlight "Grupos"; harmless.

---

### Feature: Dashboard (`/groups`)

- **Actors:** member (any role; role badge shown per group)
- **Entry points:** `/groups` (default post-login landing, PWA `start_url`, header logo, nav "Grupos").
- **Implementation:** `src/app/(dashboard)/groups/page.tsx` (server). Queries in sequence: `users.preferred_language` → `player_profiles.id` → `group_memberships(role, groups(...))` filtered `is_active` → upcoming `matches` for all groups → confirmed `match_signups` for the earliest match per group → finished matches in last 7 days → my confirmed signups → my MVP votes.

**UC: See my groups and jump to the next match**
- Steps: title "Mis grupos", subtitle "Organiza partidos de fútbol con tus amigos", top-right button "+ Crear grupo" (`/groups/new`). Grid of cards (1/2/3 columns). Each card: group name, role badge "Admin"/"Capitán"/"Miembro" (variant default/secondary/outline), optional description (2-line clamp), and a footer row: either a link "{Día} {HH:mm} · {n}/{max} confirmados" → `/groups/{slug}/matches/{id}` or muted "Sin partidos programados".
- Result: navigation only.
- Variants:
  - Next match = earliest `matches.date_time >= now()` with `status IN ('signup_open','full','teams_created')` (`:92-97`). **`signup_closed` and `draft` are excluded.**
  - Day/time rendered in the group's timezone via `weekdayIndexInTimezone`/`formatMatchTime` (`:303-304`); default `America/Argentina/Buenos_Aires`.
  - Card header (name/badge/description) links to the group; card body links to the match; two nested-looking links inside one card.

**UC: Empty state / onboarding**
- Preconditions: no active memberships.
- Steps: card with users icon, "No tenés grupos todavía", "Crea un grupo para organizar partidos con tus amigos o únete a uno existente con un código de invitación.", buttons "Crear grupo" (`/groups/new`) and outline "Unirse con código" (`/invite`).
- Result: navigation. This is the entire post-signup onboarding.

**UC: MVP voting nudge**
- Preconditions: a `finished` match in one of my groups, `date_time` within the last 7 days, where I have a `confirmed` signup and no `match_mvp_votes` row.
- Steps: yellow card above the title: trophy icon, "Votá el MVP de {grupo} — {dd/mm/yyyy}", "Elegí al mejor jugador del partido", chevron → match page.
- Result: navigation. Only the most recent qualifying match is shown (`:175-177`).
- Edge: nudge stays until they vote or 7 days pass; no dismiss.

**Implemented vs stubbed:** implemented per plan §2.5 (nudge) and §2.7 (next match on card). Spec §5.1 "shortcut to today's or next match" ✔.

**Observed issues**
- A-D1 (bug): `groups/page.tsx:97` filters `status IN ('signup_open','full','teams_created')`; the plan §1 makes `signup_closed` a real state, so a match whose signups the admin closed disappears from the card ("Sin partidos programados") even though it is the next match. Add `signup_closed` (and arguably `draft` for admins).
- A-D2 (UX/spec gap): "Unirse con código" is only reachable from the **empty** state (`:249-253`). A user who already has one group has no dashboard entry to join a second group (spec §4.2 "multiple groups per user"). Add it next to "Crear grupo".
- A-D3 (UX, mobile): header row `flex items-center justify-between` with an `h1` + subtitle and a full "Crear grupo" button (`:218-231`) — at 390px the subtitle wraps under a shrunken title. Also `Link > Button` (`:225-230`) nests a `<button>` in an `<a>` (invalid HTML, double focus stop).
- A-D4 (robustness): `if (!playerProfile) return null` (`:56-58`) renders a **blank page** for a user whose `player_profiles` row is missing (e.g. deleted, or trigger failed). Should show an error/create-profile path.
- A-D5 (perf): 7 sequential round-trips per render (`:41-171`); the finished-match + signup + vote lookups could be one RPC. Not a correctness issue.
- A-D6 (language): mixed tú/vos in the same screen — "Organiza…", "Crea un grupo… únete" vs "Votá el MVP", "Elegí…" (`es.json:71,75,89-90`).
- A-D7 (data): `nextMatchSummary` counts only `confirmed` (`:116`); waitlist size is not surfaced, and `max_players` is read from `matches` (fine).

---

### Feature: Player profile (`/profile`)

- **Actors:** member (own profile only; RLS `player_profiles` UPDATE `user_id = auth.uid()`, `00003:111-113`)
- **Entry points:** avatar dropdown → "Mi perfil".
- **Implementation:** `profile/page.tsx` (server: reads `users {name,email}` — unused — and `player_profiles *`) + `profile-form.tsx` (client, direct `.update()` via `(supabase as any)`, `:61-72`).

**UC: View my stats**
- Steps: title "Mi perfil", subtitle "Administra tu información de jugador". Left column: card with initials avatar (xl), `display_name`, optional nickname, main-position label, star + `overall_rating.toFixed(1)`; card "Estadísticas" with "Partidos jugados", "Goles", "Asistencias", "MVPs", and "Vallas invictas" only when `>0`; card "Confiabilidad" with a progress bar `reliability_score*100%` and caption "Basado en asistencia y cancelaciones".
- Result: read-only.

**UC: Edit my player info**
- Steps: right card "Información del jugador" / "Actualiza tu perfil para que los equipos se armen mejor". Fields: "Nombre" (max 50), "Apodo (opcional)" (max 20, placeholder "Cómo te dicen"), select "Posición principal" (10 options), chip toggles "Otras posiciones que jugarías (máx. 4)" (10 codes shown as raw codes GK/CB/…), radios "Pie hábil" (Diestro/Zurdo/Ambidiestro), range "Disposición para atajar (0 = nunca, 3 = me encanta)" with helper text per value ("No atajo ni loco", "Solo si no hay otra opción", "Puedo atajar si hace falta", "Me gusta atajar"), card radios "Estado físico actual" (Bien/Limitado/Lesionado with descriptions). Button "Guardar cambios".
- Result: `player_profiles.update({display_name, nickname, main_position, preferred_positions (falls back to [main_position] if empty), footedness, goalkeeper_willingness, fitness_status})`; success banner "Perfil actualizado correctamente" for 3 s; `router.refresh()`.
- Variants: failure → "Error al guardar los cambios" (generic). No confirmation on leaving with unsaved changes.

**Implemented vs stubbed:**
- Editing the balancer-relevant fields: implemented.
- **Avatar upload: not implemented.** `users.avatar_url` is never written anywhere (grep → only reads); `next.config.mjs:14-21` allows `*.supabase.co` images for nothing; `Avatar` always falls back to initials on this page (`profile/page.tsx:89` passes no `src`).
- **Badges: not shown on `/profile`.** `player_badges` is only read by `groups/[groupSlug]/players/[playerId]/page.tsx` and the match page; plan §2.5 says "Show badges on the profile page (already exists)" — that is the group-scoped player page, not `/profile`. Spec §5.4 lists "Badges" and "Recent matches summary" for the profile page: both missing here.
- `users.name/email` fetched at `:45-49` and unused.

**Observed issues**
- A-P1 (spec gap §5.4): no badges, no recent matches, no avatar on `/profile`.
- A-P2 (i18n): entire page and form hardcoded Spanish; `players.*` and `positions.*` keys exist in both JSON files but are unused here (`profile/page.tsx:9-36,79-80,109-178`; `profile-form.tsx` all labels). An English-language user gets a Spanish profile page while the header is English.
- A-P3 (inconsistency): position labels differ from the i18n dictionary: page says `ST: 'Delantero'`, `CF: 'Centro delantero'` (`profile/page.tsx:21-22`) while `es.json:221-222` says `ST: 'Delantero centro'`, `CF: 'Delantero'`.
- A-P4 (data): `POSITIONS` (`:25-36`) omits `LM`, `RM`, `CF` although the schema/dictionary allow them; a profile that already contains one of those in `preferred_positions` shows no chip for it and cannot remove it (`profile-form.tsx:41-51` only toggles rendered codes).
- A-P5 (UX): chips show raw codes ("CDM", "CAM") rather than names; "Diestro/Zurdo" here vs "Derecho/Izquierdo" in `players.left/right` keys.
- A-P6 (data model, see A-R3): editing "Nombre" updates `player_profiles.display_name` only; header/dropdown keep `users.name`. `users.name` is also what nothing else reads except the header, so the two names silently diverge.
- A-P7 (a11y/UX): fitness radios are `sr-only` with card labels — fine — but the three cards are `flex gap-4` with no wrap (`profile-form.tsx:222`), cramped at 390px.
- A-P8 (code): `(supabase as any)` in `profile-form.tsx:61` (allowed for untouched legacy files per plan §1, but this file has `Insert/Update` types available).
- A-P9 (security, low): `users` UPDATE policy (`00003:87-89`) has only `USING`, no `WITH CHECK` and no column list, so a client can set its own `users.email`/`avatar_url`/`name` to anything, decoupling `users.email` from `auth.users.email`. Nothing syncs `users.email` on auth email change either (no `AFTER UPDATE` trigger; `handle_user_deleted` in `00002:36-43` is defined but **no trigger is created** for it — dead function).
- A-P10 (missing): no change-password, change-email, or delete-account actions anywhere in profile/settings.

---

### Feature: Settings (`/settings`)

- **Actors:** member
- **Entry points:** avatar dropdown → "Configuración".
- **Implementation:** `settings/page.tsx` (server: reads `users {preferred_language, notification_prefs}` and the `fulbot_theme` cookie) + `settings-form.tsx` (client) + `settings/actions.ts` (`'use server'` `saveSettings`). Migration `00009` adds `users.notification_prefs jsonb NOT NULL DEFAULT '{}'`.

**UC: Change language**
- Steps: section "Idioma" / "Elegí el idioma de la interfaz", select Español/English. Tap "Guardar".
- Result: `users.preferred_language` updated; cookies `fulbot_theme` and `fulbot_lang` set for 1 year (`actions.ts:48-58`); `router.refresh()` re-renders the dashboard shell in the new language; banner "Configuración guardada correctamente".
- Edge: no live preview — labels switch only after save + refresh.

**UC: Change theme**
- Steps: section "Tema" / "Elegí cómo se ve fulbot", select "Claro"/"Oscuro"/"Automático (según el sistema)". Preview applies immediately by toggling `.dark` on `<html>` (`settings-form.tsx:48-63,83-86`).
- Result on save: cookie `fulbot_theme` only (no DB column). Root layout reads the cookie on every request (`app/layout.tsx:40-51`) and, for `system`, injects a blocking inline script (`:10,56-62`).
- Edge: if the user previews "Claro" and navigates away without saving, the client keeps the light class until a full reload (preview is not reverted). Theme is per-browser, not per-account: another device/PWA install is dark again.

**UC: Notification preferences**
- Steps: section "Notificaciones" / "Elegí qué te queremos avisar" with four switches: "Promoción de lista de espera", "Equipos armados", "Recordatorio de partido", "Resultados publicados" (each with a description). Missing keys default to `true` (`settings/page.tsx:50-55`).
- Result on save: `users.notification_prefs = {waitlist_promoted, teams_created, match_reminder, results_posted}`.
- **What reads them:** only `notifications/notification-list.tsx:68-72` (hides those types client-side). **Not** read by `emit_notification` (`00012:118-170`, which honours the *group's* `notification_settings` only), **not** by the outbox/WhatsApp dispatch, **not** by `get_unread_notification_count`, **not** by the reminders cron. So the toggles are cosmetic filters over an already-created in-app feed; the header badge still counts hidden items (A-N6) and WhatsApp still fires.
- Edge: no per-toggle save; one "Guardar" for everything; a failed save shows "Error al guardar la configuración" but the theme preview stays applied.

**Implemented vs stubbed:** language ✔, theme ✔ (cookie-only), notification prefs = **saved but only partially honored** (see above). Spec §5.6 satisfied on the surface.

**Observed issues**
- A-S1 (functional gap): `notification_prefs` are stored but do not stop notification creation or WhatsApp outbox rows; only the list view hides them. Owner should decide whether these are "mute in-app" (then fix the unread count) or true opt-outs (then filter in `emit_notification` for targeted rows / reminders).
- A-S2 (UX): duplicated heading — page `h1` "Configuración" + subtitle, then a Card whose `CardTitle`/`CardDescription` repeat the identical strings (`settings/page.tsx:36-45`).
- A-S3 (i18n): "No autenticado" thrown from `actions.ts:33` is Spanish-only and surfaces only as console error (the form maps any error to `settings.saveError`).
- A-S4 (design): theme not persisted per account (contract §2.7 explicitly chose the cookie, so this is a known trade-off, but worth stating to the owner).
- A-S5 (UX): saving the language does not propagate to `<html lang>` (A-L4) nor to `metadata.title`.
- A-S6 (spec §5.6 "Dark mode toggle"): implemented as a select, not a toggle; fine, but there is no quick toggle in the header.

---

### Feature: Internationalisation (i18n)

- **Actors:** system
- **Implementation:** `core.ts` (`translate`, `getTranslation`; nested-key lookup; `{param}` replacement via `String.replace` — first occurrence only, `core.ts:37-39`; missing key returns the key path), `server.ts` (`getT`), `provider.tsx` (`LanguageProvider` context + `useT`), `use-translations.ts` (client hook; re-exports `getTranslation` "for existing client importers" — nothing imports it that way anymore). Dictionaries `es.json` / `en.json`: 213 keys each, full parity.

**Surfaces that are translated (use `useT`/`getT`):** landing (`/`), login, register, header, `/groups` dashboard, `/settings`, match page header/status/signup actions, edit-match form (the last three are outside this area).

**Surfaces still hardcoded Spanish (in this area):** `(auth)/layout.tsx` footer; `/profile` page + form entirely; `header.tsx:94` aria-label; `app/layout.tsx` metadata + `lang`; `manifest.json` name/description; register/login placeholders. Outside this area but relevant to the owner: `/invite`, `/invite/[code]`, `/groups/new`, `/groups/[slug]/**` (group page, players, settings, matches list, create match, teams, results, voting), `/notifications`, `/m/[matchId]` — all listed by `grep -L useT|getT` under `src/app`.

**Unused dictionary namespaces:** `common.*` (except `save`), `players.*`, `positions.*`, `ratings.*`, `rules.*`, `notifications.*`, `teams.*`, most of `matches.*` besides status/signup keys, `auth.forgotPassword`, `auth.register`, `auth.registerError`, `auth.logout`, `common.appName` = "FUTBOT" (legacy brand name).

**Observed issues**
- A-I1 (architecture): three language sources. `users.preferred_language` drives the dashboard; the `fulbot_lang` cookie drives `/`, `/login`, `/register`; login never writes the cookie, so an English-preference user who logs in on a new device sees Spanish landing/login pages until they save `/settings` (`actions.ts:54-58` is the only other writer). Register writes the cookie, so the two are usually in sync only for the registering device.
- A-I2 (bug, minor): `translate` replaces only the first `{param}` occurrence (`core.ts:38`); no current string repeats a param, but it is a trap.
- A-I3 (quality): missing keys render as raw paths like `settings.foo` with no dev warning.
- A-I4 (brand): "FUTBOT" survives in `es.json:3`, `en.json:3`, `/invite` header, SW cache name `futbot-v1` (`sw.js:1`), migration headers; product is "fulbot" everywhere else.
- A-I5 (register): language select doesn't live-switch the form (see Registration).
- A-I6 (vos/tú mixing): see A-L3 / A-D6; English copy is consistent.

---

### Feature: PWA (manifest, service worker, install)

- **Actors:** visitor/member, system
- **Implementation:** `public/manifest.json`; `app/layout.tsx:20-25` (`manifest`, `appleWebApp {capable, statusBarStyle:'black-translucent', title:'fulbot'}`), `viewport.themeColor '#0a0a0f'`, `maximumScale: 1`; inline registration script `layout.tsx:64-74` (`navigator.serviceWorker.register('/sw.js')` on `load`, errors swallowed); `public/sw.js` (cache `futbot-v1`, precache `['/', '/manifest.json']`, `skipWaiting`, `clients.claim`, fetch handler: GET only, skips URLs containing `/api/` or `/auth/`, network-first, caches successful `navigate` responses, falls back to `caches.match`).

**UC: Install to home screen (Android/Chrome)**
- Manifest is valid: `name` "fulbot — Organiza tus partidos", `short_name` "fulbot", `start_url` `/groups`, `display standalone`, `orientation portrait`, `lang es`, icons 192/512 as **SVG** with `purpose "any maskable"`. Chrome accepts SVG icons; install prompt should appear once the SW is registered.
- Launch: opens `/groups`; if logged out → `/login?redirect=/groups`.

**UC: Install on iOS**
- `apple-mobile-web-app-capable` meta is emitted by Next from `appleWebApp`. iOS ignores manifest icons and needs `<link rel="apple-touch-icon">` PNG — **none exists** (`public/` has only `icons/*.svg`, `manifest.json`, `sw.js`; no `src/app/icon.*`, no `favicon.ico`, no `apple-icon.*`). Home-screen icon will be a page screenshot. `statusBarStyle 'black-translucent'` makes content render under the status bar; the sticky header (`header.tsx:59`) has no safe-area padding (`env(safe-area-inset-top)`), so in standalone mode on iOS the header sits under the clock.

**UC: Offline behaviour**
- On install the SW caches `/` and `/manifest.json`. Afterwards every successful HTML navigation is cached (including authenticated pages like `/groups`, `/profile`, match pages with names). Offline: a previously visited URL returns its stale HTML, but `_next/static/*` JS/CSS chunks are **not** precached or runtime-cached (they are not `navigate` requests, `sw.js:34`), so hydration depends on the browser HTTP cache; a never-visited page or a non-cached asset rejects with `undefined` from `caches.match` (`:40`) → `TypeError: Failed to fetch` instead of an offline page. Supabase REST GETs from client components also go through `respondWith` and fail the same way.

**Implemented vs stubbed:** manifest ✔, SW ✔ (naive), "basic offline caching of core shell" (spec) — **only nominally**: no static-asset caching, no offline fallback page, no cache versioning tied to the build.

**Observed issues**
- A-W1 (spec gap): no favicon, no PNG icons, no `apple-touch-icon` → poor iOS install experience; also browsers tab shows the default icon.
- A-W2 (privacy): SW caches authenticated HTML (`/groups`, `/profile`, match rosters) in Cache Storage (`sw.js:34-37`) and never clears it on logout; on a shared device the last user's pages remain readable offline. Either restrict runtime caching to public routes or clear caches on sign-out.
- A-W3 (correctness): `catch(() => caches.match(request))` can resolve `undefined` (`sw.js:40`); should fall back to a cached offline page or `Response.error()`.
- A-W4 (correctness): `_next/static` chunks are not cached, so "offline shell" is not actually achievable; a `next build` changes chunk hashes and the stale cached HTML references chunks that no longer exist → blank page after a deploy until the SW updates the entry (network-first mitigates when online).
- A-W5 (consistency): `theme_color` `#22c55e` in manifest vs `viewport.themeColor '#0a0a0f'` in layout vs dark `--background` `hsl(240 10% 3.9%)` (~`#09090b`) vs manifest `background_color '#0a0a0a'`; and `themeColor` is static dark even when the user picks the light theme (Next supports `themeColor` with `media`, or it could be computed from the cookie in `generateViewport`).
- A-W6 (a11y): `viewport.maximumScale: 1` (`layout.tsx:32`) disables pinch-zoom on iOS/Android — WCAG 1.4.4 violation; mobile-first spec.
- A-W7 (maskable): icon-192 has decorative elements out to x=160 and a circle r=80 (`icon-192.svg`), beyond the 80 % safe zone for `maskable`; on Android adaptive icons the ball is clipped. Using one `purpose: "any"` entry and a separate padded maskable icon is the usual fix.
- A-W8 (dev friction): SW registers in development too (`layout.tsx:66-72`) with `skipWaiting`+`clients.claim` and caches `/`, which serves stale pages during local dev; usually gated on `process.env.NODE_ENV === 'production'`.
- A-W9 (middleware): `/sw.js` and `/manifest.json` are not excluded from the auth middleware (A-M1).

---

### Feature: UI primitives (`src/components/ui/*`)

Read for completeness; small notes only.

- `button.tsx`: `asChild?: boolean` is declared (`:39`) but ignored — the component always renders `<button>`, so `Link > Button` nesting patterns (`groups/page.tsx:225-230,243-253`) produce `<a><button>` markup. Either implement `asChild` (Radix Slot) or expose `buttonVariants` for links (it is exported, `:55`, but unused for this purpose here).
- `avatar.tsx`: initials from `fallback.split(' ')` — a name like "  Juan" or an emoji-only name yields "" / broken initials; plain `<img>` (fine, no `next/image` needed) with `onError` fallback ✔. No `alt` when `src` is absent (decorative div, acceptable).
- `badge.tsx` `success`/`warning` variants use fixed `bg-green-500`/`bg-yellow-500` — do not adapt to the light theme tokens; role badge `outline` variant on `/groups` has no border color in light mode beyond `border` default (readable, but low contrast on white cards).
- `card.tsx`: `CardTitle` renders `<h3>` at `text-2xl` default; `/groups` overrides to `text-lg`, `/profile` to `text-base` — heading levels skip (`h1` → `h3`).
- `copy-button.tsx`: `navigator.clipboard.writeText` without `await`/catch — on iOS Safari outside a user-gesture-safe context it can reject silently; button has no `aria-label` (icon-only).
- `input.tsx`/`label.tsx`/`spinner.tsx`: fine. Login/register forms **do not use** `Input`/`Label`; they duplicate the class string (`login-form.tsx:79,94`, `register-form.tsx:85-86`) — drift risk (already drifted: `disabled:cursor-not-allowed` missing).
- `globals.css`: light palette is the `:root` default, `.dark` overrides ✔ (plan §2.7). `.glow-sm/.glow-md` use a hardcoded green `hsl(152 76% 48%)` rather than `--primary`, so in light mode the glow is the dark-theme green.

---

## Spec / contract compliance summary

| Spec item | Status |
|---|---|
| §4.1 email/password auth | ✔ (client-side Supabase). No password reset, no email-change. |
| §4.1 pick name + default language at signup | ✔ (`register-form.tsx`, trigger `00002`). Language select does not live-switch the form. |
| §4.1 create group or join via link; player profile auto-created | Profile auto-created at signup ✔; join via `/invite/[code]` exists (other area). No guided onboarding beyond the empty state. |
| §5.1 dashboard: groups list + next-match shortcut | ✔, but next-match query omits `signup_closed` (A-D1); "join with code" only in empty state (A-D2). |
| §5.4 profile: avatar/initials, name, positions, foot; stats; recent matches; badges | Initials/name/positions/foot/stats ✔. **Avatar upload, recent matches, badges missing** on `/profile` (A-P1). |
| §5.6 settings: language, dark mode, notification prefs | ✔ on the surface; prefs only filter the in-app list (A-S1); theme cookie-only (A-S4). |
| §6 default Spanish, English via i18n | Partial: the surfaces listed in plan §2.7 are migrated; `/profile`, auth layout footer, and everything under `/groups/[slug]`, `/invite`, `/notifications`, `/m` remain Spanish. Copy mixes tú/vos. |
| PWA: manifest, SW, offline core shell | Manifest ✔, SW ✔ but no static-asset caching, no offline page, no PNG/apple icons, no favicon (A-W1..W8). |
| Plan §2.7 (T6) contract | `admin.ts` ✔; `/settings` ✔; `LanguageProvider`/`useT`/`getT` ✔; migrated surfaces ✔; next-match card ✔ (with A-D1). |

## Prioritised issue list (this area)

1. **A-A1 / A-A2** — open redirects in `login-form.tsx:19,43` and `api/auth/callback/route.ts:20`. Validate `redirect`/`next` as same-origin paths.
2. **A-D1** — `/groups` next-match filter excludes `signup_closed` (`groups/page.tsx:97`).
3. **A-S1 / A-N6** — notification prefs are cosmetic; unread badge ignores them.
4. **A-W1 / A-W2 / A-W6** — no favicon/PNG/apple icons; SW caches authenticated pages; pinch-zoom disabled.
5. **A-P1 / A-P2** — `/profile` lacks badges/recent matches/avatar and is untranslated.
6. **A-R3 / A-P6** — `users.name` vs `player_profiles.display_name` divergence visible in the header.
7. **A-I1** — language cookie not synced on login; three sources of truth; `<html lang>` fixed.
8. **A-D2 / A-N1** — join-group only in empty state; mobile hamburger with one entry.
9. **A-A3** — delete `createServiceClient` (`server.ts:33-56`).
10. **A-R1** — email-confirmation-enabled projects break the post-signup redirect silently; no password reset flow.
11. Copy hygiene: tú/vos mixing, "FUTBOT" leftovers, hardcoded placeholders, duplicated settings heading.
