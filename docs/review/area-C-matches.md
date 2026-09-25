# Area C — Match lifecycle & signup flow (review notes)

Reviewed against `init-prompt.md` §4.3, §4.4, §4.8, §5.3 and `docs/rework-plan.md` §1–§2.4. All paths are relative to `/Users/maxo/orca/workspaces/fulbot/rework`. UI strings quoted verbatim (Spanish unless noted). "M-page" = `src/app/(dashboard)/groups/[groupSlug]/matches/[matchId]/page.tsx`; "P-page" = `src/app/m/[matchId]/page.tsx`.

---

## 0. Data model actually in use

| Table | Relevant columns | Notes |
|---|---|---|
| `matches` (00001:112-124) | `group_id, date_time timestamptz, location, status match_status default 'draft', max_players smallint default 14, recurring_pattern_id, ai_input_snapshot, notes` (+ `results_finalized`, `mvp_player_id` from later migrations) | No `created_by`. Unique partial index `(recurring_pattern_id, date_time)` (00010:58-60). |
| `match_signups` (00001:144-172) | `match_id, player_id XOR guest_player_id (CHECK), status signup_status default 'confirmed', signup_time, cancel_time, position_preference, notes, waitlist_position` | `UNIQUE(match_id, player_id)` = `unique_player_signup`; `UNIQUE(match_id, guest_player_id)` = `unique_guest_signup`. One row per (match, person) forever; cancel = `status='cancelled'`, re-signup = upsert on the same row. |
| `guest_players` (00001:128-140 + 00007:17-18) | `display_name, notes, estimated_rating 3.00, preferred_positions ['CM'], created_by_user_id, group_id, self_signup_token uuid unique null` | A **new row is created per admin "Agregar invitado"** (00007:244-246) and per new self-signup token (00007:533-535). No dedup by name, no guest management UI. |
| `recurring_patterns` (00010:15-29) | `group_id, weekday 0-6, match_time, location, max_players default 14, signup_opens_weekday, signup_opens_time, timezone default BA, is_active` | Table allows N per group; UI assumes 1 (settings page takes the newest, `settings/page.tsx:130-136`). |
| `match_status` enum | `draft | signup_open | signup_closed | full | teams_created | finished | cancelled` (00001:13 + 00006) | |
| `signup_status` enum | `confirmed | waitlist | cancelled | did_not_show` | |

RLS that matters here (00003):
- `matches`: SELECT members; INSERT **admin only** (170-172); UPDATE admin **or captain** (174-176); DELETE admin only (178-180).
- `match_signups`: SELECT members; INSERT own row if member (195-203); UPDATE own row, **no WITH CHECK / no column restriction** (205-207); ALL for admins (209-216).
- `guest_players`: SELECT members; ALL for admins (343-348).
- `groups`: `"Anyone can read group by invite code" USING (TRUE)` (125-127) — every group row (incl. `invite_code`) is readable by any authenticated user; the P-page relies on this to get the invite code for non-members.
- `recurring_patterns`: SELECT members; ALL **admin only** (00010:68-77) — captains cannot edit the recurring pattern.

Anon-callable RPCs after 00013 (lines 38-45): `get_current_player_id, is_group_member, is_group_admin, is_group_admin_or_captain, get_public_match, public_guest_signup, cancel_guest_signup` (+ `get_public_group_by_invite` from 00016:53).

---

## 1. Match status state machine

### 1.1 As enforced by `admin_set_match_status` (00007:362-428)

Preconditions: match exists; caller `is_group_admin_or_captain(group)`. Same status → no-op returning the row (382-384).

| From | Allowed targets |
|---|---|
| `draft` | `signup_open`, `cancelled` |
| `signup_open` | `signup_closed`, `full`, `teams_created`, `cancelled` |
| `full` | `signup_closed`, `signup_open`, `teams_created`, `cancelled` |
| `signup_closed` | `signup_open`, `teams_created`, `cancelled` |
| `teams_created` | `finished`, `cancelled` |
| `finished` | none (terminal) |
| `cancelled` | none (terminal — a cancelled match can never be restored, only deleted) |

Special rule (409-421): any request for `signup_open` is rewritten to `full` if `confirmed_count >= max_players` at that moment.

Not allowed (worth knowing): `teams_created → signup_open/signup_closed` (cannot reopen the list once teams exist, although players can still drop out — see §3.5), `finished → cancelled`, `cancelled → anything`.

### 1.2 Transitions that happen OUTSIDE the state machine

| Trigger | Effect | Where |
|---|---|---|
| Create form checkbox "Abrir inscripciones inmediatamente" | initial `signup_open` or `draft` via direct INSERT | `matches/new/create-match-form.tsx:47-58` |
| Recurring generator | inserts directly as `signup_open` | 00010:165-172 |
| `signup_for_match` reaching capacity | `→ full` (only reachable from `signup_open`, guarded at 00007:128) | 00007:172-174 |
| `public_guest_signup` reaching capacity | `→ full` (guarded to `signup_open/full`, 00007:512) | 00007:563-565 |
| `admin_add_guest_signup` reaching capacity | `→ full` **unconditionally** — only `finished/cancelled` are rejected (00007:240-242), so **`draft → full`, `signup_closed → full`, `teams_created → full`** are all possible | 00007:270-272 |
| `promote_from_waitlist` | reconciles `full ⇄ signup_open` by count, only while status is one of those two | 00012:248-254 |
| AI team generation route | direct `UPDATE matches SET status='teams_created'` **with no check on the current status** (route selects `status` at line 49 but never reads it) → e.g. `draft`, `finished`, `cancelled` → `teams_created` | `src/app/api/matches/[matchId]/teams/generate/route.ts:283-289` |
| Edit form | never touches status | `edit/edit-match-form.tsx:48-56` |

There is no automatic `→ finished` when the date passes; a match stays `signup_open`/`full`/`teams_created` forever until an admin clicks "Marcar como finalizado".

### 1.3 Where each UI action lives (`match-admin-actions.tsx`, card "Administrar partido", admin + captain only, rendered in the right sidebar of the M-page)

| Shown when | Button label | Calls |
|---|---|---|
| `draft` | "Abrir inscripciones" | `admin_set_match_status(signup_open)` (92-106) |
| `signup_open` \| `full` | "Cerrar inscripciones" | `admin_set_match_status(signup_closed)` (109-123) |
| `signup_closed` | "Reabrir inscripciones" | `admin_set_match_status(signup_open)` (→ may become `full`) (126-140) |
| `signup_open` \| `full` \| `signup_closed` **and** ≥4 confirmed | "Armar equipos" (link to `/teams`) | generate route → `teams_created` (143-150) |
| `teams_created` | "Marcar como finalizado" | `admin_set_match_status(finished)` (153-167) |
| anything except `cancelled` (card hidden for `finished`) | "Cancelar partido" (red outline) | `admin_set_match_status(cancelled)` (170-184) — **no `confirm()` dialog** |
| `draft` \| `cancelled` | "Eliminar partido" (ghost, red) | `confirm('¿Estás seguro de eliminar este partido? Esta acción no se puede deshacer.')` then hard `DELETE FROM matches` via `(supabase as any)` (52-74, 187-201). RLS = admin only → a **captain gets `alert('Error al eliminar el partido')`**. |

Errors from any status change surface as `alert('Error al actualizar el estado')` (46) — the SQL message (`Transición de estado inválida: a -> b`) is only logged to console.

---

## 2. Recurring matches — how the next occurrence and signup-open are computed

`generate_recurring_matches(p_group_id default null)` (00010:96-195), SECURITY DEFINER, all math in SQL:

1. Authorization: with `p_group_id` → caller must be **any active member** (114-117); with NULL → JWT role must be `service_role` (118-122).
2. For each `is_active` pattern: `local_now = now() AT TIME ZONE pattern.timezone`; `days_diff = (weekday - today_dow + 7) % 7`; candidate = `local_now::date + days_diff` at `match_time`, converted back to an instant with `AT TIME ZONE pattern.timezone` (129-135).
3. If the candidate instant is `<= now() - 2 hours`, roll forward 7 days (139-143). So a match in progress (started < 2 h ago) still counts as "the next one" and blocks generation of next week's until 2 h after kickoff.
4. Signup-open moment = the Sun–Sat week containing the candidate date, day `signup_opens_weekday`, at `signup_opens_time`; if that lands **after** the match, use the previous week's (148-158). Example "Lunes 21:00, abre Domingo 12:00, BA": candidate Monday → week starts that Sunday → Sunday 12:00 BA. Example "Domingo 20:00, abre Sábado 12:00": Saturday of the same Sun–Sat week is *after* Sunday → previous Saturday. Correct.
5. If `signup_instant <= now()` and no `matches` row exists with `(recurring_pattern_id, date_time = candidate)` → INSERT `status='signup_open', location, max_players, recurring_pattern_id` (160-172). `unique_violation` from the partial unique index is swallowed (186-189) so the cron and a lazy page load can race safely.

Consequences:
- **The match row does not exist before the signup-open moment.** There is no "draft next Monday" to preview; nobody can see or announce the next match before Sunday 12:00.
- **"Signups open" = "the row gets created", and creation only happens when something calls the RPC**: (a) `vercel.json` → `GET /api/cron/daily` at `0 12 * * *` = **12:00 UTC = 09:00 Buenos Aires** (fixed, not derived from the pattern), or (b) any member opening the group page (`groups/[groupSlug]/page.tsx:156-163`, best-effort, runs as that user). For the canonical "Sunday 12:00 BA" config the cron at 09:00 BA is **too early** on Sunday, so the match materialises only when the first member opens the group page after 12:00 — otherwise **Monday 09:00 BA**, 21 h late. The `/m/…` public page and `/matches` list do **not** trigger generation.
- `match_created` notification is emitted by the TS caller after the RPC (`src/lib/notifications/match-created.ts:30-85`), idempotent by absence of an existing `match_created` row, and **only for matches with `recurring_pattern_id`** (line 38). Manually created matches never emit `match_created` (spec §4.3/§4.8 "on match creation … post/simulate a message").
- Editing a recurring match's date/time (edit form) changes `date_time`, so the EXISTS check no longer matches → the generator **creates a duplicate** for the original slot on the next run. Deleting a cancelled recurring match ("Eliminar partido") → the generator **re-creates it** while the occurrence is still within the window.
- Pattern `timezone` is independent from `groups.timezone`. Matches are generated in the pattern's zone but displayed everywhere with the group's zone (`timeZone = group.timezone || DEFAULT_TIMEZONE`). If they differ, the shown hour differs from what the admin typed.
- Recurring matches get no `notes`, no rules, and `max_players` from the pattern (not group defaults).

Settings UI (`settings/recurring-pattern-form.tsx`, card "Partido recurrente" / "Configura el partido que se arma solo cada semana", admin-only page): fields "Día del partido" (select Domingo…Sábado), "Hora del partido", "Lugar", "Jugadores máx." (4–30), "Día en que abre inscripción" (defaults to the day before the match, line 67), "Hora en que abre inscripción" (default "12:00"), "Zona horaria" (8 presets + "Otra (escribir)…" free-text, no IANA validation client-side — an invalid zone makes the SQL loop raise for *every* group sweep, since one bad pattern aborts the whole `generate_recurring_matches` call in the cron path). Buttons "Guardar" (always sets `is_active: true`, 112/122) and "Desactivar"/"Activar". Success "Partido recurrente guardado correctamente". No delete. `created_by_user_id` is never set by the form.

---

## 3. Features and use cases

### Feature: Match list (group page + `/groups/[slug]/matches`)
- Actors: member, captain, admin (logged-in non-members → `notFound()`).
- Entry points: group page section "Próximos partidos" + "Ver todos" → `/groups/[slug]/matches`; header button "Crear partido" (admin + captain) on both pages.

**UC: Browse upcoming/past matches** — Preconditions: active membership. Steps: `/matches` shows "Partidos", "{n} partidos en total", section "Próximos partidos" (cards: `formatMatchDate` "Lunes 7/9/2026", time · location, "{confirmed}/{max} jugadores", colored status pill) and "Partidos anteriores" (compact rows, "{n} jugadores", outline badge). Result: navigation to the M-page. Variants: empty → calendar icon "No hay partidos programados" (+ "Crear partido" for admin/captain). Upcoming = `date >= now && status != cancelled`; past = date < now **or cancelled** (`matches/page.tsx:97-103`).
- Implemented; no pagination; N+1 count queries per match (81-94; group page 191-202).
- Issues:
  - Group page "Próximos partidos" filters `status in (draft, signup_open, full, teams_created)` (`groups/[groupSlug]/page.tsx:184`) → **a `signup_closed` match vanishes from the group page** (still in `/matches`). Same omission on the `/groups` dashboard next-match card (`groups/page.tsx:96`). The `statusLabels` map on the group page does include `signup_closed` (line 327), so the filter is an oversight.
  - Status labels are duplicated in three hardcoded Spanish maps (`matches/page.tsx:14-22`, group page 317-330) while the M-page uses `t('matches.status.*')` — an EN user sees Spanish here.
  - Draft matches are visible to plain members with a "Borrador" pill (RLS lets members read all statuses).

### Feature: Create one-off match
- Actors: admin (works), captain (UI allows, RLS rejects).
- Entry: "Crear partido" → `/groups/[slug]/matches/new`; page card "Crear partido" / "Programa un nuevo partido para {group}".

**UC: Create a match** — Steps: form "Fecha" (prefilled next `default_match_day`), "Hora" (prefilled `default_match_time` or 21:00), "Lugar (opcional)" placeholder "Ej: Cancha del club" (max 200), "Jugadores máximo" (4–30, default `default_max_players`, hint "Cuando se alcance el límite, los siguientes quedarán en lista de espera"), "Notas (opcional)" placeholder "Ej: Traer pechera" (max 500), checkbox "Abrir inscripciones inmediatamente" / "Si no, el partido quedará como borrador" (checked by default); buttons "Crear partido" / "Cancelar" (`router.back()`). Result: direct INSERT into `matches` with `date_time = combineDateTimeInTimezone(date, time, group.timezone)`, `status` `signup_open` or `draft`; redirect to the M-page (which shows the announcement card). No `match_created` notification, no rules, no recurring link. Variants: any error → "Error al crear el partido".
- Issues:
  - `new/page.tsx:55` lets captains in, but `matches` INSERT RLS is `is_group_admin` (00003:170-172) → captain always gets "Error al crear el partido". Spec §4.2: only admins manage matches.
  - Default date computed with server-local time (`new Date()`, `getDay()`, `setHours`, `toISOString()` — `new/page.tsx:60-81`): on Vercel (UTC) the "is it past today's default time" check is done in UTC. E.g. Monday 19:00 BA (22:00 UTC) with default 21:00 → proposes *next* Monday.
  - No lower bound on date (can create in the past); no check that `time`/`date` are valid beyond HTML `required`.
  - Uses `(supabase as any)` (47) — allowed by plan for untouched files, but the file was touched (timezone handling).
  - Spec §4.3 "uses group defaults: location" — there is no group default location; the create form leaves "Lugar" empty even if a recurring pattern has one.

### Feature: Edit match
- Actors: admin, captain (RLS allows captain UPDATE).
- Entry: M-page header button "Editar" (`t('common.edit')`, admin/captain only) → `/matches/[id]/edit`; card `t('matches.editMatch')` "Editar partido" / "Modificá los datos del partido".

**UC: Edit date/time/location/max/notes** — Steps: same fields as create, prefilled through `splitDateTimeInTimezone` (`edit/page.tsx:67`); "Guardar" / "Cancelar". Result: direct UPDATE of the four columns; redirect to M-page. Errors → `t('common.error')` = just "Error".
- Issues:
  - **Changing `max_players` does not reconcile anything**: lowering below the confirmed count leaves everyone confirmed and status `signup_open` while "Disponibles" shows 0; raising it on a `full` match keeps status `full` and **does not promote the waitlist** — the next newcomer calling `signup_for_match` gets `confirmed` (count < max) and **jumps the queue** over waitlisted players (00007:144-146 vs no promotion).
  - No status gating: `finished`/`cancelled`/`teams_created` matches are editable (date can be moved after results exist).
  - Editing the date of a recurring occurrence → duplicate generation (see §2).
  - The plan's §2.7 says "admin/captain only"; spec §4.2 says admins only. Captains can edit through RLS 00003:174-176.

### Feature: Match detail page (`/groups/[slug]/matches/[id]`)
- Actors: member / captain / admin only. Logged-in non-member or user without player profile → `notFound()` (M-page 69, 91); no redirect to `/m/[id]`.
- Layout (M-page 355-593): back link `t('common.backTo')`; H1 "{Día} {d/M/yyyy}" + status Badge (`t('matches.status.*')`); optional "MVP: {name}"; meta row time, location, "{confirmed}/{max} jugadores"; admin/captain "Editar"; notes card; **"Anuncio del partido"** card (only `signup_open`/`full`, 424-434); left column: `SignupActions` (hidden when past, `cancelled`, `finished`), card "Confirmados ({n}/{max})", card "Lista de espera ({n})" (only when >0 — the `emptyMessage="No hay nadie en espera"` at 485 is dead), results/voting for `finished`; right column: `MatchAdminActions`, `AddGuestForm` (admin/captain, not `finished`/`cancelled`), `RulesManager` (admin/captain, `signup_open`/`full` only), card "Estadísticas": "Inscritos", "En espera", "Disponibles".
- `RealtimeWrapper` subscribes to `postgres_changes` on `match_signups` filtered by match and calls `router.refresh()`. **No migration adds `match_signups` to the `supabase_realtime` publication** (grep over `supabase/` finds none) — live refresh only works if enabled by hand in the Supabase dashboard; otherwise the page is static until reload. Status changes on `matches` (e.g. admin closes signups) are not subscribed at all.
- Issues:
  - **Once teams exist, there is no link to the lineup.** The only link to `/teams` in the whole app is the admin "Armar equipos" button (grep: `match-admin-actions.tsx:144`), shown only during signup phases. In `teams_created` state, neither members nor admins have a button to open `/teams` (must type the URL). Spec §5.3 "Once teams exist: Lineup view".
  - Language mixing on one screen: header/status/back via `t()`; everything else hardcoded Spanish ("Confirmados", "Lista de espera", "Estadísticas", "Inscritos", "Nadie se inscribió todavía", admin card, guest form, announcement). "Inscritos" (M-page 575) is peninsular; the rest of the app says "anotados"/"Confirmados". `signup-list.tsx:178` badge "Tú" (should be "Vos").
  - The `Badge`-based status pill has no color coding on the M-page (variants only), unlike the list pages.

### Feature: Member self-signup / cancel (in-app, `signup-actions.tsx`)
- Actors: member, captain, admin (all through `signup_for_match` / `cancel_my_signup`, `auth.uid()`-derived).
- Entry: card at the top of the M-page.

**UC: Sign up** — Preconditions: status `signup_open` or `full`, match date in the future (UI), no active signup. Steps: card text "Inscribite al partido" / "Hay lugar disponible" (or "El partido está completo" / "Podés anotarte en la lista de espera" when `confirmed >= max`), button "Anotarme" or "Anotarme en espera". Result: RPC `signup_for_match(p_match_id)` (no notes/position UI even though the RPC accepts them) → row upserted on `unique_player_signup` (00007:156-170) as `confirmed` (count < max) or `waitlist` with `waitlist_position = max+1`; match → `full` if capacity reached; `router.refresh()`. Variants: RPC raises `'No sos miembro de este grupo'`, `'El partido no está aceptando inscripciones'`, `'Ya estás inscripto en este partido'` — all collapsed into `t('matches.signupError')` "Error al inscribirse. Intentá de nuevo."; `signup_closed` → text "Las inscripciones están cerradas" / "El admin todavía no las volvió a abrir" and disabled button; `draft`/`teams_created` → **the generic "Inscribite al partido / Hay lugar disponible" text with a disabled button** (102-119; misleading — nothing explains why).

**UC: Cancel (confirmed)** — green card "Ya estás anotado" / "Tenés tu lugar confirmado", button "Bajarme" → `confirm('¿Estás seguro de que querés bajarte del partido?')` → `cancel_my_signup` → row `cancelled`, `cancel_time`, then `promote_from_waitlist` (first waitlisted → confirmed, reorder positions, `waitlist_promoted` notification, status reconciled). **No status check in `cancel_my_signup`** (00007:180-207): works in `signup_closed` and `teams_created` too — a player can drop after teams are built; the promoted player is not on any team and nobody is told to regenerate.

**UC: Leave waitlist** — yellow card "Estás en la lista de espera" / "Posición #{n} - Te avisaremos si se libera un lugar", button "Salir de espera" → same RPC; position renumbering happens only through `promote_from_waitlist` (which runs, finds count < max false... note: when a *waitlisted* player cancels, `promote_from_waitlist` is still called; since count == max nothing is promoted and **the remaining waitlist positions are not renumbered** (00007:56-81 only reorders inside the promotion branch) → gaps like #1, #3. `admin_remove_signup` handles this case explicitly (00007:309-320) but `cancel_my_signup`/`cancel_guest_signup` do not.)

**UC: Re-signup after cancel** — allowed while open; upsert resets `signup_time = NOW()` (goes to the back of the confirmed order / waitlist). Late-cancel penalties (spec §3.2 reliability "late cancels") are not computed here.

- Race conditions: `signup_for_match`, `public_guest_signup`, `admin_add_guest_signup` all `SELECT … FOR UPDATE` the match row first (00007:119, 231, 507) → two people taking the last spot are serialized; second one goes to waitlist. OK. `admin_remove_signup` locks only the signup row and reads the match without lock (286-291); its waitlist renumbering (311-320) can interleave with a concurrent signup computing `MAX(waitlist_position)+1` → duplicated positions (cosmetic).
- Integrity hole (authenticated members only): RLS lets a member `INSERT` their own `match_signups` row with `status='confirmed'` regardless of capacity/status (00003:195-203) and `UPDATE` their own row to any status/position (205-207, no `WITH CHECK`). With the anon key + their JWT they can bypass the RPCs (jump the waitlist, sign into a closed match). The plan's "reads and simple member writes may stay in client components through RLS" is fine, but these two policies should be dropped now that RPCs exist.

### Feature: Waitlist & auto-replacement
- Implemented in SQL (`promote_from_waitlist`, 00012:180-258 replaces 00007:38-94 with same logic + `waitlist_promoted` notification carrying `recipient_player_id` for players, none for guests).
- Called from: `cancel_my_signup`, `cancel_guest_signup`, `admin_remove_signup` (if was confirmed), `admin_set_signup_status` (if was confirmed and match in `signup_open/full/signup_closed`, 00014:59-64).
- Order: `waitlist_position ASC NULLS LAST, signup_time ASC`. Promotion happens even in `signup_closed`/`teams_created` (function only refuses to *touch status* outside `signup_open/full`) — consistent with §4.4 auto-replacement, but in `teams_created` the promoted player has no team.
- Not called when `max_players` is raised (see Edit).
- Spec §4.4 "Notify the group via in-app notification (and WhatsApp if configured)": the `waitlist_promoted` row is addressed to the promoted player (`recipient_player_id`), so the *group* is not notified in-app; outbox text "¡{name} entró! …" goes to the WhatsApp webhook if configured.

### Feature: Guests added by admin (`add-guest-form.tsx`)
- Actors: admin, captain (RPC checks `is_group_admin_or_captain`; owner decision #2 says "only admins").
- Entry: sidebar button "Agregar invitado" (any status except `finished`/`cancelled`).

**UC: Add guest** — Steps: inline form "Agregar jugador invitado", "Nombre *" placeholder "Nombre del invitado", "Notas" placeholder "Ej: amigo de Juan, juega de delantero", hint "Quedan {n} lugares disponibles." or "El partido está completo. El invitado irá a lista de espera.", buttons "Agregar" / "Cancelar". Result: `admin_add_guest_signup` → new `guest_players` row (`created_by_user_id = auth.uid()`, `group_id`) + signup `confirmed`/`waitlist`; may flip status to `full`. Errors → "Error al agregar invitado".
- Spec §4.4 "Guests can be added directly to confirmed or waitlist" — there is no choice; placement is automatic by count.
- Issues:
  - **Adding a guest is allowed in `draft`, `signup_closed`, `teams_created`** and can flip any of them to `full` (00007:270-272), silently *reopening* a closed list (`full` accepts signups) or reverting a `teams_created` match. Contradicts owner decision #3 ("the list freezes").
  - Every add creates a fresh `guest_players` row → "Juan" ×10 over the season; the AI snapshot/team history treats each as a different person; no reuse/pick-from-previous-guests UI (spec §3.9 implies persistent guest entities).
  - Guest `notes` written to both `guest_players.notes` and `match_signups.notes` (00007:244-266) — redundant.
  - Captain can add guests (RPC + UI) vs decision "only admins".

**UC: Remove anyone (player or guest)** — `signup-list.tsx:235-247`: "X" icon (title "Sacar del partido") shown to admin/captain next to every non-no-show row in **any status, including `finished`** → `confirm('¿Seguro que querés sacar a {name} del partido?')` → `admin_remove_signup` → row `cancelled`, waitlist promoted/renumbered. Errors → `alert('Error al sacar del partido')`. Issues: removing on a `finished` match rewrites attendance history; removing on `teams_created` leaves the team assignment orphaned. Guests removed this way can't remove themselves (no UI for a guest inside the app — by design).

**UC: Toggle no-show** — only on `finished` (83, 215-233), icons UserX/RotateCcw with titles "Marcar que no vino" / "Marcar como presente", badge "No vino" — belongs to Area post-match but lives in this list.

### Feature: Announcement (`match-announcement.tsx`)
- Actors: everyone who can see the M-page (members too, not just admins); shown for `signup_open` and `full` only (M-page 424).
- Card: "Anuncio del partido" / "Copiá o compartí este texto en el grupo de WhatsApp", `<pre>` with the text, buttons "Copiar" → "Copiado" (2 s) and "Compartir por WhatsApp" (`https://wa.me/?text=…`, new tab).

Template (`buildAnnouncementText`, lines 24-47), line by line:
```
⚽ {groupName} — {Lunes 7/9} {21:00}
📍 {location}                                   ← only if location is set
👥 {confirmed}/{max} anotados — faltan {n} lugares   ← or "no quedan lugares" when n = 0
👉 Anotate acá: {NEXT_PUBLIC_APP_URL}/m/{matchId}
Remera oscura/clara según tu equipo.
```
Concrete example: `⚽ Fútbol lunes — Lunes 7/9 21:00\n📍 Cancha del club\n👥 3/14 anotados — faltan 11 lugares\n👉 Anotate acá: https://app/m/uuid\nRemera oscura/clara según tu equipo.`

- Issues: `NEXT_PUBLIC_APP_URL` falls back to `http://localhost:3000` (37) — a missing env var ships localhost links to WhatsApp; `navigator.clipboard.writeText` unguarded (55) → throws on insecure origins/older WebViews with no feedback; date has no year; the count is a snapshot at render time (fine); the text is shown but not the plain link (an admin wanting only the URL has to extract it). Not shown for `signup_closed` (arguably right) nor `draft`.
- Related notification templates (`src/lib/notifications/templates.ts:20-37`) differ in wording from the announcement: `match_created` = "¡Partido confirmado! {Lunes 7/9} {21:00}hs en {location} -- {group}. Quedan {max_players} lugares. Anotate acá: {url}" (uses `max_players`, i.e. "Quedan 14 lugares" even if someone already signed up — but it is only emitted right at creation, so usually correct); `match_reminder` = "Hoy {21:00} -- {group} -- remera oscura/clara según tu equipo" (matches spec §4.8 wording). The reminder sweep runs only inside the 12:00 UTC daily cron with a default `reminder_hours_before = 3` (`reminders.ts:33-48`, `00001:285`) → for a 21:00 BA match the window (09:00–12:00 BA) never contains it; **reminders effectively never fire on Vercel Hobby** unless `reminder_hours_before ≥ 12`.

### Feature: Public signup link `/m/[matchId]` (WhatsApp entry)
- Actors: visitor without account, logged-in non-member, logged-in member, "guest with cookie". Route is outside the middleware's protected list (`src/lib/supabase/middleware.ts:41`), so it renders for anon. Data comes only from `get_public_match` (anon-callable; returns group name/slug, date, location, **notes**, status, max, counts, **full display names of confirmed + waitlist**, timezone — 00015).
- Not found (RPC returns null) → card "Partido no encontrado" / "Este partido no existe o ya no está disponible." / "Ir al inicio".
- Non-signup statuses (`draft`, `teams_created`, `finished`, `cancelled`) → card with group name and one line: "Las inscripciones aún no están abiertas" / "Los equipos ya fueron armados" / "Este partido ya terminó" / "Este partido fue cancelado"; logged-in users also get "Ver detalles del partido" → M-page (**404 for non-members**, P-page 93-97). Guests who were signed up see nothing about their own status here.
- Signup-phase page: badge "Inscripción abierta" / "Completo" / "Inscripción cerrada", group name, date "Lunes 7/9/2026", time, location, "{confirmed}/{max} jugadores", notes, then `PublicMatchActions`, then lists "Confirmados ({n})" numbered names (or "Nadie se inscribió todavía") and "Lista de espera ({n})". Past match → actions replaced by "Este partido ya pasó" (names still listed).

**UC: Visitor with NO account, step by step**
1. Taps the WhatsApp link → sees the card above with input placeholder "Tu nombre" (maxLength 60, Enter submits) and button "Anotarme" (or "Anotarme en lista de espera" when status is `full`), plus "¿Tenés cuenta? Iniciá sesión" → `/login?redirect=/m/{id}` (login form and middleware both honor `redirect`, `login-form.tsx:19,43`, `middleware.ts:61-66`). There is **no "Crear cuenta" link** on this page; the register form ignores `redirect` and always goes to `/groups` (`register-form.tsx:76`).
2. Types a name, taps "Anotarme" → `POST /api/matches/{id}/guest-signup` `{displayName}` → route (service-role client) reuses a valid UUID from cookie `fulbot_guest_{matchId}` or mints one (`route.ts:36-37`) → `public_guest_signup(match, name, token)` → guest row (or reuse of the row with that token in the group, name updated) + signup `confirmed`/`waitlist` (upsert on `unique_guest_signup`) → may flip match to `full` → returns `{signup_id, status, waitlist_position}` → route sets cookie (httpOnly, `sameSite: 'lax'`, `secure` in prod, `path: '/'`, 1 year) → `router.refresh()`.
3. Page re-renders: server reads the cookie, looks up `guest_players.self_signup_token` and the active signup with the **admin client** (P-page 163-196) → shows "Estás anotado (invitado)" + ghost button "Bajarme", or "En lista de espera (#{n}) - invitado" + "Salir". Their name appears in the list.
4. "Bajarme"/"Salir" → `confirm('¿Estás seguro de que querés bajarte del partido?')` → `DELETE` same route → `cancel_guest_signup(match, token)` → row `cancelled`, waitlist promoted → cookie cleared (`maxAge: 0`). Page returns to the name form; signing up again mints a **new token and a new `guest_players` row** (old one orphaned).
5. Errors: RPC exceptions are returned raw as `error.message` (`route.ts:48, 80`) and shown in the red banner (e.g. "El partido no está aceptando inscripciones", "Ya estás inscripto en este partido"); empty name → "Ingresá tu nombre"; bad JSON → "Solicitud inválida"; DELETE without cookie → "No hay una inscripción de invitado para bajar".
- Variants: `signup_closed` → form replaced by "Las inscripciones están cerradas" (a guest with a cookie still sees their status and can still "Bajarme" — `cancel_guest_signup` has no status check, 00007:575-618); `full` → goes to waitlist; other device/browser/incognito → no cookie → sees the form again and can sign up a second time under the same name (no name-based dedup); admin removed them → cookie persists → next POST reuses the token and revives the same row.
- What the visitor cannot do: see who is on which team, get notified (guests have no channel), edit their name after signup (re-POST while active raises "Ya estás inscripto"), join the group.

**UC: Logged-in NON-member** (has a player profile) — sees the same header/lists, no name input, no login line, a single full-width button "Unirme al grupo e inscribirme" (disabled + "Las inscripciones están cerradas" when closed). Tap → `join_group_via_invite(group.invite_code)` (invite code fetched from `groups` thanks to the `USING (TRUE)` policy) then `signup_for_match` → refresh → now treated as a member ("Estás inscripto" + "Ver partido" + "Bajarme"). Errors → "Error al unirte e inscribirte". Edge cases: an **ex-member with `is_active = false`** → `join_group_via_invite` raises `'Already a member of this group'` (00004:338-344 ignores `is_active`) → the button always fails, no alternative offered; a logged-in user **without a player profile** falls through to the anonymous guest form (`isMember=false`, `inviteCode=null`) and can sign up as a guest while logged in; a user whose join succeeded but whose `signup_for_match` failed (e.g. match just closed) is left as a member with the error banner.

**UC: Logged-in member on the public page** — button "Inscribirme" / "Anotarme en lista de espera"; after: "Estás inscripto" + "Ver partido" (→ M-page) + "Bajarme" (confirm dialog); waitlist: "En lista de espera (#{n})" + "Ver partido" + "Salir"; closed & not signed: "Las inscripciones están cerradas". Note wording differs from the in-app card ("Inscribirme" vs "Anotarme", "Estás inscripto" vs "Ya estás anotado").

- Security observations:
  - `public_guest_signup` and `cancel_guest_signup` are **granted to `anon`** (00013:44-45), so the route handler is *not* "the only caller" as the contract states: anyone with the anon key can call the RPC directly with arbitrary tokens/names, in a loop, with **no rate limit and no name length limit** (60 is UI-only), filling a match and its waitlist with junk and firing `waitlist_promoted` webhooks. Since the route uses the service-role client anyway, the anon grant is unnecessary.
  - `get_public_match` exposes full names and match notes to anyone holding the UUID (unguessable v4, but WhatsApp links get forwarded). Acceptable for this product, but worth an explicit decision.
  - Cookie per match on `path: '/'` for 1 year → one cookie per match accumulates (≈ 60 B each) and is sent on every request.
  - Guest tokens are stored in plaintext (`self_signup_token unique`); a DB read leak = ability to cancel anyone's guest signup. Low impact.
  - `route.ts:48` returns raw Postgres messages (could include non-Spanish internal errors).

### Feature: Invite page guest path (`/invite/[code]`, touches this area)
- Anonymous visitor: card "Te invitaron a {group}", "Partidos: Lunes a las 21:00 · {n} miembros", "Iniciá sesión o creá una cuenta para unirte al grupo.", buttons "Iniciar sesión" / "Crear cuenta" (`?redirect=/invite/{code}` — register ignores it), then "Próximo partido" box (`get_public_group_by_invite.next_match` = earliest `signup_open`/`full` match later than now−2h; **`signup_closed` excluded**) with "{n}/{max} anotados" (+ " · lista de espera" when full) and button "Anotarme como invitado (sin cuenta)" → `/m/{id}`, caption "Solo para este partido, con tu nombre. Para quedar en el grupo, creá una cuenta."
- Logged-in non-member: "Unirse a {group}", "Próximo: Lunes 21:00 · n/max anotados", button "Unirme al grupo" (direct INSERT into `group_memberships` via `(supabase as any)`, not the RPC) or "Volver al grupo" for inactive memberships (this path *does* handle `is_active=false`, unlike the public match page).

### Feature: Cron & manual endpoints
- `vercel.json`: single cron `/api/cron/daily` `0 12 * * *`. `daily/route.ts` checks `Authorization: Bearer ${CRON_SECRET}` (401 if env unset), then runs recurring generation + `match_created` emission, outbox drain, reminders; each step isolated. `/api/cron/recurring` (same guard) exists for manual runs. Hobby drift ±59 min documented in comments.

---

## 4. Implemented vs stubbed / dead

Implemented end-to-end: create/edit/delete/cancel/close/reopen/finish; member signup/cancel with waitlist & promotion; admin guests add/remove; public guest signup with cookie; non-member join-and-signup; recurring pattern editor + SQL generator + cron + lazy call; announcement copy/share; realtime subscription code (but likely inert, see §3 Match detail).

Dead / unused:
- `signup_for_match(p_notes, p_position_preference)` — never supplied by any UI; spec §3.6 `positionPreferenceForThisMatch`/`notes` have no input. `SignupList` renders `signup.notes` (only guests ever have it).
- `get_public_match.waitlist_count` unused by P-page (uses `waitlist_names.length`).
- i18n keys never referenced: `matches.cancelSignup`, `generateTeams`, `regenerateTeams`, `addGuest`, `waitlistPosition`, `confirmed`, `upcoming`, `past`, `noMatches`, `create`, `title` (all hardcoded in Spanish instead).
- `emptyMessage="No hay nadie en espera"` (M-page 485) unreachable.
- `admin_set_signup_status` accepts `waitlist`/`cancelled` targets but the UI only toggles `did_not_show`/`confirmed`.
- `groups.default_match_day/time/max_players` vs `recurring_patterns.*` — two sources of truth; the create form uses the group defaults, the generator uses the pattern.
- `/api/cron/recurring`, `/notifications`, `/reminders` standalone routes (manual only).
- `matches.recurring_pattern_id` has `ON DELETE SET NULL`, but the UI never deletes patterns.

---

## 5. Consolidated issue list (with locations)

Bugs / integrity
1. `admin_add_guest_signup` flips `draft`/`signup_closed`/`teams_created` → `full` when capacity is reached — 00007:270-272; UI allows it (M-page 550).
2. Team generation sets `teams_created` from any status, bypassing `admin_set_match_status` — `api/matches/[matchId]/teams/generate/route.ts:283-289` (plan §2.3 allowed this "in wave 1" only).
3. Raising `max_players` never promotes the waitlist; newcomers jump the queue; status stays `full` — `edit-match-form.tsx:48-56`, 00007:144-152.
4. Waitlist positions not renumbered when a waitlisted player/guest self-cancels — 00007:180-207, 575-618 (compare `admin_remove_signup` 309-320).
5. `signup_closed` matches hidden from the group page "Próximos partidos" and the `/groups` dashboard next-match card — `groups/[groupSlug]/page.tsx:184`, `groups/page.tsx:96`; also from the invite page's next match (00016:41).
6. Recurring: editing a generated match's date creates a duplicate on the next sweep; deleting a cancelled one resurrects it — 00010:160-163 vs `edit-match-form.tsx:46`, `match-admin-actions.tsx:60-63`.
7. Recurring: cron fixed at 12:00 UTC (09:00 BA) cannot honor "abre Domingo 12:00" — `vercel.json:3`, 00010:160; depends on someone opening the group page.
8. Captain sees "Crear partido" and "Eliminar partido" but RLS is admin-only → generic errors — `new/page.tsx:55`, `matches/page.tsx:63`, `match-admin-actions.tsx:187`, 00003:170-180.
9. Members can bypass signup RPCs through the leftover INSERT/UPDATE policies on `match_signups` — 00003:195-207.
10. `join_group_via_invite` fails for inactive ex-members → "Unirme al grupo e inscribirme" is dead for them — 00004:338-344, `public-match-actions.tsx:186-213`.
11. Realtime channel has no publication configured — `realtime-wrapper.tsx:18-33`, no migration.
12. Reminders can never fire with the default 3 h window on a once-daily 09:00 BA cron — `reminders.ts:33-48`, `vercel.json`.
13. Register form drops `?redirect=` — `register-form.tsx:76` (public page only links to login anyway).
14. Default "Fecha" on create computed in server-local (UTC) time — `new/page.tsx:60-81`.
15. Invalid custom timezone in a pattern aborts the whole cross-group cron sweep — `recurring-pattern-form.tsx:288-298`, 00010:130 (no validation, no per-pattern exception handling).

Spec gaps (init-prompt)
- §4.3 "auto-creates a match instance each week" — yes, but only at signup-open time and only via cron/lazy call; no preview of next week's match. "Optionally auto-send a sign-up link" — only for recurring matches and only via in-app/outbox (no manual-match `match_created`).
- §4.4 "Guests can be added directly to confirmed or waitlist" — no choice; auto by count. "Notify the group" on promotion — notification targets the promoted player only.
- §4.8 reminders — implemented but not deliverable on the current cron; announcement on creation — manual copy/share only (fine per "simulate with a copyable text").
- §5.3 Match page "Once teams exist: Lineup view / Drag-and-drop / Export image" — no navigation to `/teams` from the match page after generation.
- §3.6 per-match position preference / notes for members — no UI.
- §4.2 role model — captains can create (UI), edit (RLS), add/remove guests, change status, generate teams; recurring pattern is admin-only. Decision #2 "only admins add/remove guests" not enforced (RPC checks admin **or captain**).

UX rough edges
- "Cancelar partido" has no confirmation (`match-admin-actions.tsx:170-184`) while "Eliminar" and "Bajarme" do; cancelled is irreversible.
- Disabled "Anotarme" with "Inscribite al partido / Hay lugar disponible" on `draft`/`teams_created` (`signup-actions.tsx:100-119`).
- All RPC errors collapse into generic strings (`signup-actions.tsx:55,82`, `add-guest-form.tsx:57`, `match-admin-actions.tsx:46`) although the SQL raises user-readable Spanish messages; the public page does show them.
- Terminology drift: "Anotarme"/"Inscribirme"/"Inscribite"; "Ya estás anotado"/"Estás inscripto"; "Inscritos"/"anotados"/"Confirmados"; "Tú" vs vos-form elsewhere; "Bajarme" vs "Salir"/"Salir de espera".
- Mixed i18n on the M-page and its siblings (see §3 Match detail); list pages fully hardcoded Spanish.
- Public page for non-signup statuses tells a signed-up guest nothing about their own status; "Ver detalles del partido" 404s for non-members.
- Announcement uses a `<pre>` block and Copy without failure feedback; no year in the date.
- `/matches` list has no pagination and N+1 queries; group page limits upcoming to 5 without a "more" hint (there is "Ver todos").
- Guest name input has no server-side length cap; guest rows multiply.

Hardcoded values
- Minimum 4 confirmed for "Armar equipos" (M-page 545; generate route 140); `max_players` bounds 4–30 in three forms; guest name 60 chars (UI); location 200; notes 500; badges ≤3 per row; group page upcoming limit 5; recent finished limit 3; 2-hour in-progress grace (00010:139; 00016:42); cookie 1 year (`route.ts:16`); `http://localhost:3000` fallback URL (`match-announcement.tsx:37`, `match-created.ts:57`, group page 213); `DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires'`; timezone preset list of 8; default signup-open time "12:00" (`recurring-pattern-form.tsx:81`); default match time "21:00" (create + pattern form); reminder default 3 h (00001:285).
