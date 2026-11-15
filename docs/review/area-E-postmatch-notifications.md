# Area E — Post-match & Notifications (review of `maxolabs/rework`)

Scope: results/score entry, finishing a match, MVP voting, teammate ratings, no-shows, badges, rating/reliability/stat computation, the dashboard MVP nudge; in-app notifications (bell, `/notifications`, read state), group notification settings, per-user notification prefs, WhatsApp webhook outbox, reminders, cron routes.

All paths are relative to `/Users/maxo/orca/workspaces/fulbot/rework`. Line numbers refer to the current worktree. UI strings are quoted verbatim in their original language.

Files read completely: `match-results.tsx`, `match-score-display.tsx`, `post-match-voting.tsx`, `page.tsx`, `match-admin-actions.tsx`, `signup-list.tsx`, `realtime-wrapper.tsx` (all under `src/app/(dashboard)/groups/[groupSlug]/matches/[matchId]/`), `src/app/(dashboard)/groups/page.tsx`, `src/app/(dashboard)/notifications/{page,notification-list}.tsx`, `src/components/layout/header.tsx`, `src/app/(dashboard)/groups/[groupSlug]/settings/notification-settings.tsx`, `src/app/(dashboard)/settings/{page,actions,settings-form}.tsx`, `src/app/(dashboard)/profile/page.tsx`, `src/lib/notifications/{types,templates,dispatch,match-created,reminders}.ts`, `src/lib/notifications/channels/whatsapp-webhook.ts`, `src/lib/supabase/admin.ts`, `src/app/api/cron/{daily,notifications,reminders,recurring}/route.ts`, `vercel.json`, `.env.local.example`, migrations `00001` (relevant tables), `00003` (relevant policies), `00004`, `00005`, `00007` (status transitions), `00010` (match_created comment), `00011`, `00012`, `00013`, `00014`; plus the `emit_notification` call in `src/app/api/matches/[matchId]/teams/generate/route.ts`.

---

## Part A — Post-match

### A.0 State machine context (what gates everything below)

- `admin_set_match_status` (`supabase/migrations/00007_signup_flow.sql:391-400`) allows `teams_created → finished` only. There is **no transition out of `finished`** (not even to `cancelled`). A match that never had teams generated can never be finished, and therefore never gets results, votes, badges or no-shows.
- On a `finished` match the match page hides: signup actions (`page.tsx:440`), the "Administrar partido" card entirely (`match-admin-actions.tsx:76-83` — `finished` is not in `hasActions`), the add-guest form (`page.tsx:550`), and the rules manager (`page.tsx:560`). What remains: the "Editar" link in the header (`page.tsx:402-411`, still visible to admins on finished matches), the confirmed/waitlist lists with no-show toggles, the results editor / score display, the voting card, and the "Estadísticas" sidebar.

---

### Feature: Finishing a match

- **Actors**: admin, captain.
- **Entry points**: match page sidebar card "Administrar partido" → button "Marcar como finalizado" (`match-admin-actions.tsx:153-167`), only when status is `teams_created`.

**UC: Mark match as finished**
- Preconditions: admin/captain; status `teams_created`.
- Steps: tap "Marcar como finalizado" (CheckCircle icon, spinner while loading). No confirmation dialog.
- Result: RPC `admin_set_match_status(p_match_id, 'finished')` (`match-admin-actions.tsx:36-40`); `router.refresh()`. Status badge changes to "Finalizado" (`src/i18n/es.json` `matches.status.finished`). The page now renders the results editor (admins) / voting card (everyone). Nothing else happens: no notification is emitted on finish, no player stats change, no "vote now" message.
- Variants/edge: error → `alert('Error al actualizar el estado')` (`match-admin-actions.tsx:46`). No time check: a match can be finished before its `date_time`. Once finished there is no undo (see A.0). "Cancelar partido" is not offered on finished matches (card hidden).

Observed issues:
- No confirmation before an irreversible transition (`match-admin-actions.tsx:153-167`).
- Spec §4.7 "Players get a request (non-mandatory) to vote" — nothing is sent on finish; there is no notification type for it (see B.1). The only "request" is the dashboard nudge (A.8) and the card on the match page.

---

### Feature: Results entry (score, goals, assists) and finalize

- **Actors**: admin, captain (UI gating `page.tsx:502`; server gating `admin_finalize_match_results` in `00013_function_privileges.sql:66-83` plus RLS on `match_events`/`teams` for admin-or-captain, `00005_match_results.sql:46-63`, `00003_rls_policies.sql:231-238`).
- **Entry points**: on a finished match with teams, card "Cargar resultado" (`match-results.tsx:338`) rendered for admins/captains only (`page.tsx:502-517`). Non-admins never see an editor; they see "Resultado" (`match-score-display.tsx:44`) only once results exist (`page.tsx:494-499`).

**What can be entered** (`match-results.tsx`):
- Per team ("Oscuro"/"Claro", `match-results.tsx:263`), a "Gol" button (`:282`) adds a goal row with two selects: "Seleccionar goleador..." (`:297`, players of that team only, guests included) and "Asistencia (opcional)" (`:309`, same team minus the scorer). Trash icon removes a row.
- The score is **derived** from the number of goal rows per team (`:274`, `:351`, `:360`). There is no free score field, no own-goal entry (schema supports `own_goal` and `minute`, `00005_match_results.sql:20-22`, but no UI), no clean-sheet entry (derived), no MVP entry (comes from votes).

**UC: Save results for the first time**
- Preconditions: status `finished`, teams exist (`page.tsx:502` requires `teamsForResults.length > 0`), `results_finalized = false`.
- Steps: add goals, pick scorer (mandatory) and assister (optional), tap "Guardar resultados" (`:379`).
- Result, in this order, all from the browser with the user's client:
  1. Validation: any goal without scorer → `alert('Cada gol necesita un goleador')` (`:145`).
  2. `DELETE FROM match_events WHERE match_id = …` (`:154-157`).
  3. For each goal: `INSERT match_events (event_type 'goal', player_id or guest_player_id, team_id)` then, if assister, `INSERT match_events (event_type 'assist', linked_event_id = goal id)` (`:164-195`). Sequential, non-atomic.
  4. `UPDATE teams SET score = <goal rows>` for each team (`:199-208`) — redundant, the RPC recomputes it.
  5. RPC `admin_finalize_match_results(p_match_id)` (`:212`) → `finalize_match_results` (`00011_post_match.sql:186-302`):
     - requires status `finished` (raises otherwise);
     - recomputes `teams.score` from goal events;
     - `player_profiles.matches_played += 1` for every signup with `status='confirmed'` (registered players only; `did_not_show` excluded);
     - `goals += n` and `assists += n` for registered scorers/assisters (guest events ignored for stats);
     - `clean_sheets += 1` for every registered player whose `team_assignments.position = 'GK'` on a team whose opponent's `score = 0`;
     - `update_player_reliability()` for every signup with a `player_id` on this match (any status, incl. cancelled);
     - `update_player_rating()` for every player who has a `match_ratings` row **on this match at this moment**;
     - sets `matches.results_finalized = TRUE`;
     - `award_badges_for_match()` (see A.6).
  6. RPC `emit_notification(group, match, 'results_posted', {match_id, dark_score, light_score})` (`:226-231`); errors only logged.
  7. Component switches to a "Resultados guardados" card with "Las estadísticas de los jugadores fueron actualizadas." (`:251-255`), `router.refresh()`.
- Error path: any step throws → `alert('Error al guardar los resultados')` (`:240`). Because step 2 already ran, a failure in step 3 leaves the match with partial or no events while the previous score remains in `teams.score` (until the next successful save).

**UC: Re-submit (correct) results after finalize**
- Preconditions: `results_finalized = true`. The editor reloads existing goals/assists from `match_events` (`:64-83`) and shows the same UI with button "Actualizar goles" (`:379`) and note "Las estadísticas ya fueron contabilizadas. Podés corregir los goles sin duplicar stats." (`:382-383`).
- Result: same steps 2–7. Inside `finalize_match_results` the `results_finalized` branch (`00011:201-215`) only recomputes `teams.score` and calls `award_badges_for_match` again; it **does not** touch `goals`, `assists`, `clean_sheets`, `matches_played`, reliability or ratings. The success card says "Los goles fueron actualizados." (`:253`). A **second `results_posted` notification** (and outbox row) is emitted on every save (`:226-231`).
- Consequence: player stat counters reflect the *first* submission forever; corrections change only the displayed score and goal list. Badges are additive (a hat-trick awarded on a wrong first save is never revoked; a corrected save that now qualifies adds a new badge).

**Display** (`match-score-display.tsx`): card "Resultado" with the two scores and per-team goal lines "⚽ {scorer} (asist. {assister})" (`:88-93`). Returns `null` if there are no goal events and both scores are 0 (`:33-35`), so a genuine 0-0 with no events is indistinguishable from "no results" and shows nothing to members. Admins see the editor **and** the "Resultado" card below it (`page.tsx:520-525`), duplicating the score.

Observed issues:
- Non-atomic delete-then-insert from the client (`match-results.tsx:154-195`); should be one RPC. Also every write uses `(supabase as any)` (`:154`, `:164`, `:183`, `:203`) contrary to the plan §1.
- No way to record a score without naming a scorer, nor own goals, nor a 0-0 that renders (`match-results.tsx:145`, `match-score-display.tsx:33`).
- Stats are not corrected on re-save; the UI copy "Podés corregir los goles sin duplicar stats" hides that the stats are simply not recomputed (`00011:201-215`).
- Duplicate `results_posted` notification on every save (`match-results.tsx:226`).
- `alert()` for validation/errors (`:145`, `:240`); no inline errors, not i18n'd.
- Direct `teams.score` update from the client is dead weight (`:199-208`).
- The "Estadísticas" sidebar on a finished match still shows "Inscritos / En espera / Disponibles" (`page.tsx:569-589`) — meaningless after the match.
- `page.tsx:325` fallback label `'Desconocido'` for players missing a profile.

---

### Feature: MVP voting

- **Actors**: any active group member who is logged in (UI); server-side only players with a `confirmed` signup on that match (RLS).
- **Entry points**: match page card "Votá al MVP del partido" (`post-match-voting.tsx:180`), rendered for everyone when status is `finished` and at least one confirmed registered player exists (`page.tsx:528-535`); the dashboard nudge (A.8) links here.

**UC: Vote for MVP (and optionally rate)**
- Preconditions: status `finished`; client-side window `Date.now() - match.date_time < 7 days` (`post-match-voting.tsx:12,47`); no existing vote by the current player (`:51-58`); server-side RLS "Players can vote MVP" (`00011:338-353`): `voter_player_id = get_current_player_id()`, voter has a `confirmed` signup, match `finished`, `date_time > now() - 7 days`.
- Steps: card shows "¿Quién fue el mejor jugador?" (`:186`) and a list of candidate buttons (avatar, display_name, nickname in parentheses). Candidates = `matchPlayers` = confirmed signups with a `player_profiles` row (`page.tsx:242-244`; guests and no-shows excluded) minus the current player (`:45`, so you can't vote for yourself). Selecting a candidate highlights it with a trophy. Below, "Calificá a tus compañeros (opcional)" (`:215`) with a 1–5 star row per candidate (tap the same star again to clear, `:223-228`). Button "Enviar voto" (`:255`) is disabled until an MVP is selected (`:247`) — ratings alone cannot be submitted.
- Result: `INSERT match_mvp_votes (match_id, voter_player_id, candidate_player_id)` (`:90-96`); then `INSERT match_ratings[]` for every star > 0 (`:103-112`). Trigger `match_mvp_votes_recompute` (`00011:73-90`) → `recompute_match_mvp` (`00011:26-67`): picks the candidate with most votes, tie → earliest first vote; if the holder changed: decrements previous holder's `mvp_count` (floor 0) and deletes their `mvp` badge for this match, increments the new holder and inserts an `mvp` badge, updates `matches.mvp_player_id`. The card switches to "¡Voto registrado!" (`:136`) with the top-3 tally (`:148`, "🏆" for first, "#2", "#3", "{n} voto/votos"), or "Sos el primero en votar. Los resultados aparecerán cuando voten más jugadores." (`:167`) when the tally is still empty in state. `router.refresh()` → header shows "MVP: {name}" (`page.tsx:377-382`).
- Variants/edge:
  - **Re-voting**: impossible. `UNIQUE(match_id, voter_player_id)` (`00001:240-249`) and no UPDATE/DELETE policy on `match_mvp_votes` (`00003:293-312`, `00011:338-353` only replace the INSERT policy). A second attempt is prevented client-side by `existingVote`.
  - **Window closed** (client `!votingOpen`): card titled "MVP del partido" with "La votación cerró" (`:141`) and the top-3 tally, or "Todavía no hay votos." (`:167`). Note the window is measured from `date_time`, not from when the match was finished — if an admin finishes a match 8 days late, voting is closed before it opens.
  - **Non-participants** (members who did not play, incl. admins): the form is rendered for them; on submit RLS rejects the insert → `alert('Error al enviar los votos')` (`:122`). Nothing tells them beforehand they can't vote.
  - **Guests** cannot vote (no account) and cannot be voted for (excluded at `page.tsx:243`).
  - **Players marked no-show**: removed from candidates on next render (status ≠ `confirmed`), and lose voting rights (RLS requires `confirmed`). Votes already cast for them stay and still count in `recompute_match_mvp`.
  - Vote for MVP is "decided" instantly: the first single vote makes that player MVP, increments `mvp_count` and grants the `mvp` badge; it may flip back and forth as votes arrive. There is no quorum, no close-of-voting event, no announcement of the final MVP.
  - Ratings are submitted in the same transaction-less sequence: if the ratings insert fails, the MVP vote is already stored but the user sees the error alert and `existingVote` is not set until reload (`:117-118` only run on success).
  - Real-time: `realtime-wrapper.tsx` only listens to `match_signups`; other viewers don't see new votes/results until they reload.

Observed issues:
- Voting card shown to users who can't vote (`page.tsx:528` has no participant check).
- Rating copy "Calificá a tus compañeros" but the list includes opponents too (`post-match-voting.tsx:216` iterates all candidates).
- Ratings can't be sent without an MVP vote (`:84`, `:247`).
- Legacy `get_match_mvp()` (`00004:208-222`) still exists and is not used by the new flow.

---

### Feature: Teammate ratings (1–5)

- **Actors**: same as MVP voting; stored in `match_ratings` (`00001:220-231`, `UNIQUE(match_id, voter_player_id, rated_player_id)`, `rating BETWEEN 1 AND 5`, unused `comment` column).
- RLS insert (`00011:322-336`): same conditions as MVP vote (confirmed signup, finished, 7-day window). No UPDATE/DELETE → cannot change a rating.
- **How they are used**: `update_player_rating(p)` (`00004:184-201`) sets `player_profiles.overall_rating = AVG(rating)` over **all** `match_ratings` rows for that player, all matches, all time, rounded to 2 decimals. It is called **only** from `finalize_match_results`, only for players rated on that match, and only during the first (non-finalized) pass (`00011:290-294`). Consequence: ratings submitted **after** the admin loads results (the normal order: admin loads score that night, players rate during the week) are **never** folded into `overall_rating`. Ratings submitted before results are loaded are. There is no trigger on `match_ratings`.
- **Recent form**: not implemented anywhere (no column, no function, no UI; grep for `recent_form`/`recentForm` returns nothing). Spec §4.7 "Player's overall rating and recent form" is half done.
- Where `overall_rating` is shown: signup list star (`signup-list.tsx:198-201`), profile header (`profile/page.tsx:97-102`), and it feeds AI team generation.

---

### Feature: No-shows

- **Actors**: admin, captain.
- **Entry points**: on a `finished` match, in the "Confirmados" list each row has a ghost icon button (UserX) with tooltip "Marcar que no vino"; a no-show row shows a RotateCcw icon with tooltip "Marcar como presente" (`signup-list.tsx:215-233`, gated by `canToggleNoShow = isAdminOrCaptain && matchStatus === 'finished'`, `:83`).

**UC: Mark a confirmed player as no-show**
- Preconditions: admin/captain; match `finished`; row status `confirmed`.
- Steps: tap the UserX icon. No confirmation.
- Result: RPC `admin_set_signup_status(signup_id, 'did_not_show')` (`00014:27-70`): checks `is_group_admin_or_captain`, updates status, does **not** promote from the waitlist on finished matches (`:61-64`), then `update_player_reliability(player_id)` (`:66-68`). Row re-renders at 60% opacity with badge "No vino" (`signup-list.tsx:184`); the remove (X) button is hidden for no-shows (`:235`). The player disappears from MVP candidates and voting eligibility on next render. The "Confirmados (n/max)" header count and the sidebar "Inscritos" count drop by one (they count only `confirmed`, `page.tsx:177`).
- Variants: guests can be marked no-show (no reliability effect, no `player_id`). Toggle back with "Marcar como presente" → status `confirmed`, reliability recomputed again.
- Edge: if results were already finalized, `matches_played` was already incremented for this player and is **not** decremented when they are later marked no-show; conversely, a no-show marked *before* finalize is correctly excluded from `matches_played` (`00011:229-235`). Order of operations matters and nothing in the UI suggests marking no-shows first.

Observed issues:
- Order dependency between no-shows and "Guardar resultados" (above).
- No confirmation on an action with a reputational effect (spec: "avoid shaming UI"); the "No vino" badge is shown to every member of the group in the list.

---

### Feature: Badges

Storage: `player_badges (player_id, badge_type text, earned_at, match_id, metadata)` with `UNIQUE(player_id, badge_type, match_id)` (`00001:297-305`). RLS: SELECT `USING (TRUE)` and INSERT `WITH CHECK (TRUE)` (`00003:366-372`) — never tightened in later migrations.

Exact awarding conditions:

| badge_type | Awarded by | Condition (verbatim from SQL) | Icon (`signup-list.tsx:61-67`) |
|---|---|---|---|
| `hat_trick` | `award_badges_for_match` (`00011:113-121`) | ≥ 3 `match_events` rows with `event_type='goal'` and non-null `player_id` for the same player on this match (guests excluded) | ⚽ |
| `playmaker` | same (`:124-132`) | ≥ 2 `assist` events with non-null `player_id` on this match | 🎯 |
| `safe_hands` | same (`:135-148`) | registered player with `team_assignments.position = 'GK'` on a team whose **opponent** team has `score = 0` (so a 0-0 gives it to both GKs; GK assignment is whatever position was saved on the lineup) | 🧤 |
| `ironman` | same (`:151-176`) | only when the group has ≥ 10 `finished` matches; player has a `confirmed` signup in **all** of the group's 10 most recent finished matches (by `date_time`, *including* the current one if it's among the 10 most recent — note the current match must be finished, which it is). Re-awarded (new row with the new `match_id`) at every subsequent finalize while the streak holds. | 💪 |
| `mvp` | `recompute_match_mvp` trigger (`00011:56-63`), deleted when the holder changes (`:51-53`) | current top-voted candidate of the match; moves with the votes | 🏆 |

`award_badges_for_match` runs at the end of both finalize passes (`00011:213`, `:300`), so corrected results can add but never remove `hat_trick`/`playmaker`/`safe_hands`/`ironman`.

Where badges are shown:
- Match page signup lists: up to 3 most recently earned badge icons next to the name, `title` attribute = raw keys joined (e.g. "hat_trick, mvp") (`page.tsx:189-212`, `signup-list.tsx:186-192`). Unknown types → 🏅.
- **Profile page: badges are NOT shown** (`src/app/(dashboard)/profile/page.tsx` never queries `player_badges`; the imported `Badge` is the UI chip component). Plan §2.5 says "Show badges on the profile page (already exists)" — it does not exist.
- Group page member list shows only `matches_played` and `mvp_count` (`groups/[groupSlug]/page.tsx:421-428`), no badges.

Observed issues:
- `player_badges` INSERT policy `WITH CHECK (TRUE)` (`00003:370-372`): any authenticated user can insert any badge for any player via the REST API. Security.
- Badges never revoked on corrected results; `ironman` accumulates one row per match once the streak is reached (by design but noisy: after 20 matches a regular has 11 ironman rows, and the list shows the 3 most recent → likely "💪💪💪").
- No badge names/descriptions in Spanish anywhere (tooltip shows raw keys).
- Spec §4.7 wording: "Hat-trick hero", "Playmaker (X assists)", "Ironman (10 matches in a row)", "Safe hands"; implemented thresholds: 3 goals, 2 assists, 10 consecutive *finished group matches attended* (not "matches in a row played by the player" if the group had matches the player skipped — same thing here), clean sheet.

---

### Feature: Rating, reliability and stat computation (formulas)

- **overall_rating** (`00004:184-201`): `AVG(match_ratings.rating)` over every rating the player ever received, cast to `DECIMAL(3,2)`; default `3.00`; column CHECK 1–5. Only updated inside `finalize_match_results` (first pass) for players rated on that match at that moment (`00011:290-294`). Ratings that arrive later never count (see A.3).
- **recent form**: not implemented.
- **reliability_score** (`00004:144-177`): over **all** of the player's `match_signups` joined to `matches`:
  - `late_cancels` = signups with `status='cancelled'` and `cancel_time > match.date_time - 6 hours`
  - `no_shows` = signups with `status='did_not_show'`
  - `score = 1.00 - 0.05 * late_cancels - 0.15 * no_shows`, clamped to `[0, 1]`; `1.00` if the player has no signups at all. Attendance itself never raises the score (it's purely penalty-based, never recovers).
  - Recomputed: at finalize for everyone with a signup on that match (`00011:281-284`), and on every `admin_set_signup_status` for that player (`00014:66-68`). A late cancel therefore only "lands" on the profile once one of those events happens for that player.
  - Displayed on the profile as a bar + percentage under "Confiabilidad", "Basado en asistencia y cancelaciones" (`profile/page.tsx:149-169`).
- **matches_played / goals / assists / clean_sheets / mvp_count**: counters on `player_profiles`; incremented once per match at first finalize (A.2) except `mvp_count`, which is maintained live by the MVP trigger (A.3). Guests have no counters.
- Profile "Estadísticas" card: "Partidos jugados", "Goles", "Asistencias", "MVPs", and "Vallas invictas" only when > 0 (`profile/page.tsx:107-147`). No per-match history, no "Recent matches summary" (spec §5.4).

---

### Feature: "Votá el MVP" dashboard nudge

- **Actors**: member.
- **Entry point**: top of `/groups` (`groups/page.tsx:196-215`).
- Logic (`:134-192`): among the user's groups, fetch `finished` matches with `date_time >= now - 7 days` ordered desc; keep those where the user has a `confirmed` signup and no `match_mvp_votes` row; pick the most recent one.
- UI: yellow card with trophy, title `groups.mvpNudgeTitle` = "Votá el MVP de {group} — {date}" (date `dd/M/yyyy` in the group's timezone), subtitle "Elegí al mejor jugador del partido"; the whole card links to the match page. English keys exist ("Vote for {group}'s MVP — {date}").
- Edge: only one nudge even if several matches are pending; disappears after voting or after 7 days from `date_time`. Uses the same 7-day rule as the client, consistent with RLS. Works.

---

## Part B — Notifications

### B.1 Every notification type: trigger, payload, template, recipients

Single write path: `emit_notification(p_group_id, p_match_id, p_type, p_payload)` (`00012_notifications.sql:115-172`), SECURITY DEFINER. Authorization: caller must be `service_role` or `is_group_member(p_group_id)` (`:139-142`). Toggle mapping (`:147-156`): `waitlist_promoted` ← `notify_on_waitlist_promotion`, `teams_created` ← `notify_on_teams_created`, `match_created` ← `send_signup_link_on_create`; `match_reminder` and `results_posted` always emit. It inserts one `notifications` row (recipient = `payload.recipient_player_id` if present, else NULL = whole group, `:162-165`) and, if the group's `whatsapp_webhook_url` is non-blank, one `notification_outbox` row (`:167-170`). Templates are in `src/lib/notifications/templates.ts` and are used both for the in-app list and the webhook text.

| type | Emitted when / by | Recipient (in-app) | Spanish template (`templates.ts`) |
|---|---|---|---|
| `match_created` | Only for **recurring** matches: `emitPendingMatchCreatedNotifications` (`src/lib/notifications/match-created.ts:30-85`) after `generate_recurring_matches`, called from `/api/cron/daily`, `/api/cron/recurring` (service role) and from the group page on every render (user client, `groups/[groupSlug]/page.tsx:157-160`). Emits for every `signup_open` match with a `recurring_pattern_id` that has no `match_created` row yet. **Manually created matches never emit it** (no call in `matches/new/page.tsx`). Gated by `send_signup_link_on_create`. | whole group | `¡Partido confirmado! {Weekday d/M} {HH:mm}hs en {location} -- {group_name}. Quedan {max_players} lugares. Anotate acá: {signup_url}` (`:20-27`; "en {location}" omitted if null; `signup_url` = `${NEXT_PUBLIC_APP_URL}/m/{id}`, fallback `http://localhost:3000`, `match-created.ts:57`) |
| `waitlist_promoted` | Inside `promote_from_waitlist` (`00012:235-244`) whenever a waitlisted signup is promoted (member cancels, admin removes someone, admin changes a status while the match is open, guest cancels via the public route). Gated by `notify_on_waitlist_promotion`. | the promoted **registered player only** (`recipient_player_id`); if the promoted signup is a **guest**, recipient is NULL → **whole group** sees it | `¡{player_name} entró! Se liberó un lugar en la lista de espera y ahora está confirmado/a.` (`:29`) |
| `teams_created` | `POST /api/matches/[matchId]/teams/generate` after AI/fallback generation, with the user's client (`teams/generate/route.ts:298-317`). Emitted **every** time teams are (re)generated; **not** emitted when teams are edited/saved manually via drag-and-drop. Gated by `notify_on_teams_created`. | whole group | `¡Se armaron los equipos! Oscuro: {names, comma-separated}. Claro: {names}.` (`:31-35`; "—" if a side is empty) |
| `match_reminder` | `emitMatchReminders` (`src/lib/notifications/reminders.ts`) from `/api/cron/daily` or `/api/cron/reminders`: for each `notification_settings` row, matches of that group with status in (`teams_created`,`full`,`signup_open`) and `now <= date_time <= now + reminder_hours_before` hours; one per match ever (dedupe on existing `match_reminder` row, `:56-71`). Not gated by any group toggle. | whole group | `Hoy {HH:mm} -- {group_name} -- remera oscura/clara según tu equipo` (`:37`; `location` is in the payload but unused) |
| `results_posted` | `match-results.tsx:226-231` after every successful "Guardar resultados"/"Actualizar goles", user client. Not gated. | whole group | `Resultado cargado: Oscuro {n} - Claro {m}.` (`:39`) |

Not emitted anywhere: match finished / "vote for MVP", match cancelled, match edited (time/location change), signup confirmations, MVP decided.

Payload shapes: `src/lib/notifications/types.ts:21-56` (`MatchCreatedPayload`, `WaitlistPromotedPayload {signup_id, player_name, recipient_player_id}`, `TeamsCreatedPayload {match_id, dark_team_names[], light_team_names[]}`, `MatchReminderPayload {match_id, group_name, time, location}`, `ResultsPostedPayload {match_id, dark_score, light_score}`).

### B.2 Read state

- Table `notification_reads (notification_id, player_id, read_at)` (`00012:47-52`): a row = read for that player; group-wide rows are shared, so read state is per player and never leaks across members.
- `mark_notifications_read(p_ids uuid[])` (`00012:265-290`): inserts read rows for the current player for the given ids, filtered to notifications the player may see; `ON CONFLICT DO NOTHING`.
- `get_unread_notification_count()` (`00012:292-315`): count of visible notifications (member of group; recipient NULL or self) without a read row. Ignores `users.notification_prefs`.
- There is no per-notification mark-as-read, no auto-mark on open, no "unread" filtering by type.

---

### Feature: Bell icon + `/notifications` page

- **Actors**: member.
- **Entry points**: header bell (`header.tsx:91-103`, `aria-label="Notificaciones"`, hardcoded Spanish) with a badge showing the unread count or "9+" (`:100`); links to `/notifications`. Not in the mobile menu list (the bell itself is always visible).

**UC: See unread count**
- On mount and on every pathname change the header calls RPC `get_unread_notification_count` (`header.tsx:37-52`). No realtime, no polling: a notification that arrives while the user sits on a page is not reflected until they navigate.

**UC: Read notifications**
- `/notifications` (`notifications/page.tsx`): title "Notificaciones", subtitle "Novedades de tus grupos". Server loads the latest 100 visible rows (RLS "Members can read their group's notifications", `00012:87-92`), the groups' slug/name/timezone, and the user's read rows; passes `users.notification_prefs`.
- `NotificationList` (`notification-list.tsx`): filters out types whose pref is `false` (`:71`, `match_created` has no pref so it always shows); each card shows a type icon, the template text (`safeRenderText`, rendered with the group's timezone, `:40-49`), "{group} · {d MMM HH:mm}" (`:31-38`), and a primary dot when unread; read cards are dimmed (`:127`). Cards link to the match page if `match_id` is set, else the group page (`:119-124`). Empty state "No tenés notificaciones todavía." (`:96`).

**UC: Mark all as read**
- Button "Marcar todo como leído" (`:111`), disabled when nothing visible is unread. Calls `mark_notifications_read(p_ids = visible unread ids)` (`:78`) and updates local state. Clicking a single notification does **not** mark it read.

Observed issues:
- Unread count vs prefs mismatch: the bell counts every visible notification (`00012:303-311`) but the page hides pref-disabled types and "Marcar todo como leído" only sends the *visible* ids (`notification-list.tsx:72`). A user who disables e.g. `results_posted` will carry a permanent unread badge they cannot clear.
- Whole page is hardcoded Spanish (`notifications/page.tsx:72-73`, `notification-list.tsx:96,111`) while `/settings` and the header are i18n'd; English users get a mixed UI. Header `aria-label` also hardcoded (`header.tsx:94`).
- `waitlist_promoted` text is written in the third person ("¡Juan entró! … ahora está confirmado/a") but the only in-app reader is Juan himself.
- `match_created` text says "Quedan {max_players} lugares" — it's the capacity, not the remaining spots (`templates.ts:25`).
- Notifications about a `cancelled`/deleted match: rows cascade-delete with the match (`00012:31`), so a deleted match silently removes its history; cancelled matches keep linking to the match page.
- No pagination beyond the first 100 rows.

---

### Feature: Group notification settings (`/groups/[slug]/settings` → card "Notificaciones")

- **Actors**: admin only for writes (RLS "Admins can manage notification settings" `USING (is_group_admin(group_id))`, `00003:358-360`); captains can read but any save fails with "Error al guardar la configuración" (`notification-settings.tsx:104`). The settings page itself is admin-gated upstream (not verified here).
- Loaded in `settings/page.tsx:104-127`; if the row is missing (it is normally created by `create_group_with_admin`, `00004:300-302`) the form uses defaults and inserts on save (`notification-settings.tsx:86-96`).

Fields (all `notification-settings.tsx`):
1. Toggle "Enviar link de inscripción" — "Al crear un partido, copiar automáticamente el link de inscripción" (`:133-135`) → `send_signup_link_on_create`. **Actual effect**: gates the `match_created` notification for recurring matches (`00012:152-153`). Nothing is "copied automatically"; manual match creation is unaffected. Copy is wrong.
2. Number input "Recordatorio antes del partido" — "Horas antes del partido para enviar recordatorio", `min 0 max 48`, suffix "horas" (`:154-174`) → `reminder_hours_before` (default 3). `parseInt(...) || 0`; non-numeric → 0 → reminders effectively never fire (window of zero length).
3. Toggle "Notificar promoción de lista de espera" — "Avisar cuando un jugador pasa de lista de espera a confirmado" (`:185-187`) → `notify_on_waitlist_promotion`.
4. Toggle "Notificar cuando se armen equipos" — "Avisar al grupo cuando se generan los equipos para un partido" (`:206-208`) → `notify_on_teams_created`.
5. URL input "Webhook de WhatsApp (opcional)" — "URL para enviar notificaciones automáticas a WhatsApp", placeholder `https://...`, help "Compatible con servicios como Twilio, WhatsApp Business API, o webhooks personalizados." (`:227-243`) → `whatsapp_webhook_url`. No validation beyond `type="url"`; empty string stored as NULL (`:74`).
- Save: "Guardar cambios" appears only when something changed (`:248`); success banner "Configuración guardada correctamente" for 3 s (`:122`). Uses `(supabase as any)` (`:80`, `:89`).
- No toggles exist for `match_reminder` or `results_posted` at group level (they always emit, `00012:154-155`); no "test webhook" button; no visibility of outbox failures.

Observed issues:
- Misleading copy on toggle 1 and on the webhook help text (Twilio / WhatsApp Business API do not accept the `{text,type,payload}` JSON this app posts — a bridge is required).
- Toggle uses `bg-gray-200` for the off state (`:41`) — a hardcoded light-theme colour in a dark-by-default app (the `/settings` version uses `bg-muted`, `settings-form.tsx:36`).
- `src/i18n/es.json` `notifications.*` keys ("Enviar link al crear partido", "Recordatorio antes del partido", …) exist but this component doesn't use them (all strings inline).

---

### Feature: Per-user notification preferences (`/settings`)

- **Actors**: the user.
- UI (`settings-form.tsx:106-136,184-211`): section `settings.notifications` "Notificaciones" — "Elegí qué te queremos avisar" with four toggles: "Promoción de lista de espera" / "Cuando pasás de la lista de espera a confirmado"; "Equipos armados" / "Cuando se generan los equipos de un partido"; "Recordatorio de partido" / "Antes de que empiece un partido en el que estás anotado"; "Resultados publicados" / "Cuando se cargan los resultados de un partido". Defaults all `true` (`settings/page.tsx:50-55`). Saved with language + theme via server action `saveSettings` into `users.notification_prefs` jsonb (`actions.ts:36-42`).
- **Actual effect**: purely a display filter on `/notifications` (`notification-list.tsx:71`). It does not affect emission, the bell count, or the WhatsApp webhook. `match_created` has no pref.
- Copy mismatch: "Antes de que empiece un partido en el que estás anotado" — reminders are group-wide (recipient NULL) and go to every member whether or not they signed up (`reminders.ts:82-87`, `00012:162`).

---

### Feature: WhatsApp webhook outbox + dispatch

**What is actually implemented**: no WhatsApp API integration at all. The app POSTs JSON to a URL the group admin types in. Someone must run a bridge (Zapier/Make/Twilio function/own server) that turns that JSON into a WhatsApp message. Without a URL, nothing leaves the app and the announcement/lineup texts are shared by copy-paste from other components (out of this area).

- Queue: `notification_outbox (group_id, match_id, type, payload, channel='whatsapp_webhook', status pending|sent|failed, attempts, last_error, created_at, sent_at)` (`00012:56-68`), no RLS policies (service-role only). Rows are created by `emit_notification` only when the group has a URL **at emission time** (`00012:167-170`) — configuring the URL later does not backfill.
- Drain: `drainOutbox()` (`src/lib/notifications/dispatch.ts`): service-role client; up to 50 pending rows with `attempts < 5`, oldest first (`:10-11`, `:22-28`); rows with an unknown channel are skipped and stay pending forever (`:42-46`); for each row it re-reads the group's URL (`:48-54`) — blank URL → `failed` with `last_error = 'El grupo no tiene whatsapp_webhook_url configurada'` (`:56-67`); renders the text with `renderNotificationText(event)` **without the group timezone** (`:71`, so `match_created` date/time use `America/Argentina/Buenos_Aires` regardless of the group's timezone); POSTs; success → `sent` + `sent_at`; exception → `attempts+1`, `failed` once `attempts >= 5`, else stays `pending` (`:84-96`). Rows are processed sequentially; no concurrency guard, so two overlapping drains could double-send.
- Channel (`channels/whatsapp-webhook.ts`): `POST {webhookUrl}` with header `Content-Type: application/json`, body:
  ```json
  { "text": "<rendered Spanish template>", "type": "<notification type>", "payload": { ...raw payload jsonb... } }
  ```
  10 s timeout via `AbortController` (`:8`, `:20-21`); non-2xx → `Error('El webhook respondió con status N')`; timeout → `'El webhook no respondió a tiempo (10s)'`. No auth header, no signature, no idempotency key, no retry backoff.
- Triggering: only when a cron route runs (see B.7). Nothing drains the outbox at emission time.

Observed issues:
- **Delivery latency**: with the single daily cron, every webhook message (teams lineup, waitlist promotion, results) waits until the next 12:00 UTC run — up to ~24 h. A "teams created" WhatsApp message arriving the morning after the match is useless. (`vercel.json`, `dispatch.ts` only called from cron.)
- **SSRF**: any group admin can point the webhook at any URL (including internal/metadata endpoints) and the server will POST to it with service-role context (`dispatch.ts:73`, `whatsapp-webhook.ts:24`). No allow-list, no scheme check beyond the browser's `type="url"`.
- No way for the admin to see failures (`last_error`) or retry from the UI.
- Env comment in `.env.local.example` still says the individual routes are what is scheduled; `vercel.json` only registers `/api/cron/daily`.

---

### Feature: Reminders

- Implementation: `emitMatchReminders` (`reminders.ts:17-99`), described in B.1. `reminder_hours_before` default 3 (`:33`).
- **Real behaviour under the shipped schedule**: the only scheduled run is `/api/cron/daily` at `0 12 * * *` UTC (`vercel.json`) = 09:00 Buenos Aires (±59 min on Hobby). A reminder is emitted only if the match starts within `[now, now + hours]` at that instant. With the default 3 h, only matches kicking off between ~09:00 and ~12:00 local time ever get a reminder; the canonical "Lunes 21:00" match never does. To get any reminder for an evening match the admin would have to set ~12–13 h, and then the text still says "Hoy 21:00 …" sent at 09:00, which is arguably fine, but the setting's meaning ("X hours before") is not honoured — it's really "send at 09:00 if the match is within X hours".
- Matches in status `signup_closed` are excluded (`reminders.ts:46` lists only `teams_created`, `full`, `signup_open`), so a match whose signups were closed but whose teams were not generated yet gets no reminder.
- Groups without a `notification_settings` row are skipped entirely (`:20-32` iterates settings rows).
- `location` is collected but not rendered (`types.ts:49`, `templates.ts:37`).
- Emitted group-wide, ignoring who is signed up (`00012:162`, no `recipient_player_id` in payload). Spec §4.8 text is otherwise matched: "Hoy 21:00 – Fútbol lunes – remera oscura / clara según tu equipo" → implemented as `Hoy 21:00 -- {group} -- remera oscura/clara según tu equipo`.

---

### Feature: Cron routes

All four routes require `Authorization: Bearer ${CRON_SECRET}` and return `401 {error:'No autorizado'}` otherwise; they refuse if `CRON_SECRET` is unset (`daily/route.ts:29-32`, etc.).

| Route | Registered in `vercel.json`? | Does |
|---|---|---|
| `GET /api/cron/daily` | yes, `0 12 * * *` | 1) `generate_recurring_matches()` + `emitPendingMatchCreatedNotifications` 2) `drainOutbox()` 3) `emitMatchReminders()`; each step isolated, errors reported in the JSON (`daily/route.ts:41-63`). Order matters: `match_created` rows emitted in step 1 are drained in step 2 of the same run (good), but reminders emitted in step 3 sit in the outbox until the **next day's** run (bad: the reminder webhook is always ~24 h late, i.e. after the match). |
| `GET /api/cron/recurring` | no (manual) | recurring sweep + match_created |
| `GET /api/cron/notifications` | no (manual) | drain outbox |
| `GET /api/cron/reminders` | no (manual) | reminders sweep |

Consequence: in-app reminders appear at 09:00 local if the window matches; WhatsApp reminders effectively never arrive before the match.

---

## Part C — Consolidated issue list (for annotation)

Severity: **H** = blocks the intended product behaviour or security; **M** = wrong/confusing behaviour; **L** = polish.

Post-match
1. **H** Teammate ratings almost never affect `overall_rating`: `update_player_rating` runs only inside the first `finalize_match_results` pass, for ratings existing at that instant (`00011:286-294`, `00004:184-201`). Ratings cast after the admin loads the score are ignored forever. No trigger on `match_ratings`.
2. **H** "Recent form" (spec §4.7) not implemented anywhere.
3. **H** `player_badges` INSERT policy `WITH CHECK (TRUE)` lets any authenticated user forge badges (`00003:370-372`).
4. **M** Corrected results never fix player counters (`goals`, `assists`, `clean_sheets`, `matches_played`), and badges are never revoked (`00011:201-215`). UI copy "Podés corregir los goles sin duplicar stats" (`match-results.tsx:382`) obscures this.
5. **M** Results save is a non-atomic client-side delete + N inserts with `(supabase as any)` (`match-results.tsx:154-208`); partial failure leaves inconsistent events.
6. **M** No-show marked after finalize does not decrement `matches_played`; order of "mark no-shows" vs "Guardar resultados" silently matters (`00011:229-235`, `00014:27-70`).
7. **M** Score cannot be recorded without naming every scorer; no own goals; a 0-0 shows nothing to members (`match-results.tsx:145`, `match-score-display.tsx:33-35`).
8. **M** Voting card is rendered for members who didn't play; they only learn via `alert('Error al enviar los votos')` after RLS rejects (`page.tsx:528`, `post-match-voting.tsx:122`).
9. **M** MVP is "decided" from the first vote, flips live, increments/decrements `mvp_count` and badge live; no quorum/close/announcement (`00011:26-67`). Header "MVP: {name}" appears after one vote (`page.tsx:377`).
10. **M** Voting window counts from `date_time`, not from finish (`post-match-voting.tsx:47`, `00011:335,351`): a match finished late may be un-votable.
11. **M** Ratings cannot be submitted without an MVP vote; "Calificá a tus compañeros" includes opponents (`post-match-voting.tsx:84,216,247`).
12. **M** `results_posted` notification (and webhook row) emitted on every re-save (`match-results.tsx:226`).
13. **M** Badges not shown on the profile page despite plan §2.5 (`profile/page.tsx` never reads `player_badges`); tooltips show raw keys like `hat_trick` (`signup-list.tsx:187`).
14. **L** "Marcar como finalizado" and no-show toggle have no confirmation; `finished` is irreversible (`match-admin-actions.tsx:153`, `signup-list.tsx:215`).
15. **L** `alert()` everywhere for errors (`match-results.tsx:145,240`, `post-match-voting.tsx:122`, `signup-list.tsx:103,126`, `match-admin-actions.tsx:46`).
16. **L** Language: "Tú" badge (`signup-list.tsx:178`) is not Rioplatense ("Vos"); mixed i18n (status labels via `t()`, everything else hardcoded Spanish in the same page).
17. **L** Admin sees score twice (editor + "Resultado" card, `page.tsx:502-525`); sidebar "Estadísticas" (Inscritos/En espera/Disponibles) is meaningless on finished matches (`page.tsx:569-589`).
18. **L** Legacy `get_match_mvp()` and `process_match_signup`/`cancel_match_signup` remnants in `00004` (the latter two are dropped by T1 per plan; `get_match_mvp` still lives).
19. **L** Realtime wrapper only tracks `match_signups`; votes/results don't refresh for other viewers (`realtime-wrapper.tsx:18-33`).

Notifications
20. **H** Reminders effectively don't work for evening matches: single daily cron at 12:00 UTC + "within X hours" window (`vercel.json`, `reminders.ts:33-48`). WhatsApp reminders are additionally drained only on the *next* daily run (`daily/route.ts:51-63` order), i.e. after the match.
21. **H** Every WhatsApp webhook delivery waits for the daily cron (up to ~24 h) — lineups, promotions and results arrive the next morning (`dispatch.ts` only invoked from cron).
22. **H** SSRF: admin-supplied webhook URL is fetched server-side with no allow-list (`dispatch.ts:73`, `whatsapp-webhook.ts:24`).
23. **M** Nothing is actually sent to WhatsApp; the payload is `{text,type,payload}` JSON to an arbitrary URL. Settings copy claims compatibility with "Twilio, WhatsApp Business API" (`notification-settings.tsx:243`) — misleading.
24. **M** `match_created` only fires for recurring matches; manually created matches emit nothing (`match-created.ts:34-38`; no emit in `matches/new`). The group toggle "Enviar link de inscripción — Al crear un partido, copiar automáticamente el link de inscripción" describes something that doesn't exist (`notification-settings.tsx:133-135`).
25. **M** `teams_created` is not emitted when teams are saved manually (only from the generate route, `teams/generate/route.ts:298-317`), and is re-emitted on every regeneration.
26. **M** Bell count ignores `notification_prefs` while the page hides those types and "Marcar todo como leído" only marks visible ones → un-clearable badge (`00012:292-315`, `notification-list.tsx:71-72`).
27. **M** `waitlist_promoted`: targeted to the player when registered, but group-wide when the promoted signup is a guest (`00012:227-244`, `:162`); text is third-person for a first-person reader. Webhook row always goes to the group's URL regardless.
28. **M** Per-user pref "Recordatorio de partido — Antes de que empiece un partido en el que estás anotado" is inaccurate: reminders are group-wide and prefs only filter the list (`settings-form.tsx:124-129`, `notification-list.tsx:71`).
29. **M** `reminder_hours_before` parse `|| 0` → 0 disables reminders silently; `signup_closed` matches get no reminder (`notification-settings.tsx:169`, `reminders.ts:46`).
30. **M** Outbox text rendered without the group timezone (`dispatch.ts:71`) — wrong date/time in `match_created` webhook text for non-BA groups; `match_created` says "Quedan {max_players} lugares" (capacity, not remaining) (`templates.ts:25`).
31. **M** Outbox rows are only created if the URL exists at emission time; no backfill, no UI for failures/retries, no concurrency guard on drain (`00012:167-170`, `dispatch.ts`).
32. **L** `/notifications` page and bell `aria-label` hardcoded Spanish while `/settings` is i18n'd (`notifications/page.tsx:72-73`, `notification-list.tsx:96,111`, `header.tsx:94`); `es.json` `notifications.*` keys are unused by the group settings component.
33. **L** No per-item mark-as-read; opening a notification doesn't mark it read (`notification-list.tsx:142-148`).
34. **L** Group settings toggle off-colour `bg-gray-200` (`notification-settings.tsx:41`); `(supabase as any)` writes (`:80,89`).
35. **L** Captains can open the group notification settings form but cannot save (RLS admin-only, `00003:358-360`); error is generic.
36. **L** `.env.local.example` comments describe three scheduled cron routes; only `/api/cron/daily` is scheduled (`vercel.json`).
37. **L** No notification for: match finished / please vote, match cancelled, match edited, MVP decided.

---

## Part D — Spec comparison

**§4.7 Ratings, MVP & gamification**
- "Players get a request (non-mandatory) to vote MVP / rate teammates 1–5" → partially: on-page card + dashboard nudge; no push/in-app notification; ratings gated behind MVP vote.
- "Keep this positive / internal. Avoid shaming UI" → tally limited to top 3 (`post-match-voting.tsx:148`), ratings never displayed per match — OK. But the "No vino" badge is visible to all members.
- "Use ratings to update overall rating and recent form" → overall rating: broken in practice (issue 1); recent form: missing (issue 2).
- "MVP count per player" → yes, live via trigger.
- Badges "Hat-trick hero / Playmaker / Ironman / Safe hands" → implemented as `hat_trick`(3 goals), `playmaker`(2 assists), `ironman`(10 consecutive group matches), `safe_hands`(GK clean sheet) + `mvp`; shown only as emoji in signup lists; **not on profile** (spec: "Show badges on player profile and maybe a small badge in the lineup").

**§4.8 Notifications & WhatsApp (conceptual)**
- "On match creation (especially recurring Monday match) post an automated message … date & time, location, sign-up link, required shirt colors" → `match_created` for recurring matches only; template has date/time/location/link but **no shirt colours**. Manual matches: nothing (the copyable announcement component is outside this area).
- "Reminders X hours before" → implemented in shape, unusable under the shipped single-daily-cron schedule (issue 20).
- "Notifications when a spot opens and someone from waitlist is promoted / teams are generated" → both implemented (with caveats 25, 27).
- "Abstract so later we can plug a real WhatsApp API or webhook" → done: `channels/whatsapp-webhook.ts` + outbox; only one channel; the abstraction is a single function, not an interface.

**§5.5 Ratings & MVP flow — "Simple dialog or page after match: MVP selection; optional 1–5 rating per teammate; quick and mobile-friendly"** → a card on the match page (not a dialog/dedicated page); mobile layout fine; not reachable from a notification; rating optional but MVP mandatory.

**§5 Settings — "Notification preferences"** → present, but they only filter the in-app list.

**§5.4 Player profile — "Stats: matches, goals, assists, MVPs, reliability. Recent matches summary. Badges."** → stats and reliability bar present; recent matches summary and badges missing.
