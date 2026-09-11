# Crowd-sourced match results (design)

Status: approved contract, 2026-09-10 (all decisions in §10 taken). Branch `maxolabs/match-results`.

## 1. Goal

After a match finishes, every player who played gets asked (in-app + WhatsApp group
link) to report the score, who scored and the MVP. Reports are combined into a
single consensus result. Group admins and captains weigh a bit more than members.
The admin can always override and lock.

## 2. What exists today (and what has to change)

| Piece | Today | Problem for this feature |
|---|---|---|
| `matches.status = 'finished'` | Admin clicks "Finalizar" in `match-admin-actions.tsx` | Nothing fires automatically; notification needs an auto-finish. |
| Score / scorers | Admin or captain enters goals in `match-results.tsx` -> `match_events` + `teams.score`, then `admin_finalize_match_results` | Single authoritative entry; no per-player reports. |
| MVP | `match_mvp_votes` (1 per voter), trigger `recompute_match_mvp` picks plurality, tie -> earliest | Already a vote; only needs weights and a self-vote guard. |
| Teammate ratings | `match_ratings` 1–5 | Out of scope here; keep. |
| Stats | `finalize_match_results` increments counters once (`results_finalized`) | Consensus changes over time; incremental counters drift. Must become recomputable. |
| Voting window | RLS: `finished` and `date_time > now() - 7 days`; no UPDATE/DELETE policy, so a vote can never be changed | Reuse as the reporting window (make it a group setting); reports and votes must become editable inside it. |
| Results save | `match-results.tsx` deletes and re-inserts events client-side, non-atomic, and re-emits `results_posted` on every save | Replace with one RPC; post to the group once. |
| Status transitions | `admin_set_match_status` only allows `teams_created -> finished` | Auto-finish applies only to matches with teams; a match without teams has no dark/light to report on anyway. |
| Notifications | `notifications` (in-app) + `notification_outbox` (channel `whatsapp_webhook`, group message only) | No per-player DM channel. |
| Scheduler | One Vercel cron at 12:00 UTC (`/api/cron/daily`) | "X hours after the match" is impossible with a daily tick. |
| Roles | `group_members.role` in {admin, captain, member}, group level | Captain is not per match; fine for weighting. |

## 3. Data model

```sql
-- One report per player per match. Editable while the window is open.
-- Everything is optional: a report is partial evidence, not a full account.
-- Absence of a scorer/assister means "no me acuerdo", NOT zero.
match_reports (
  id uuid pk,
  match_id uuid not null -> matches,
  reporter_player_id uuid not null -> player_profiles,
  dark_score smallint null,                  -- null = didn't report the score
  light_score smallint null,
  dark_goals_complete boolean not null default false,   -- "estos fueron todos los goles de este equipo"
  light_goals_complete boolean not null default false,  -- turns absence into an explicit 0
  mvp_candidate_id uuid null -> player_profiles,        -- kept in sync with match_mvp_votes
  created_at, updated_at,
  unique (match_id, reporter_player_id)
  -- The RPC rejects an empty report (no score, no stats rows, no MVP).
)

-- Per-player counts remembered by this reporter (not minute-level events).
match_report_stats (
  report_id uuid -> match_reports on delete cascade,
  team_id uuid -> teams,
  player_id uuid null -> player_profiles,
  guest_player_id uuid null -> guest_players,
  goals smallint not null default 0,
  assists smallint not null default 0,
  check (goals > 0 or assists > 0),
  check (player_id is not null or guest_player_id is not null),
  unique (report_id, team_id, player_id, guest_player_id)
)

-- Consensus state on the match
matches.result_status text not null default 'pending'
  -- pending | provisional | consensus | locked
matches.result_locked_by uuid null, matches.result_locked_at timestamptz null
matches.duration_minutes smallint not null default 60
matches.results_request_delay_minutes smallint not null default 60   -- per match, set by the admin
                                                                      -- in the create/edit form ("Pedir el
                                                                      -- resultado X min después del final");
                                                                      -- recurring matches copy the group default

-- Group defaults (notification_settings row already exists per group)
notification_settings.default_duration_minutes int default 60
notification_settings.default_results_request_delay_minutes int default 60
notification_settings.results_reminder_hours int default 24          -- second nudge, 0 = off
notification_settings.results_window_days int default 7              -- replaces the hard-coded 7
groups.settings jsonb: { "result_weights": { "admin": 1.5, "captain": 1.25, "member": 1.0 } }  -- decided 2026-09-10
```

`match_events` and `teams.score` stay the canonical "final result" that every other
feature reads. The consensus function regenerates them; it does not add a second
source of truth for the rest of the app.

MVP: keep `match_mvp_votes` and its trigger. The report form writes the vote there,
`recompute_match_mvp` gets weights (below). `match_reports.mvp_candidate_id` is
denormalised only so one row shows the whole report.

## 4. Consensus algorithm (`recompute_match_consensus(p_match_id)`)

Runs after every insert/update/delete on `match_reports` / `match_report_goals`
(and on `match_mvp_votes`), unless `result_status = 'locked'`.

**Weights.** `w(report) = weights[role of reporter in group]`. Reporters must have a
`confirmed` signup for the match (not `did_not_show`, not waitlist). Guests cannot
report (no account) but can be named as scorers.

**Score.** The candidate is the pair `(dark, light)`, never each team separately
and never an average (2-1 and 4-1 must not become 3-1). Pick the pair with the
highest total weight. Tie-break: more raw reports, then the pair containing the
highest-weight reporter, then earliest report.

**Score.** Only reports with both scores count. A report with one score (rare) is
ignored for the pair.

**Scorers and assists: complementary, not majority.** Amateur matches end 7-5 and
nobody remembers everything. Each report is treated as *partial memory*: a player
not mentioned is "no sé", not "no scored". Per (team, player):

- Evidence set = reports that mention that player on that team, plus reports that
  marked that team's goal list as complete (those count as an explicit 0).
- Consensus count = weighted mode of the counts in the evidence set; tie -> the
  **higher** count (forgetting a goal is far more common than inventing one).
- Support = total weight of reports whose count equals the consensus count.

Then reconcile with the consensus team score:

- sum of attributed goals > team score: drop the attributions with the least
  support until it fits (a single unconfirmed report loses to two agreeing ones);
- sum < team score: fill the difference with unattributed goals
  (`match_events.player_id = null`, which the schema already allows). The UI shows
  "2 goles sin autor" and keeps asking whoever hasn't reported.

Assists follow the same rule independently, capped at the team's goals. A goal
event and an assist event are not linked (`linked_event_id` stays null) unless a
report names both for the same goal, which the form does not ask for in v1.

Net effect: one player who remembers the scorers and another who only remembers
the assists produce a complete result together, and the score can be settled by
people who remember nothing else.

**MVP.** `recompute_match_mvp` sums weights instead of counting rows. Tie-break:
more raw votes, then earliest vote. Self-votes are rejected at insert.

**Status.**

| `result_status` | When |
|---|---|
| `pending` | No reports yet. |
| `provisional` | Reports exist but quorum or majority not reached. Result shown with a "provisional" tag and "3 de 14 reportaron". |
| `consensus` | `distinct reporters >= quorum` and the winning score pair holds `>= 50%` of total weight. Quorum = `min(3, ceil(players/3))`. An admin's report alone leaves the match `provisional`; the admin reaches a final state by pressing "Cerrar resultado" (lock), not by weight. |
| `locked` | Admin locked (with or without editing). Reports keep being stored but no longer recompute. |

**Output.** Write `teams.score`, replace this match's `match_events` of source
`consensus` with the reconciled goals (add `match_events.source text default 'admin'`
so admin-entered events survive), set `matches.mvp_player_id`, set `result_status`.

**Stats.** Turn `finalize_match_results` into an idempotent recompute: player
counters (`goals`, `assists`, `clean_sheets`, `mvp_count`, `matches_played`) are
rebuilt from `match_events` / `matches` / `match_signups` of finished matches, and
badges are re-derived (delete badges whose condition no longer holds). Run it when
a match reaches `consensus` or `locked`, and again at window close. This is the
one prerequisite that touches existing behaviour; without it a late report that
changes the consensus double-counts.

## 5. Flow and notifications

1. **Auto-finish.** A sweep sets `status = 'finished'` when
   `now() > date_time + duration` for matches in `teams_created` (the only state the
   transition table allows). Admin's manual "Finalizar" stays as an early exit.
   Matches that never got teams stay where they are and the admin sees a
   "sin equipos, no se puede cerrar" hint.
2. **T + delay.** `results_request` notification: in-app for every confirmed player
   (deep link `/groups/[slug]/matches/[id]#reportar`) and one WhatsApp group
   message ("¿Cómo salió? Cargá el resultado: <link>"). Respect
   `notification_prefs.results_request` per user.
3. **T + delay + reminder_hours.** `results_reminder` only to players who have not
   reported, and only while `result_status != consensus/locked`. One reminder, not a loop.
4. **On reaching `consensus` the first time.** `results_posted` (already exists) to
   the group: "Oscuro 4 – Claro 1. Goles: ... MVP: ...". Do not re-post on every
   change; post again only if a lock changes the result.
5. **Window close.** Sweep: matches finished more than `results_window_days` ago
   with `provisional` get `consensus` if any report exists (best effort) and the
   admin gets a `results_needs_review` in-app notification; stats recompute.

**Scheduler: an in-repo job queue plus a ticker (decided 2026-09-10).** No
dependency on pg_cron, Vercel Pro or GitHub Actions. Two parts:

1. `scheduled_jobs` table: `id, group_id, match_id, type, run_at, payload jsonb,
   status pending|running|done|failed, attempts, last_error, locked_at`. Every timed
   step above is a row: `auto_finish` (at `date_time + duration`), `results_request`
   (at finish + delay), `results_reminder`, `results_window_close`. Rows are created
   when the match is created/edited (and re-dated if the admin edits the time or
   delay) so nothing is computed at tick time except "what is due".
2. `POST /api/cron/tick` (guarded by `CRON_SECRET`): claims due rows with
   `SELECT ... FOR UPDATE SKIP LOCKED`, runs each handler, drains the outbox, marks
   done/failed. Idempotent and safe to call as often as you like, from anywhere.

**Who calls tick.** A serverless deploy has no resident process, so the ticker has
to live outside the request path. Three drivers hit the same endpoint, and the work
never depends on which one fired:

- `scripts/ticker.ts` in the repo: a loop that POSTs `/api/cron/tick` every 60 s
  (Dockerfile + `npm run ticker`). Runs on any always-on box: the Mac, a Raspberry
  Pi, a 5 USD VPS, or a container next to the app if it ever leaves Vercel.
- The existing daily Vercel cron keeps calling tick as a floor, so a dead ticker
  degrades to "next morning" instead of "never".
- Opportunistic tick on traffic: the dashboard layout fires a non-awaited call to
  tick (through `@vercel/functions` `waitUntil` on Vercel, fire-and-forget
  elsewhere), throttled to once per minute via a `last_tick_at` row. If nobody has
  a ticker running, the first player who opens the app after the match still
  triggers the request for everyone.

Honest limit: with only the daily cron and no ticker, a 21:00 Monday match gets
its request at 09:00 Tuesday. Acceptable, but the per-match delay only means
something once a ticker exists.

## 6. Reporting UX (mobile, under 30 seconds)

- **Blind first.** The form never shows the current consensus before the player
  submits. Pre-filling would anchor everyone on the first report and make weighting
  meaningless. After submitting: "Coincidís con 5 de 7" and the provisional result.
- Step 1: score, two steppers (dark / light) with team colours.
- Step 1 is skippable too ("no me acuerdo el resultado"), as long as the report
  ends up with something.
- Step 2: goals and assists. Player chips per team; tap a chip to add a goal, tap
  its small "A" to add an assist; `-` to remove. Running total per team, and a
  checkbox per team "estos fueron todos" (sets `*_goals_complete`). Nothing is
  required; the copy says "cargá lo que te acuerdes, el resto lo completan los demás".
- Step 3: MVP, chips for everyone who played except yourself. Skippable.
- Own report is editable while the window is open; edits recompute. This needs
  UPDATE/DELETE policies (or an upsert RPC) on `match_reports` and `match_mvp_votes`,
  which today have none.
- Teammate ratings (1–5) stay a separate, optional step after the report, as today.
  They are out of scope for consensus, but note the known gap: they almost never
  reach `overall_rating` because the recompute runs only on the first finalize.
- Match page shows the result block with a status pill (Provisional / Consenso /
  Cerrado), count of reporters, and for admins/captains a "ver reportes" table of
  who said what, with disagreements highlighted.
- Admin: "Editar y cerrar" opens the existing `match-results.tsx` editor pre-filled
  with the consensus; saving locks. "Reabrir" unlocks.

## 7. Edge cases

- Late report after lock: stored, shown to admin as "reportó después del cierre", not applied.
- A report that changes an already-`consensus` result: recompute, notify the admin
  in-app ("El consenso cambió de 4-1 a 4-2"), no group message.
- Players who reported and are later marked `did_not_show`: their report is excluded on the next recompute.
- Scorer named who is not on that team's lineup (subs, swaps): allowed; UI lists the
  match's players under the team they were assigned to but lets you pick from the
  other team via "otro jugador".
- Coordinated wrong reports: the admin sees the disagreement table and locks. No
  automatic reputation weighting in v1.
- Zero reports at window close: `result_status` stays `pending`; admin gets
  `results_needs_review`; stats untouched.

## 8. Phases

1. **Prerequisites.** `scheduled_jobs` + tick endpoint + ticker script,
   `duration_minutes`, auto-finish job, idempotent `finalize_match_results`. Ship
   alone; no visible change except matches finishing on their own.
2. **Reports + consensus.** Tables, RPC `submit_match_report`, `recompute_match_consensus`,
   weighted MVP, report form, status pill, admin lock/override, reports table.
3. **Notifications.** `results_request`, `results_reminder`, group settings UI for
   delay / reminder / window / weights; `results_posted` only on consensus.
4. **Later.** Own goals, goal/assist linking, reporter accuracy weighting,
   per-player WhatsApp links when a DM channel exists.

## 9. Related fixes to bundle (cheap while touching this code)

- `player_badges` INSERT policy is `WITH CHECK (TRUE)`: anyone can forge badges. Badges
  should be written only by SECURITY DEFINER functions.
- Stats counters are global per person, not per group. The idempotent recompute in
  §4 is the moment to decide whether stats become per group (a `player_group_stats`
  table) or stay global.
- `groups.settings jsonb` exists and is unused anywhere in `src/`; it is the home for
  `result_weights` rather than adding columns.

## 10. Decisions (2026-09-10)

1. Weights 1.5 / 1.25 / 1.0.
2. Scheduler: in-repo `scheduled_jobs` + tick endpoint + ticker script; no external cron provider.
3. Quorum applies to everyone; an admin's single report is provisional until the admin locks. (Confirmed.)
4. Delay is a per-match field set by the admin in the match form, defaulting from the group.
5. Score, scorers, assists and MVP are all optional in the report; consensus complements
   partial reports (§4).
