# Area D — Team generation, rules, lineup, manual editing, sharing

Reviewed against `init-prompt.md` §4.5 / §4.6 / §5.3 and `docs/rework-plan.md` §2.2 / §2.3. All paths relative to `/Users/maxo/orca/workspaces/fulbot/rework`. UI strings quoted verbatim (Spanish). Every file listed in the brief was read in full.

Files in scope:
- `src/app/api/matches/[matchId]/teams/generate/route.ts` (343 lines)
- `src/lib/ai/team-generator.ts` (435), `src/lib/ai/fallback-balancer.ts` (273)
- `src/app/(dashboard)/groups/[groupSlug]/matches/[matchId]/rules-manager.tsx` (306)
- `.../matches/[matchId]/teams/page.tsx` (230), `teams-view.tsx` (408), `draggable-teams.tsx` (410), `lineup-field.tsx` (207), `whatsapp-share.tsx` (260)
- `src/app/api/export/lineup-image/route.tsx` (379)
- `.../matches/[matchId]/page.tsx`, `match-admin-actions.tsx` (team-related parts)
- `supabase/migrations/00001_initial_schema.sql`, `00003_rls_policies.sql` (teams/rules policies), `00004_functions.sql`, `00007_signup_flow.sql` (status transitions), `00008_rules_shape_and_assignments.sql`, `00013_function_privileges.sql`
- `src/types/database.ts`

---

## 0. Data model facts (what the code relies on)

| Object | Definition | Notes |
|---|---|---|
| `team_name` enum | `'dark' \| 'light'` (00001:15) | Two fixed teams per match. |
| `assignment_source` enum | `'ai' \| 'manual'` (00001:16) | |
| `rule_type` enum | `'avoid_pair' \| 'force_pair' \| 'min_defenders' \| 'min_goalkeepers' \| 'balance_rating'` (00001:17) | `balance_rating` exists in the enum and in `database.ts:896` but has **no UI, no generator support** — dead value. |
| `teams` | `id, match_id FK, name team_name, color_hex default '#000000', created_by_user_id, score (00005), created_at, updated_at, UNIQUE(match_id, name)` (00001:177-187) | The RPC inserts `'#1a1a1a'`/`'#ffffff'` (00008:71-77); the UI never reads `color_hex` on the teams page (hardcoded Tailwind greys). |
| `team_assignments` | `id, team_id FK cascade, player_id FK cascade null, guest_player_id FK cascade null, position TEXT NOT NULL, order_index SMALLINT default 0, source default 'ai'`; CHECK exactly one of player_id/guest_player_id (00001:195-211) | `position` is free text, no enum — nothing at DB level restricts it to the 13 abbreviations. |
| `rule_sets` | `id, group_id null, match_id null, rule_type, data JSONB default '{}', is_active, created_by_user_id, created_at`; CHECK exactly one of group_id/match_id (00001:257-271) | Canonical `data` shapes per plan §2.2: `{ player_ids: [a, b] }` and `{ min_count: n }`. 00008:23-30 backfills the legacy `player_id_a/b` shape. |
| `player_profiles` fields used | `preferred_positions TEXT[] default ['CM']`, `main_position default 'CM'`, `footedness default 'right'`, `goalkeeper_willingness SMALLINT default 0 (0..3)`, `reliability_score DECIMAL(3,2) default 1.00`, `fitness_status`, `overall_rating`, `matches_played`, `goals`, `assists` (00001:42-46) | **Default GK willingness is 0 = "never"** — this matters a lot for the always-on GK hard constraint (see Issue D-1). |
| `matches.ai_input_snapshot JSONB` (00001:116) | Written by the generate route. | |
| RPC `save_team_assignments(p_match_id uuid, p_assignments jsonb) returns void` (00008:43-112) | SECURITY DEFINER, `GRANT EXECUTE … TO authenticated`. | Checks `is_group_admin_or_captain(match.group_id)`. |
| RPC `get_recent_match_history(p_group_id uuid, p_limit int default 5)` (00004:360-404) | SECURITY DEFINER, granted to `authenticated` in 00008:118. Returns only matches with `status = 'finished'` that have teams, newest first. | **No membership check inside the function** (see Issue D-14). |
| RLS | `teams`/`team_assignments`: members read, admins+captains manage (00003:222-262). `rule_sets`: members read (00003:318-326); manage policy replaced in 00008:127-137 to allow admin **or captain**. `matches` UPDATE: admin or captain (00003:174-176). | Rules manager writes straight to the table through RLS; there is no rules RPC. |

Position vocabulary used everywhere (AI prompt, fallback, select, field): `GK, CB, LB, RB, CDM, CM, CAM, LM, RM, LW, RW, ST, CF` (`draggable-teams.tsx:27-29`). Note the profile editor (`src/app/(dashboard)/profile/page.tsx:25-36`) offers only 10 of them (no `LM`, `RM`, `CF`), so those three can only be assigned by the AI/fallback/manual select, never declared as a preference.

---

## Feature: Entry point — "Armar equipos" from the match page

- **Actors:** admin, captain (the sidebar card is rendered only when `isAdminOrCaptain`, `page.tsx:540-547`).
- **Entry points:**
  - Match page `/groups/[groupSlug]/matches/[matchId]`, sidebar card **"Administrar partido"** → button **"Armar equipos"** (Users icon), which is a `<Link>` to `/groups/[groupSlug]/matches/[matchId]/teams` (`match-admin-actions.tsx:143-150`).
  - Shown only when `currentStatus ∈ {signup_open, full, signup_closed}` **and** `hasEnoughPlayers` (`confirmedSignups.length >= 4`, `page.tsx:545`).
  - This is the **only link in the whole app** to the teams page (grep for `/teams` finds just this one). Members never get a link; admins lose it as soon as status becomes `teams_created`.

**UC: Admin opens the teams page**
- Preconditions: admin/captain of the group; match status `signup_open`/`full`/`signup_closed`; ≥4 confirmed signups.
- Steps: tap "Armar equipos" in the sidebar → navigates to the teams page (see next feature).
- Result: no data written.
- Variants / edge cases:
  - <4 confirmed: button hidden, no explanation on the match page (the "Estadísticas" card just shows counts).
  - Status `draft`: hidden (must "Abrir inscripciones" first).
  - Status `teams_created`: **button disappears** (`match-admin-actions.tsx:143`). The admin can only get back to the lineup by typing the URL or using browser history. The match page in `teams_created` shows nothing about the teams either: teams are fetched only when `match.status === 'finished'` (`page.tsx:280-315`) and used only for the results editor. Spec §5.3 ("Once teams exist: lineup view, drag-and-drop, export image" on the match page) is not met. **Issue D-2.**
  - Status `finished`/`cancelled`: hidden (correct).
  - The match page's "Regenerate"/"Redo" affordance from spec §5.3 ("Button to generate teams / redo teams") only exists inside the teams page.

What's implemented vs stubbed: the link works; the i18n keys `matches.generateTeams` / `matches.regenerateTeams` exist in `src/i18n/es.json:121-122` and `en.json:121-122` but are **not used anywhere** — all team UI strings are hardcoded Spanish (while the match page header/status use `t()`).

---

## Feature: Teams page (`/groups/[groupSlug]/matches/[matchId]/teams`)

- **Actors:** any active group member can view; admin/captain can generate/edit (`teams/page.tsx:40-51`, `teams-view.tsx:72`).
- **Entry points:** the link above, or direct URL. Back link **"Volver al partido"** (`teams/page.tsx:191-198`).
- Server component loads: user → player profile → group by slug → active membership (any role; else 404) → match (must belong to the group; else 404) with `ai_input_snapshot` → confirmed signups (registered + guests) → `teams` rows → assignments per team ordered by `order_index` (two separate queries, `teams/page.tsx:163-184`).
- Header: **"Armar equipos"** + `"{formatMatchDate(date, group tz)} · {n} jugadores"` (`teams/page.tsx:200-204`).
- **No status gating on the page itself**: a member can open `/teams` for a `draft` or `cancelled` match; admins see the generate card for anything except `finished`/`cancelled` (`teams-view.tsx:72`).
- Guests on this page get display defaults `mainPosition: 'CM'`, `overallRating: 2.5`, `isGuest: true` (`teams/page.tsx:128-135`); `isGuest` is carried in the type but **never rendered** — a guest is visually indistinguishable from a member on the teams page, lineup, PNG and WhatsApp text.

### Layout of `TeamsView` (`teams-view.tsx`)

Top to bottom:
1. Error banner (red) with the API `error` text (`teams-view.tsx:151-155`).
2. **Generate card** (admin/captain, status not finished/cancelled): Sparkles icon, **"Generar equipos con IA"**, subtitle **"La IA analiza jugadores y arma equipos equilibrados"**, button **"Generar equipos"** (no teams yet) / **"Regenerar equipos"** (teams exist, RefreshCw icon) / **"Generando..."** with spinner while loading. Disabled when `players.length < 4` (`teams-view.tsx:158-192`).
3. **Not-enough warning card** (yellow): **"Se necesitan al menos 4 jugadores confirmados para generar equipos. Actualmente hay {n}."** (`teams-view.tsx:195-207`).
4. **"Análisis" card** (shown whenever `ai_input_snapshot.output.reasoning` is non-empty — to every member): badge **"IA"** (Bot icon, provider `openai`) or **"Determinístico"** (Calculator icon, provider `fallback`); the reasoning text verbatim; **"Balance:"** progress bar + `{round(score*100)}%`; warnings list in yellow with triangle icon (`teams-view.tsx:210-261`).
5. If teams exist:
   - Controls row: `WhatsAppShare` (all members) and, for admin/captain, **"Vista:"** toggle with two icon buttons titled **"Vista de cancha"** (LayoutGrid) and **"Vista de lista (editable)"** (List) (`teams-view.tsx:267-298`).
   - Field view: two cards side by side on `lg`, stacked below: **"Equipo Oscuro"** (dark header) / **"Equipo Claro"** (grey header), each with a badge **"{n} jugadores · {avg} avg"** and a `LineupField` (`teams-view.tsx:300-337`).
   - List view: `DraggableTeams` (`teams-view.tsx:339-347`), passing `darkTeam.id!`/`lightTeam.id!`.
6. If no teams: card **"Jugadores disponibles ({n})"** — grid of avatar + name (+ "(nickname)") + `"{mainPosition} · {rating}"` (`teams-view.tsx:352-385`).
7. **"Jugadores sin asignar ({n})"** (yellow card, outline badges with names): confirmed players that appear in no assignment (`teams-view.tsx:141-146, 388-405`). No action is offered for them.

**UC: Member views the lineup**
- Preconditions: active membership; teams exist.
- Steps: open the URL (no in-app link exists for members) → sees the "Análisis" card (reasoning, balance %, warnings, provider badge), share buttons, both fields with position circles, first names/nicknames and ★ ratings.
- Result: read only.
- Edge cases: if teams don't exist they see the "Jugadores disponibles" list and nothing else (no generate card). No realtime refresh here — `RealtimeWrapper` is only on the match page and subscribes to `match_signups` only (`realtime-wrapper.tsx:18-30`), so a member looking at the lineup does not see a regeneration until they reload.

---

## Feature: AI team generation (`POST /api/matches/[matchId]/teams/generate`)

- **Actors:** admin, captain (route check `route.ts:57-68`); system (OpenAI / fallback).
- **Entry point:** "Generar equipos" / "Regenerar equipos" button (`teams-view.tsx:78-101`), `fetch(POST)` with no body.

### Route flow (`route.ts`)

1. `auth.getUser()` → 401 `{ error: 'No autorizado' }` (`:30-33`).
2. Player profile → 400 `'Perfil no encontrado'` (`:36-44`).
3. Match `id, group_id, status, max_players` → 404 `'Partido no encontrado'` (`:47-55`). **`status` is fetched but never checked** — see Issue D-3.
4. Active membership with role admin/captain → 403 `'No tenés permiso para armar equipos en este grupo'` (`:58-68`).
5. Confirmed signups with embedded `player_profiles(id, display_name, nickname, main_position, preferred_positions, overall_rating, footedness, goalkeeper_willingness, fitness_status, reliability_score, matches_played, goals, assists)` and `guest_players(id, display_name, estimated_rating, preferred_positions)` (`:101-133`). DB error → 500 `'No se pudieron obtener los jugadores anotados'`. Fewer than 4 → 400 **`'Se necesitan al menos 4 jugadores confirmados para armar equipos'`** (`:140-145`). There is no upper bound, no relation to `max_players`, no even-count requirement.
6. Build `PlayerInput[]`: registered players mapped 1:1; guests through `guestPlayerDefaults` (`team-generator.ts:24-50`): positions = guest `preferred_positions` or `['CM','ST','CB']`, `overallRating = estimated_rating ?? 2.5`, `footedness 'right'`, **`goalkeeperWillingness 1`**, `fitnessStatus 'ok'`, `reliabilityScore 0.8`, zero stats, `isGuest true`.
7. Rules: `rule_sets` where `group_id = match.group_id OR match_id = matchId` and `is_active` (`:184-188`); only `avoid_pair|force_pair|min_goalkeepers|min_defenders` kept; mapped to `{ type, playerIds: data.player_ids, value: data.min_count }` (`:190-199`).
8. History: `get_recent_match_history(group_id, 5)` → `MatchHistoryEntry[]` (`:202-212`).
9. `teamSize = ceil(n/2)`; `generateTeams(players, rules, teamSize, history)` (`:216-217`).
10. Persist through `save_team_assignments` with `source: 'ai'`, `order_index` = index in each array, `player_id`/`guest_player_id` split using the set of guest ids (`:221-243`). Failure → 500 `'No se pudieron guardar los equipos generados. Probá de nuevo.'`.
11. Re-read team ids; build snapshot and `UPDATE matches SET status = 'teams_created', ai_input_snapshot = …` (direct update, not through `admin_set_match_status`; failure only logged, `:285-296`).
12. `emit_notification(group, match, 'teams_created', { match_id, dark_team_names, light_team_names })` with full display names (`:301-317`), non-fatal. Template text (`src/lib/notifications/templates.ts:30-35`): `¡Se armaron los equipos! Oscuro: A, B, C. Claro: D, E, F.`
13. Response `{ success, teams: { dark: { id, assignments }, light: {…} }, reasoning, balanceScore, warnings, provider }` (`:319-335`). The client ignores the body and just `router.refresh()`.
14. Catch-all 500 returns `error.message` verbatim (`:336-341`) — internal OpenAI/zod/Postgres messages can reach the UI banner.

### What is stored in `matches.ai_input_snapshot` (`route.ts:262-283`)

```json
{
  "input": {
    "players": [{ "id", "name", "rating", "isGuest" }],   // reduced, NOT the full payload
    "rules": [{ "type", "playerIds", "value" }],
    "recentMatchesConsidered": <number>
  },
  "output": { "dark": [{playerId, position, reason}], "light": [...], "reasoning", "balanceScore", "warnings" },
  "provider": "openai" | "fallback",
  "model": "<OPENAI_MODEL>" | null,
  "generatedAt": ISO string
}
```
Plan §2.3 says the snapshot stores "the full payload sent and received". The stored input drops positions, footedness, GK willingness, fitness, reliability, stats, the pair-history and the prompt text itself. **Issue D-9.**

### The exact prompt (`team-generator.ts:135-244`)

Single `user` message, no system message, no temperature set, `max_tokens: 2048`, `response_format: { type: 'json_object' }`, model `process.env.OPENAI_MODEL || 'gpt-4o-mini'` (`:356-379`). Text (template literals shown as `${…}`):

```
You are an expert football (soccer) team balancer for amateur 7-a-side matches. Your goal is to create two balanced teams that will have a competitive and fun match.

## Players Available (${players.length} total, ${teamSize} per team)

- ${displayName}${nickname ? ` (${nickname})` : ''} [ID: ${id}]
  Rating: ${overallRating.toFixed(1)}/5 | Positions: ${mainPosition, ...preferredPositions minus main} | ${'left-footed'|'right-footed'|'ambidextrous'}
  GK willingness: ${['never','only if needed','can do it','loves it'][goalkeeperWillingness] ?? 'unknown'} | Fitness: ${fitnessStatus} | Reliability: ${(reliabilityScore*100).toFixed(0)}%
  Stats: ${matchesPlayed} matches, ${goals} goals, ${assists} assists
  ${isGuest ? '(Guest player - less known, use average defaults)' : ''}
  (one block per player)

## Rules to Follow (hard constraints marked as such MUST be respected)

- AVOID putting ${nameA} and ${nameB} on the same team (hard constraint)          // avoid_pair
- FORCE ${nameA} and ${nameB} to be on the same team (hard constraint)             // force_pair
- Each team must have at least ${value ?? 1} player(s) with goalkeeper willingness >= 1 (hard constraint)   // min_goalkeepers
- Each team must have at least ${value ?? 1} player(s) capable of playing defense (CB/LB/RB)               // min_defenders
   (or the literal line "No special rules")

## Recent Teammate History (rotate combinations - avoid repeating the same pairs when possible, this is a soft preference)

- ${name1} and ${name2} have been teammates ${count} time(s) recently      // top 15 pairs, both in this match, sorted by count desc
   (or "No recent match history available")

## Your Previous Attempt Had These Problems (FIX THEM)      // only on the retry
- ${violation}

## Formation Context

For ${teamSize}-a-side, typical formations are:
- 7 players: 1-2-3-1 or 1-3-2-1 (GK + field players)
- 6 players: 1-2-2-1 or 1-3-1-1
- 5 players: 1-2-1-1 or 1-1-2-1

## Your Task

Create two balanced teams (Dark and Light) considering:
1. **Hard constraints first**: never violate avoid_pair/force_pair rules or the goalkeeper minimum
2. **Overall Rating Balance**: The average rating of both teams should be as close as possible
3. **Position Coverage**: Each team needs players who can play key positions (especially GK and defense)
4. **Complementary Skills**: Mix of attackers, midfielders, and defenders
5. **Footedness Distribution**: Balance left and right-footed players when possible
6. **Fitness Considerations**: Players with "limited" fitness should have lighter roles
7. **Rotation**: prefer combinations that were not teammates recently (see history above)

## Response Format

Respond with ONLY a valid JSON object, no markdown, no code fences:

{
  "dark": [ {"playerId": "player-uuid", "position": "GK", "reason": "Brief reason for this assignment"} ],
  "light": [ {"playerId": "player-uuid", "position": "ST", "reason": "Brief reason for this assignment"} ],
  "reasoning": "2-3 sentences explaining the overall balance strategy",
  "balanceScore": 0.95,
  "warnings": ["Any concerns about the team balance"]
}

The balanceScore should be between 0 and 1, where 1 means perfectly balanced.
Include ALL ${players.length} players EXACTLY ONCE, split as evenly as possible between the two teams (sizes may differ by at most 1).
Use standard position abbreviations: GK, CB, LB, RB, CDM, CM, CAM, LM, RM, LW, RW, ST, CF
```

Payload contents, field by field: **included** — id, display name, nickname, rating (1 decimal), main + preferred positions, footedness, GK willingness (as words), fitness, reliability %, matches/goals/assists, guest flag, rules (by name), teammate-pair counts from the last 5 *finished* matches. **Not included** — match info (group name, date), `max_players`, any formation preference per team (spec §4.5 lists both), "recent form" (spec), explicit language instruction (the prompt is English, so `reasoning`/`warnings` come back in English and are shown verbatim in the Spanish UI — Issue D-10). The header says "7-a-side" regardless of the real team size (`:193`).

Pair counts (`computeTeammatePairCounts`, `:96-118`): for each history row and each team, every unordered pair gets +1; only pairs where both players are in the current match are shown (max 15). Guest ids also participate (the SQL coalesces `player_id`/`guest_player_id`).

### Validation, retry, fallback (`team-generator.ts:246-403`)

Zod schema (`:121-133`): `dark`/`light` arrays of `{ playerId: string≥1, position: string≥1, reason: string default '' }`, `reasoning` default `''`, `balanceScore` number in [0,1] default 0.5, `warnings` string[] default `[]`. `position` is **not** restricted to the 13 abbreviations.

`validateHardConstraints(players, rules, result)` returns a list of English violation strings:
- missing players, duplicated players, unknown ids (`:263-280`);
- `|dark| - |light| > 1` (`:283-285`);
- `avoid_pair` on the same team; `force_pair` split — only when the rule has exactly 2 ids **and both are assigned** (rules mentioning absent players are ignored) (`:294-315`);
- **GK minimum is always enforced**, `required = min_goalkeepers.value ?? 1` even with no rule row; counts players with `goalkeeperWillingness >= 1` (`:318-328`);
- `min_defenders` only when a rule exists; a player counts if `mainPosition` or any preferred position ∈ `{CB, LB, RB}` (`:331-345`).

`generateTeams` (`:350-403`):
- No `OPENAI_API_KEY` → fallback immediately, `provider: 'fallback'`, no model.
- `maxAttempts = 2`. Attempt 1 uses the plain prompt; if violations, attempt 2 appends the "Your Previous Attempt Had These Problems" block. Any exception (network, `JSON.parse`, zod) is logged and stored as the "violation" for the next attempt (so a network error message is fed back to the model as a "problem to fix").
- First attempt with zero violations is returned as `provider: 'openai', model`.
- After 2 failed attempts → `console.warn` and fallback. The UI shows the fallback result with the "Determinístico" badge and **no indication that the AI was tried and failed** (the warnings shown are the fallback's, not the AI violations).

`calculateTeamMetrics` (`:406-435`) is exported but referenced nowhere else in `src` — dead code.

### Fallback balancer (`fallback-balancer.ts`)

Deterministic; no randomness; ignores history. Steps:
1. **Units** (`buildUnits`, `:61-89`): union-find merges players linked by `force_pair` rules (transitively) into one unit with the average rating.
2. **Seed GKs** (`:133-164`): players with `goalkeeperWillingness >= 1`, sorted by willingness desc then rating desc; the first two distinct units are placed dark then light (second goes to dark instead if placing it on light would violate an `avoid_pair`). Warnings (Spanish): `'Ningún jugador confirmado se ofrece como arquero; se asignará el arco de todos modos.'` (0 GK-willing) or `'Sólo hay un jugador con disponibilidad para el arco; un equipo quedará sin arquero natural.'` (1).
3. **Snake draft** (`:166-198`): remaining units sorted by rating desc; pick order dark, light, light, dark, dark, light, … (`snakeTeamForPick`, `:92-97`; counter continues after the GK seeds, so with 2 seeds the next pick goes to light). A multi-member unit that would overflow `targetDark = teamSize` / `targetLight = n - teamSize` goes to the other side if it fits. If the pick violates an `avoid_pair`, the unit goes to the other team; if both violate, warning `'No se pudo respetar la regla de separar jugadores para: {names}'`.
4. **Rebalance** (`:200-218`): while sizes differ by >1, move a single-member unit that doesn't violate an avoid_pair; give up silently if none.
5. **Positions** (`buildFormation`, `:28-51`, and `:220-251`): per team, `GK` + `round(outfield*2/6)` defenders (min 1 if outfield ≥3) + `round(outfield/6)` forwards (min 1 if outfield ≥2) + the rest midfielders, drawn in order from pools `DEF ['CB','RB','LB','CB']`, `MID ['CDM','CM','CM','CAM','RM','LM']`, `FWD ['ST','CF','ST']`. Concretely: 7 → `GK, CB, RB, CDM, CM, CM, ST`; 6 → `GK, CB, RB, CDM, CM, ST`; 5 → `GK, CB, CDM, CM, ST`; 4 → `GK, CB, CDM, ST`. GK slot = most GK-willing (then highest rated) player, even if willingness is 0. Each other slot = first remaining player whose main/preferred position equals the slot, else index 0 of the remaining list (which at that point is sorted by GK willingness then rating, `:233`, so the "else" pick is the most GK-willing leftover, not the best player). Reasons: `'Arquero por disponibilidad y balance de equipo'` / `'Balanceo determinístico por rating y posición'`.
6. `balanceScore = clamp(1 - |avgDark - avgLight| / max(avgDark, avgLight, 1))`; `reasoning = 'Balanceo determinístico'`.

Not honored by the fallback: `min_defenders`, rotation history. Because it is deterministic, **"Regenerar equipos" in fallback mode returns exactly the same teams every time** (Issue D-5).

**UC: Admin generates teams for the first time**
- Preconditions: admin/captain; ≥4 confirmed; teams page open; status not finished/cancelled (UI) — the API itself accepts any status.
- Steps: tap "Generar equipos" → button shows spinner "Generando..." (typically 2–15 s with OpenAI, instant in fallback) → page refreshes.
- Result: `teams` rows (dark `#1a1a1a`, light `#ffffff`) created if missing, `team_assignments` replaced with `source='ai'`, `matches.status = 'teams_created'`, `ai_input_snapshot` written, `teams_created` notification emitted (in-app + WhatsApp outbox per group settings). UI now shows the "Análisis" card, share buttons, view toggle and both fields; the match page badge reads **"Equipos armados"**; the sidebar loses "Armar equipos" and gains **"Marcar como finalizado"**.
- Edge cases:
  - Odd count: `teamSize = ceil(n/2)` → dark gets the extra player in fallback; the AI is told "sizes may differ by at most 1". Nothing in the UI flags which team is short.
  - Guests: included, treated as GK-willing 1, rating 2.5 (or `estimated_rating`), right-footed — see Issue D-4.
  - No API key: silent fallback, badge "Determinístico".
  - AI violates constraints twice: fallback; the AI's violation list is only in server logs.
  - Nobody (or only one person) has `goalkeeper_willingness ≥ 1`: the AI **cannot** satisfy the always-on GK constraint → two wasted OpenAI calls → fallback with the GK warning. Since the schema default is 0 and most amateur players never set it, this is likely the common path (Issue D-1).
  - Contradictory rules (same pair in avoid and force): AI cannot satisfy → fallback (force wins via units, then the avoid warning is emitted).
  - Rule referencing a player not in the match: silently ignored by the validator; still shown to the model by name.
  - `save_team_assignments` fails: 500 with Spanish message, status unchanged.
  - Status update fails after save: teams exist but status stays e.g. `signup_open` (soft failure, `:293-296`); the match page will still show "Armar equipos".
  - Signups change after generation: newly confirmed players show up under "Jugadores sin asignar"; players who cancelled are simply not drawn (their assignment row stays until the next save/regeneration).

**UC: Admin regenerates ("Redo")**
- Preconditions: teams exist; status not finished/cancelled.
- Steps: tap "Regenerar equipos" → **no confirmation dialog** → same POST.
- Result: all assignments replaced (manual edits lost), snapshot overwritten, status set to `teams_created` again, **another `teams_created` notification is emitted** to the whole group (`route.ts:308-313`) — every regeneration spams the group/WhatsApp outbox.
- Edge cases: the previous proposal is not passed to the model (history only includes *finished* matches), so nothing asks for a *different* split; with OpenAI you usually get variation from sampling, with fallback you get an identical result (Issue D-5).

**UC: API called outside the UI**
- Any admin/captain with a session can POST for a `draft`, `finished` or `cancelled` match: the route never checks `match.status`, and the direct `UPDATE … status = 'teams_created'` bypasses the transition rules in `admin_set_match_status` (00007:390-407), so a `finished` match can regress to `teams_created` and a `cancelled` one can be revived (Issue D-3).

---

## Feature: Teaming rules editor (`rules-manager.tsx`)

- **Actors:** admin, captain (rendered under `isAdminOrCaptain`, `page.tsx:560`; RLS allows both since 00008:127-137).
- **Entry point:** match page sidebar card **"Reglas para armar equipos"**, rendered only when `match.status ∈ {signup_open, full}` (`page.tsx:560-566`). It is **not** rendered in `signup_closed` or `teams_created` — see Issue D-6.
- Scope: the component receives `groupId` and `matchId`. Reads: `rule_sets` where `is_active` and (`group_id = groupId` OR `match_id = matchId`) (`rules-manager.tsx:83-99`). Writes: since `matchId` is always provided from the match page, every rule created here is **match-scoped** (`group_id: null, match_id`, `:126-127`). There is no UI anywhere to create group-level rules; if a group-level rule exists (inserted by hand/legacy), it is listed here without any scope indicator and "Quitar regla" deactivates it **for the whole group** (`:151-161`).
- Rule types offered (`RULE_LABELS`, `:38-59`):
  - **"Separar jugadores"** (`avoid_pair`, Ban icon) — "Estos jugadores no pueden estar en el mismo equipo"
  - **"Juntar jugadores"** (`force_pair`, Handshake icon) — "Estos jugadores deben estar en el mismo equipo"
  - **"Mín. defensores"** (`min_defenders`, Shield icon) — "Mínimo de defensores por equipo"
  - **"Mín. arqueros"** (`min_goalkeepers`, Users icon) — "Mínimo de arqueros por equipo"
  - (descriptions are defined but never rendered; only `label` is shown.)
- Player choices for pair rules = **all active group members** (`allGroupPlayers`, `page.tsx:224-239`) — not just confirmed signups, and **guests are never selectable**.

**UC: Add a pair rule**
- Steps: tap **"+ Separar jugadores"** (or "+ Juntar jugadores") → inline form titled with the label → two selects **"Jugador A"** / **"Jugador B"** with placeholder **"Seleccionar..."** (B excludes the player chosen as A) → **"Guardar"** / **"Cancelar"**.
- Result: insert `{ match_id, rule_type, data: { player_ids: [A, B] }, is_active: true }` (no `created_by_user_id`); appended to the list as `"{label}"` / `"{A} — {B}"`; `router.refresh()`.
- Edge cases: missing/equal players → `alert('Seleccioná dos jugadores diferentes')`; insert error → `alert('No se pudo agregar la regla. Intentá de nuevo.')`; duplicates and contradictory pairs are allowed; a player who later leaves the group shows as **"Desconocido"** (`:163-164`).

**UC: Add a minimum-count rule**
- Steps: tap **"+ Mín. defensores"** / **"+ Mín. arqueros"** → numeric input **"Cantidad mínima por equipo"** (`min=1 max=5`, default `1`) → "Guardar".
- Result: `data: { min_count: parseInt(value) || 1 }`; listed as **"Mínimo: {n} por equipo"**. The 1..5 bound is HTML-only; nothing server-side limits it. A `min_goalkeepers` of, say, 3 makes the AI constraint unsatisfiable for most groups → fallback (which ignores the value and only seeds one GK per side).

**UC: Remove a rule**
- Steps: tap the X (aria-label **"Quitar regla"**).
- Result: `UPDATE rule_sets SET is_active = false` (soft delete). On error nothing happens and nothing is shown (`:151-161`).

Empty state: **"No hay reglas configuradas. La IA armará equipos balanceados por rating."**

Implemented vs stubbed: fully working for the four types; `balance_rating` not exposed; no group-level rules UI (spec §4.5 mentions "Group/match rules"); no "formation preference per team" setting (spec §4.5).

---

## Feature: Manual editing — drag-and-drop list view (`draggable-teams.tsx`)

- **Actors:** admin, captain only (`teams-view.tsx:277` hides the toggle for members; component returns `null` if `!isAdminOrCaptain`, `draggable-teams.tsx:295-297`). Allowed while status is not finished/cancelled? — **No such check here**: the toggle is gated by `isAdminOrCaptain` only, so an admin can edit and save teams of a `finished` match from the list view (the generate card is hidden, but the list view and "Guardar cambios" are not). Server side, `save_team_assignments` has no status check either.
- **Entry point:** teams page → "Vista:" → list icon (**"Vista de lista (editable)"**).

Each row (`SortablePlayer`, `:60-143`): grip handle (aria **"Arrastrar jugador"**, `touch-none`), avatar, name (+ "(nickname)"), ★ rating; a `<select>` (aria **"Posición"**) with the 13 `POSITION_OPTIONS`; a button **"→ Claro"** (on dark rows) / **"→ Oscuro"** (on light rows). Team cards: **"Equipo Oscuro"** / **"Equipo Claro"** with badge **"{n} · {avg} avg"**; empty placeholder **"Arrastra jugadores aquí"**.

**UC: Move a player to the other team**
- Steps: drag a row and drop it **onto a row of the other team**, or tap "→ Claro"/"→ Oscuro".
- Result (local state only): player removed from its list and **appended to the end** of the other list; `hasChanges = true` → a highlighted card appears: **"Hay cambios sin guardar"** + **"Guardar cambios"** (Save icon).
- Edge cases:
  - Dropping onto the **empty area of a team** does nothing: `handleDragEnd` checks `overId === 'dark-team' | 'light-team'` (`:207-208`), but those ids are plain DOM `id` attributes on `CardContent` (`:343, :378`), never registered with `useDroppable` (grep finds no `useDroppable` in `src`). So an empty team can only receive players through the button. Dead code path.
  - Dragging **within the same team does not reorder**: `handleDragEnd` only handles cross-team moves; there is no `arrayMove` (`:193-222`) even though a `SortableContext` with `verticalListSortingStrategy` is set up. The visual sort animation plays, then the list snaps back. Since `order_index` is what drives the WhatsApp text order, the admin cannot control that order.
  - Sizes are unconstrained: you can save 10 vs 4.

**UC: Change a player's position**
- Steps: pick a value in the "Posición" select.
- Result: local state updated, `hasChanges = true`.
- Edge cases: if the stored position is not one of the 13 (possible from the AI, since zod accepts any string), the select shows the first option visually while state keeps the unknown value.

**UC: Save**
- Steps: tap "Guardar cambios" → spinner.
- Result: single RPC `save_team_assignments(matchId, [ { team, player_id, guest_player_id, position, order_index } … ])` — `source` omitted, so the SQL default `'manual'` applies to **every** row, including untouched ones (00008:106). The function runs in one transaction: verifies admin/captain, ensures both `teams` rows exist, `DELETE` all assignments for the two teams, re-inserts (`00008:70-108`). Then `onUpdate()` + `router.refresh()`.
- Error: **"No se pudieron guardar los cambios. Probá de nuevo."**
- Edge cases / gaps:
  - **Switching the view toggle discards unsaved edits without warning**: `viewMode` lives in `TeamsView`, and `DraggableTeams` holds its lists in `useState` — flipping to "Vista de cancha" unmounts it (`teams-view.tsx:300-347`). Same for navigating away (no `beforeunload` guard). Issue D-7.
  - No validation on save: empty team, no GK, violated `avoid_pair`/`force_pair`, duplicate positions — nothing is checked or even warned; the stale "Análisis" card (old reasoning, old balance %) keeps showing above the edited teams.
  - No way to **add an unassigned confirmed player** (there is no third "pool" column; "Jugadores sin asignar" is display-only) nor to **remove** a player from both teams. The only fix is "Regenerar equipos", which throws away all manual work. Issue D-8.
  - No `teams_created` notification on manual save (only generation emits it), and the match status is not touched by the RPC.
  - Props `darkTeamId`/`lightTeamId` are required (`teams-view.tsx:341-342` uses `!`) but **never used** inside the component (`draggable-teams.tsx:160-161`).
  - The RPC does not verify that each `player_id`/`guest_player_id` is a confirmed signup of that match or even a member of the group — only the FK holds; any admin/captain could insert arbitrary profile ids via the RPC. Both ids null → CHECK constraint error → generic save error.
  - Guests: handled correctly (`playerId`/`guestPlayerId` pair carried through, `teams-view.tsx:106-130`), as the plan requires.

---

## Feature: Lineup field view (`lineup-field.tsx`)

- **Actors:** all members (read-only).
- Rendering: a `w-full aspect-[3/4]` div with a green vertical gradient (`#2d5a27 → #3a7233 → #2d5a27`) and an SVG overlay (viewBox 0–100): outer rectangle (5,5,90,90), halfway line, centre circle r=12, both penalty boxes (25,5/77 → 50×18) and goal boxes (35,5/87 → 30×8) (`:92-161`).
- Coordinates (percent, attacking **upwards**, GK at the bottom):

| Pos | x | y | Pos | x | y |
|---|---|---|---|---|---|
| GK | 50 | 90 | CM | 50 | 45 |
| CB | 50 | 75 | RM | 85 | 50 |
| LB | 20 | 70 | CAM | 50 | 35 |
| RB | 80 | 70 | LW | 20 | 25 |
| CDM | 50 | 55 | RW | 80 | 25 |
| LM | 15 | 50 | ST | 50 | 15 |
| | | | CF | 50 | 20 |

  Unknown position → centre (50,50). Several players in the same position are spread horizontally in 15% steps around the base x, clamped to 10–90 (`:44-62`) — three CBs at y=75 become x=35/50/65; four CMs spread across 27.5–72.5; the y is never staggered so CF (y20) and ST (y15) can overlap visually.
- Each token: a 40 px circle showing the **position abbreviation** (dark: `bg-gray-800`, light: `bg-gray-100`), below it a label with **`nickname || first word of display name`** (max 80 px, truncated), below that **★ `overallRating.toFixed(1)`** in yellow (`:164-197`). Spec §4.6 asks for "short name / nickname" — done; shirt number not implemented (spec says "maybe in future").
- Empty: **"Sin jugadores asignados"**.
- There is **no formation concept**: layout is keyed by the stored position strings, so the fallback's `GK, CB, RB, CDM, CM, CM, ST` renders with a right back and no left back. Spec §4.5's "formation preference per team" has no counterpart.
- Ratings are shown to **every member** on every token (and in the PNG). Whether teammates' 1–5 ratings should be public inside the group is a product decision worth confirming (Issue D-11).
- Side-by-side only at `lg` (≥1024 px); on phones the two fields stack (spec §4.6 says side by side "like the drawing"; the PNG does keep them side by side).

---

## Feature: Share lineup — WhatsApp text (`whatsapp-share.tsx`)

- **Actors:** all members (rendered unconditionally when teams exist, `teams-view.tsx:269-274`).
- **Entry points:** three small buttons above the fields: **"Copiar"** (Copy icon; turns into a green check for 2 s after copying — label stays "Copiar"), **"WhatsApp"** (green, MessageCircle icon) and **"Imagen"** (blue, Download icon). "Copiar" and "WhatsApp" open a custom dropdown with **"Formato simple"**, **"Con posiciones"**, **"Con emojis"** (`:206-210, 214-242`).
- Player name in all texts: `nickname || displayName.split(' ')[0]` (`:79-81`) — two "Juan"s become indistinguishable.
- Date line: `formatDate` (`:83-89`) = `"{Domingo|Lunes|…} {d/M} - {HH:mm}"` built with `date.getDay()`, `toLocaleDateString('es-AR')`, `toLocaleTimeString('es-AR')` — i.e. the **browser's local timezone**, not the group timezone used everywhere else (`DEFAULT_TIMEZONE`/`formatMatchDate` in `teams/page.tsx:38,203`). Issue D-12.
- Order of players = `order_index` (AI array order, or list order after a manual save).

Templates (`generateMessage`, `:91-142`), verbatim:

**"Formato simple"**
```
*{groupName}*
{Día d/M - HH:mm}

*Equipo Oscuro:* {name1}, {name2}, …

*Equipo Claro:* {name1}, {name2}, …
```

**"Con posiciones"**
```
*{groupName}*
{Día d/M - HH:mm}

*EQUIPO OSCURO* ({n})
  {POS} - {name}
  …

*EQUIPO CLARO* ({n})
  {POS} - {name}
  …
```

**"Con emojis"**
```
⚽ *{groupName}* ⚽
📅 {Día d/M - HH:mm}

🖤 *EQUIPO OSCURO*
⚫ {name} ({POS})
…

🤍 *EQUIPO CLARO*
⚪ {name} ({POS})
…

¡Nos vemos en la cancha! 🏟️
```

**UC: Copy text** — `navigator.clipboard.writeText`; failure only logged (no toast). Requires a secure context (fine on HTTPS/localhost).

**UC: Share to WhatsApp** — `window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank')` (`:155-159`): opens WhatsApp's chooser without a preselected chat; nothing uses the group's configured webhook or `notification_outbox` — sharing is manual by design (plan §4 runbook item 4).

Not included in any text: location, the public match link, "remera oscura/clara" reminder (the announcement component has that, the lineup text doesn't), guest markers, rating.

---

## Feature: Share lineup — PNG export (`whatsapp-share.tsx:161-200` + `src/app/api/export/lineup-image/route.tsx`)

**UC: Download the lineup image**
- Steps: tap **"Imagen"** → spinner on the button → the browser downloads `equipos-{groupName lowercased, spaces→dashes}.png`.
- Mechanics: the client builds `{ groupName, matchDate: formatDate(matchDate), darkTeam: [{ name, position, rating }], lightTeam: […] }`, puts `encodeURIComponent(JSON)` into a `data=` query param (so it's double-encoded; the route does `searchParams.get` + `decodeURIComponent`, which matches), `fetch`es `GET /api/export/lineup-image?data=…`, turns the blob into an object URL and clicks a temporary `<a download>` (`:179-194`).
- Error: only `console.error` — the user sees the spinner stop and nothing else (`:195-199`).
- Mobile: a programmatic anchor download is unreliable on iOS Safari / installed PWA; there is no `navigator.share({ files })` path, so "ready to share in WhatsApp" (spec §4.6) means "save to camera roll, then attach manually" at best. Issue D-13.

Image (`route.tsx`, `runtime = 'edge'`, `@vercel/og` `ImageResponse`, **820×630 px**):
- Background `#0f172a`, padding 24. Header row: left **"⚽ {groupName}"** (28 px bold white) over **"📅 {matchDate}"** (16 px `#94a3b8`); right **"Generado con Fulbot"** (12 px `#64748b`) (`:335-359`).
- Two `Field`s side by side, 380 px wide each, 24 px gap (`:362-371`): header bar **"Equipo Oscuro"** (dark `#1f2937`) / **"Equipo Claro"** (`#f3f4f6`) with **"{n} jugadores · {avg} avg"**; a 480 px tall pitch with the same gradient and SVG markings as the web field; tokens = 44 px circle with the position abbreviation, name label (max 80 px, ellipsis), **"★ {rating}"** in `#fbbf24` (`:54-128`). Coordinates are a slightly tightened copy of the web ones (GK y=88, CB 72, LB/RB 18/82 @68, CDM 55, LM/RM 15/85 @48, CM 45, CAM 35, LW/RW 18/82 @25, ST 15, CF 20; `:20-34`), same horizontal spreading rule. Empty team → **"Sin jugadores asignados"**.
- So the PNG contains: group name, formatted date/time (browser tz), team names, per-team count + average rating, and for each player: position code, first name/nickname, rating. It does **not** contain location, the app URL, or any guest/captain marker.

Security / robustness of the route:
- **No authentication, no origin check**: the middleware only protects `/groups, /profile, /settings, /notifications` (`src/lib/supabase/middleware.ts:41`), so anyone on the internet can render arbitrary text into a "Generado con Fulbot"-branded image (spoofing / abuse / compute cost). Issue D-15.
- No schema validation of `data`: missing `darkTeam` → `players.reduce` throws; non-numeric `rating` → `toFixed` throws; oversized arrays → unbounded render. All surface as unhandled 500s (`:312-319` only guards JSON parsing).
- `fontFamily: 'system-ui'` is meaningless in the edge OG renderer (it uses its bundled Noto Sans); emoji render through the default twemoji path. Cosmetic.

---

## Feature: Match page in `teams_created` and later

- Status badge **"Equipos armados"** (`es.json:111`). Sidebar: **"Marcar como finalizado"**, **"Cancelar partido"**; the "Armar equipos" link is gone; the rules card is gone; **"Agregar invitado"** form still renders (status ≠ finished/cancelled, `page.tsx:550-557`) — an admin can add a guest after teams exist, who then shows as "sin asignar" on the teams page.
- `SignupActions` still renders in `teams_created` (`page.tsx:440-451`); `signup_for_match`/`public_guest_signup` reject with `'El partido no está aceptando inscripciones'` (00007:128-130, 512-514), but a confirmed member can still call `cancel_my_signup` (not status-gated in what I read), which promotes the first waitlisted player → that player is confirmed but **unassigned**, and the leaver's assignment row lingers until the next save. No notification or badge tells the admin the lineup is stale.
- Transitions from `teams_created` via `admin_set_match_status`: only `finished` or `cancelled` (00007:399-400). There is no "volver a abrir inscripciones" after teams exist; regeneration is the only way to change the roster's assignment.
- On `finished`, the match page fetches teams + assignments for the results editor (`page.tsx:280-330`) — that is the only place the match page ever uses the teams.

---

## Implemented vs stubbed / dead

| Item | Status |
|---|---|
| OpenAI JSON-mode generation with zod + hard-constraint validation + 1 retry + deterministic fallback | Implemented as plan §2.3 describes. |
| Rotation via `get_recent_match_history(group, 5)` pair counts | Implemented for the AI prompt; **not used by the fallback** (the comment at `team-generator.ts:79-82` says "or the fallback", but `generateFallbackTeams` never receives history). |
| `ai_input_snapshot` | Implemented, but input is a reduced summary, not "the full payload sent and received". |
| Status → `teams_created` in the route | Implemented (direct update). |
| Rules editor, four types, canonical shapes, admin+captain | Implemented; match-scoped only; not shown in `signup_closed`. |
| Drag-and-drop between teams + position select + atomic RPC save with guests | Implemented; **reorder within a team is a no-op**, **drop on an empty team is dead code** (no `useDroppable`), unused `darkTeamId`/`lightTeamId` props. |
| Lineup field, two teams | Implemented (stacked on mobile). |
| WhatsApp text (3 formats) + `wa.me` + clipboard | Implemented. |
| PNG export | Implemented (download only; unauthenticated route). |
| `calculateTeamMetrics` | Dead (exported, unused). |
| `balance_rating` rule type | Dead enum value. |
| `matches.generateTeams` / `regenerateTeams` i18n keys | Dead (UI hardcodes Spanish). |
| `RULE_LABELS[*].description` | Defined, never rendered. |
| `Player.isGuest` on the teams page, `Player.mainPosition` in `lineup-field.tsx` | Carried, never rendered. |
| "Formation preference per team", "recent form", match info in the payload (spec §4.5) | Not implemented. |
| Group-level rules UI (spec §4.5 "Group/match rules") | Not implemented (only per-match). |
| Lineup / redo / export on the **match page** (spec §5.3) | Not implemented — everything lives on `/teams`, which loses its only link after generation. |
| Shirt numbers (spec §4.6 "maybe in future") | Not implemented (expected). |

---

## Observed issues (numbered for annotation)

**D-1 — The GK hard constraint is always on, but the profile default makes it unsatisfiable.** `validateHardConstraints` requires ≥1 player with `goalkeeperWillingness >= 1` per team even with no rule (`team-generator.ts:317-328`), while `player_profiles.goalkeeper_willingness` defaults to 0 (`00001:45`). In any group where fewer than two members have set GK willingness, every generation burns two OpenAI calls and silently ends in the deterministic fallback (with the warning `'Sólo hay un jugador…'`/`'Ningún jugador…'`). Guests count as GK-willing (`guestPlayerDefaults` sets 1, `team-generator.ts:42`), which masks the problem in odd ways (a guest becomes the "natural GK"). Suggest: treat the GK minimum as hard only when a `min_goalkeepers` rule exists (plan §2.3 says "when the min_goalkeepers rule exists (default 1)", which reads as "default value 1", not "always on"), or downgrade to a warning when the pool has <2 GK-willing players.

**D-2 — No way back to the lineup after generation.** `match-admin-actions.tsx:143` hides "Armar equipos" once status is `teams_created`; the match page never shows teams before `finished` (`page.tsx:280`). Members never get a link at all. Spec §5.3 expects the lineup, drag-and-drop and export on the match page once teams exist.

**D-3 — Generate route ignores match status and bypasses the transition rules.** `route.ts:47-55` selects `status` but never checks it; `:285-291` writes `teams_created` directly. A `finished` (or `cancelled`) match can be regenerated and regressed. Also nothing prevents generating while `signup_open` with people still able to sign up/cancel.

**D-4 — Guest defaults are invented and invisible.** Rating 2.5, right-footed, GK-willing 1, reliability 0.8 (`team-generator.ts:24-50`); the teams page shows guests with rating 2.5 and position `CM` (`teams/page.tsx:132-134`) with no "invitado" marker anywhere (lineup, list view, WhatsApp text, PNG), and the rules editor cannot reference guests (`page.tsx:564` passes members only).

**D-5 — "Regenerar" is not a real "Redo".** No confirmation before discarding manual edits (`teams-view.tsx:171`); the previous proposal is not fed to the model (history covers only *finished* matches, `00004:399`); in fallback mode the output is byte-identical every time; each regeneration emits a new `teams_created` notification to the whole group (`route.ts:308-313`).

**D-6 — Rules editor hidden exactly when it's needed.** Rendered only for `signup_open`/`full` (`page.tsx:560`), not for `signup_closed` (the natural pre-generation state) nor `teams_created` (when you'd tweak a rule and regenerate). Also: no scope indicator for group-level rules, and "Quitar regla" on one deactivates it group-wide (`rules-manager.tsx:151-161`).

**D-7 — Unsaved manual edits are silently lost** when toggling "Vista de cancha" (unmounts `DraggableTeams`, `teams-view.tsx:300-347`) or navigating away; no `beforeunload`/confirm.

**D-8 — Manual editor cannot fix a stale roster.** No pool for "Jugadores sin asignar" (display-only, `teams-view.tsx:388-405`), no remove action, no in-team reordering (`draggable-teams.tsx:193-222` lacks `arrayMove`), no drop target for an empty team (`'dark-team'`/`'light-team'` ids are never registered with `useDroppable`). No validation or warning on save (sizes, GK, rules). The "Análisis" card keeps showing the pre-edit reasoning and balance %.

**D-9 — Snapshot is not the full payload** (`route.ts:262-283`): per plan §2.3 it should contain what was sent and received; it stores id/name/rating/isGuest, the rules, a count of history rows, and the output. The prompt text and the pair history are not recoverable for debugging or for a future "different from last time" prompt.

**D-10 — Language mixing.** Prompt is English with no output-language instruction, so `reasoning`/`warnings` shown under "Análisis" arrive in English (`team-generator.ts:193-243`); the AI's per-assignment `reason` is stored but never displayed. "avg" in `"{n} jugadores · {avg} avg"` (`teams-view.tsx:308,326`, `draggable-teams.tsx:339,375`, `route.tsx:185`). "Arrastra jugadores aquí" is tuteo, not the "vos" form required by plan §1 ("Arrastrá"). "Determinístico" (RAE: "determinista"). All teams-page strings are hardcoded Spanish while the match page uses `t()`; the existing `matches.generateTeams` keys are unused.

**D-11 — Ratings are broadcast.** Every member sees each player's ★ rating on the field (`lineup-field.tsx:192-195`), in the list view, and the PNG that goes to the WhatsApp group carries them too (`route.tsx:115-125`). Product decision to confirm; spec §4.7 frames ratings as private-ish post-match input.

**D-12 — WhatsApp/PNG date uses the browser timezone** (`whatsapp-share.tsx:83-89`) instead of the group timezone used by every other date on the page (`teams/page.tsx:38,203`, plan §4 "Dates are formatted in the group's timezone"). An admin travelling, or a desktop with a different tz, shares a wrong kickoff time.

**D-13 — Image "share" is a download.** No Web Share API with files, so on phones (the primary target) the user must find the downloaded file and attach it manually; failures are silent (`whatsapp-share.tsx:195-199`).

**D-14 — `get_recent_match_history` is callable by any authenticated user for any group** (SECURITY DEFINER, no membership check, `00004:360-404`; `GRANT … TO authenticated` in `00008:118`). It returns player ids and display names of past lineups of groups the caller does not belong to. Low impact, but it's a data leak across groups.

**D-15 — `/api/export/lineup-image` is unauthenticated and unvalidated** (`route.tsx:304-319`; middleware does not cover `/api`). Anyone can produce a "Generado con Fulbot" image with arbitrary text; malformed input crashes the edge function instead of returning 400.

**D-16 — Hardcoded values worth surfacing:** minimum 4 players (spec §4.5 says "e.g. 14"; `route.ts:140`, `page.tsx:545`, `teams-view.tsx:171,201`) with no relation to `max_players`; history limit 5; 2 attempts; `max_tokens 2048`; "7-a-side" in the prompt header; formation ratios 2/6 and 1/6; top-15 pairs; min-count input `max=5` client-only; RPC position default `'CM'`; team colours `'#1a1a1a'`/`'#ffffff'` in SQL vs greys in Tailwind vs `'#000000'` column default; image 820×630.

**D-17 — Minor robustness.** `route.ts:339` returns raw `error.message` to the client; the zod schema accepts any `position` string (unknown values render at pitch centre); a `balanceScore` outside 0..1 from the model is treated as a failed attempt rather than clamped; the fallback's "no matching position" pick takes the most GK-willing leftover rather than the best-rated (`fallback-balancer.ts:233,242-243`); `min_defenders` is not honored by the fallback; `save_team_assignments` doesn't verify the ids belong to the match's confirmed signups.

---

## Spec compliance summary (init-prompt §4.5, §4.6, §5.3)

| Spec item | Status |
|---|---|
| "Generate teams" once enough confirmed players (e.g. 14) | Partial — threshold is a hardcoded 4, unrelated to `max_players`. |
| Payload: match info (group, date) | Missing. |
| Payload: players with positions, footedness, GK willingness, rating, reliability | Done (plus fitness, stats, nickname). "Recent form" missing. |
| Payload: maxPlayersPerTeam, formation preference per team | Team size only; formation preference missing (prompt lists generic formations). |
| Rules: avoid_pair, force_pair, min GK, min defenders | Done (min GK always on; fallback ignores min defenders). |
| Recent history (last 3–5) for rotation | Done for the AI (last 5 finished matches); fallback ignores it. |
| Output JSON mapped to Team/TeamAssignment | Done via `save_team_assignments`. |
| "Generate teams" button | Done ("Generar equipos"). |
| "Redo" button respecting constraints | Partial ("Regenerar equipos"; see D-5). |
| Manual override by drag-and-drop between teams/positions | Partial (between teams yes; positions via select; no reorder, no unassigned pool; D-7/D-8). |
| Two fields side by side, dark left / light right | Done on desktop; stacked on mobile. |
| Player at position spot with short name/nickname | Done. |
| "Export image for WhatsApp" PNG | Done as download (D-13); unauthenticated route (D-15). |
| §5.3 match page: generate/redo button, rules editor, lineup + DnD + export once teams exist | Partial — generate link + rules editor on the match page (with status gaps, D-2/D-6); lineup/DnD/export live on a separate page that becomes unreachable after generation. |
