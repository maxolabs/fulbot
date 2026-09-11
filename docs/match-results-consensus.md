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

## 11. Implementation contract (agents build against this; names are final)

Local stack for verification: Supabase at `http://127.0.0.1:56521`, Postgres
`postgresql://postgres:postgres@127.0.0.1:56522/postgres`, seed loaded
(`supabase/seed.sql`; every account's password is `password123`; `maxo@test.local`
is admin of `futbol-lunes`, `juan@test.local` its captain, `nico@test.local` admin
of `futbol-jueves`). App env for the stack is in the scratchpad `stack/app.env`.

### 11.1 Migrations (track S0)

`supabase/migrations/00019_scheduler.sql`

```sql
-- matches
matches.duration_minutes smallint not null default 60
matches.results_request_delay_minutes smallint not null default 60
matches.finished_at timestamptz null               -- set by trigger when status -> finished
matches.result_status text not null default 'pending'
  check (result_status in ('pending','provisional','consensus','locked'))
matches.result_locked_by uuid null references player_profiles(id)
matches.result_locked_at timestamptz null
matches.result_posted_key text null                -- "dark-light|mvp_id" last posted to the group

-- notification_settings (group defaults)
default_duration_minutes int not null default 60
default_results_request_delay_minutes int not null default 60
results_reminder_hours int not null default 24     -- 0 = no reminder
results_window_days int not null default 7

-- job queue (RLS enabled, no client policies; service role + SECURITY DEFINER only)
scheduled_jobs (
  id uuid pk default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  match_id uuid null references matches(id) on delete cascade,
  job_type text not null check (job_type in
    ('auto_finish','results_request','results_reminder','results_window_close')),
  run_at timestamptz not null,
  payload jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending','running','done','failed','cancelled')),
  attempts int not null default 0,
  last_error text null,
  locked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
-- one pending job per (match, type)
create unique index scheduled_jobs_pending_uniq on scheduled_jobs(match_id, job_type) where status = 'pending';
create index scheduled_jobs_due on scheduled_jobs(run_at) where status in ('pending','running');
```

Functions (all `SECURITY DEFINER`, `REVOKE ALL ... FROM PUBLIC, anon`; grant as noted):

| Function | Grant | Behaviour |
|---|---|---|
| `schedule_match_jobs(p_match_id uuid) returns void` | authenticated, service_role (internal; called by trigger) | Cancels this match's pending jobs, then: status in (`signup_open`,`signup_closed`,`full`,`teams_created`) -> `auto_finish` at `date_time + duration_minutes`; status `finished` -> `results_request` at `finished_at + results_request_delay_minutes` (skipped if `result_status = 'locked'`), `results_reminder` at request + `results_reminder_hours` (only if hours > 0), `results_window_close` at `date_time + results_window_days`; `cancelled` -> nothing. |
| trigger `matches_schedule_jobs` AFTER INSERT OR UPDATE OF status, date_time, duration_minutes, results_request_delay_minutes ON matches | | Sets `finished_at = now()` when status becomes `finished` (BEFORE trigger), then calls `schedule_match_jobs`. |
| `claim_due_jobs(p_limit int default 20) returns setof scheduled_jobs` | service_role only | Stamps `scheduler_state.last_tick_at = now()` first (single-row table, service role only; the opportunistic tick reads it as its cross-instance guard). `UPDATE ... SET status='running', locked_at=now(), attempts=attempts+1 WHERE id IN (SELECT id FROM scheduled_jobs WHERE (status='pending' AND run_at <= now()) OR (status='running' AND locked_at < now() - interval '10 minutes') ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT p_limit) RETURNING *`. |
| `run_scheduled_job(p_job_id uuid) returns jsonb` | service_role only | Executes the handler for the row (below) and marks it `done`; on exception marks `failed` if `attempts >= 5`, else back to `pending` with `run_at = now() + attempts * interval '2 minutes'` and `last_error`. Returns `{job_type, match_id, ok, error}`. Never raises. |
| `auto_finish_match(p_match_id uuid) returns boolean` | service_role only | If status = `teams_created` and `now() >= date_time + duration_minutes` -> status `finished`. Other statuses: returns false (job done, nothing to do). |
| `finalize_match_results(p_match_id uuid)` | (existing grants) | **Rewritten as an idempotent recompute.** Does not touch `teams.score`. Calls `recompute_player_stats(pid)` for every player with a confirmed/did_not_show signup, a `match_events` row or `mvp_player_id` in this match, then `award_badges_for_match`, sets `results_finalized = true`. |
| `recompute_player_stats(p_player_id uuid) returns void` | authenticated, service_role | Rebuilds `matches_played` (confirmed signups in `finished` matches), `goals`/`assists` (`match_events` in finished matches with `result_status in ('consensus','locked')`), `clean_sheets` (GK assignment in such matches where the other team scored 0), `mvp_count` (finished matches with `result_status in ('consensus','locked')` and `mvp_player_id = p`), reliability via existing `update_player_reliability`, rating via existing `update_player_rating`. |
| `award_badges_for_match` | (existing) | Also **revokes** `hat_trick`/`playmaker`/`safe_hands` rows for this match whose condition no longer holds. Only awards when `result_status in ('consensus','locked')`. |

Job handlers inside `run_scheduled_job`:

- `auto_finish` -> `auto_finish_match`.
- `results_request` -> if `result_status <> 'locked'`: `emit_notification(group, match, 'results_request', payload)` with payload `{match_id, group_name, date_time, report_url, player_ids}` (`player_ids` = confirmed registered players; the app shows the group-wide row only to them) (`report_url = app_url || '/groups/' || slug || '/matches/' || id || '#reportar'`; `app_url` comes from the job payload written by the trigger from `current_setting('app.settings.app_url', true)`, falling back to `''` so the app layer can prefix it).
- `results_reminder` -> if `result_status in ('pending','provisional')`: one group-wide `results_reminder` with payload `{match_id, group_name, date_time, report_url, pending_player_ids uuid[], pending_player_names text[]}` (confirmed players without a report). Skipped when nobody is pending.
- `results_window_close` -> if `result_status = 'provisional'` and there is at least one report: set `consensus` (best effort) and `finalize_match_results`; if `pending`: emit `results_needs_review` **in-app only** (insert into `notifications` directly, one row per admin with `recipient_player_id`, no outbox) with payload `{match_id, group_name, date_time, reports_count}`.

Backfill in 00018: `finished_at = date_time + duration` for existing finished matches; `result_status = 'locked'` where `results_finalized = true`; `schedule_match_jobs` for every non-cancelled match.

`supabase/migrations/00020_match_reports.sql`

```sql
match_events.source text not null default 'admin' check (source in ('admin','consensus'))

match_reports (
  id uuid pk default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  reporter_player_id uuid not null references player_profiles(id) on delete cascade,
  dark_score smallint null check (dark_score between 0 and 99),
  light_score smallint null check (light_score between 0 and 99),
  dark_goals_complete boolean not null default false,
  light_goals_complete boolean not null default false,
  mvp_candidate_id uuid null references player_profiles(id) on delete set null,
  submitted_after_lock boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, reporter_player_id)
)
match_report_stats (
  id uuid pk default gen_random_uuid(),
  report_id uuid not null references match_reports(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  player_id uuid null references player_profiles(id) on delete cascade,
  guest_player_id uuid null references guest_players(id) on delete cascade,
  goals smallint not null default 0 check (goals between 0 and 99),
  assists smallint not null default 0 check (assists between 0 and 99),
  check (goals > 0 or assists > 0),
  check ((player_id is null) <> (guest_player_id is null))
)
create unique index match_report_stats_uniq on match_report_stats(report_id, team_id, coalesce(player_id, guest_player_id));
```

RLS: `match_reports` and `match_report_stats` SELECT for `is_group_member(match.group_id)`; no client INSERT/UPDATE/DELETE (writes go through RPCs). `match_mvp_votes`: add DELETE policy for own vote inside the window; INSERT window uses `results_window_days`. `match_ratings`: add UPDATE/DELETE for own rows inside the window.

| Function | Grant | Behaviour |
|---|---|---|
| `result_weight(p_group_id uuid, p_player_id uuid) returns numeric` | authenticated, service_role | `groups.settings->'result_weights'->>role`, defaults admin 1.5, captain 1.25, member 1.0. |
| `submit_match_report(p_match_id uuid, p_dark_score int, p_light_score int, p_dark_goals_complete boolean, p_light_goals_complete boolean, p_mvp_candidate_id uuid, p_stats jsonb) returns uuid` | authenticated | `p_stats` = `[{team_id, player_id|guest_player_id, goals, assists}]`. Checks: caller has a `confirmed` signup, match `finished`, `date_time > now() - results_window_days`, not a self MVP vote, report not empty (some score, or stats, or MVP), stats reference this match's teams. Upserts the report and replaces its stats; syncs `match_mvp_votes` (delete own, insert if candidate). If `result_status = 'locked'` -> store with `submitted_after_lock = true` and return without recomputing. Else calls `recompute_match_consensus`. Returns report id. Raises Spanish messages (`'No jugaste este partido'`, `'La ventana para reportar cerró'`, `'No podés votarte a vos mismo'`, `'El reporte está vacío'`). |
| `delete_my_match_report(p_match_id uuid) returns void` | authenticated | Deletes own report + MVP vote, recomputes unless locked. |
| `recompute_match_consensus(p_match_id uuid) returns void` | authenticated, service_role | §4 exactly. Ignores reports with `submitted_after_lock`, and reporters whose signup is no longer `confirmed`. Score pair by weighted plurality (ties: raw count, then highest single weight, then earliest). Scorers/assists: per (team, player-or-guest) weighted mode over the evidence set (reports mentioning them + reports with that team's `*_goals_complete`, counted as 0); tie -> higher count; support = weight agreeing. Reconcile per team against the consensus score: over -> drop least support; under -> unattributed goal events (`player_id` and `guest_player_id` null). Assists capped at team goals. Deletes `match_events where match_id = p and source = 'consensus'`, inserts the new ones with `source = 'consensus'`, sets `teams.score`, calls `recompute_match_mvp`, sets `result_status` (`pending` if no usable report; `consensus` when distinct reporters >= `least(3, ceil(confirmed_players / 3.0))` and winning pair weight >= 50% of total weight of reports with a score; else `provisional`). On `consensus`: `finalize_match_results`, then `post_match_result_if_changed(p, false)`: the first time the `dark-light|mvp` key is set it posts `results_posted` to the group; any later change of the key (more reports, unlock) only inserts in-app `results_changed` rows for the group admins (payload `{match_id, group_name, date_time, previous, current, previous_score, current_score, mvp_name}`, no outbox, deduped on the latest notice) and updates the key. No-op when locked. |
| `recompute_match_mvp(p_match_id)` | (existing) | Weighted: `sum(result_weight)` per candidate; ties: raw votes, then earliest vote. **No longer touches `mvp_count`** (stats recompute owns it). Still maintains `mvp_player_id` and the `mvp` badge. Not applied while `result_status = 'locked'` (admin's `mvp_player_id` wins). |
| `admin_set_match_result(p_match_id uuid, p_dark_score int, p_light_score int, p_events jsonb, p_mvp_player_id uuid) returns void` | authenticated (checks `is_group_admin_or_captain`) | Atomic replacement of the old client-side save. `p_events` = `[{team_id, player_id|guest_player_id|null, event_type 'goal'|'assist'|'own_goal', linked_index int|null}]`. Deletes all events of the match (both sources), inserts `p_events` with `source='admin'`, sets `teams.score` from `p_dark_score`/`p_light_score` (not from event count), sets `mvp_player_id`, `result_status='locked'`, `result_locked_by/at`, cancels pending `results_request`/`results_reminder` jobs, `finalize_match_results`, posts `results_posted` to the group if the key changed (`post_match_result_if_changed(p, true)`); inserts unattributed goal events for the part of each score the goal list does not cover, and rejects a list that exceeds the score. |
| `admin_unlock_match_result(p_match_id uuid) returns void` | authenticated (admin/captain) | Clears lock fields, deletes admin-source events, clears `submitted_after_lock` on reports, `recompute_match_consensus`. |

`results_posted` payload becomes `{match_id, dark_score, light_score, scorers: [{name, team, goals}], assisters: [{name, team, assists}], unattributed: {dark, light}, mvp_name, mvp_player_id, status: 'consensus'|'locked'}`.

Backfill in 00019: nothing (existing finished matches are already `locked` from 00018).

`src/types/database.ts`: add the new tables, columns and `Functions` entries. `npm run type-check` must pass.

Seed: add to `supabase/seed.sql` one `futbol-lunes` match in status `teams_created` with two teams and 14 confirmed signups, `date_time = now() - interval '3 hours'`, so `auto_finish` is due immediately on the first tick.

### 11.2 App: scheduler and notifications (track S1)

- `POST /api/cron/tick` (also GET), guarded by `CRON_SECRET`: loop `claim_due_jobs` -> `run_scheduled_job` until no rows, then `drainOutbox()`. Returns `{claimed, done, failed, outbox}`.
- `/api/cron/daily` calls the tick step first, keeping its existing steps.
- `scripts/ticker.ts` + `npm run ticker`: loop every `TICKER_INTERVAL_MS` (default 60000) POSTing `${NEXT_PUBLIC_APP_URL}/api/cron/tick` with the secret; logs one line per tick; exits non-zero only on config errors. `Dockerfile.ticker` (node:20-alpine, `tsx scripts/ticker.ts`). README section "Ticker".
- Opportunistic tick: in the dashboard layout server component, if `last tick > 60 s ago` (module-level timestamp, plus a cheap `select max(locked_at)` guard) fire the tick without awaiting (`@vercel/functions` `waitUntil` when available, else `void fetch(...)`). Must never delay a page render or throw.
- `src/lib/notifications/types.ts` + `templates.ts`: add `results_request`, `results_reminder`, `results_needs_review`, and the extended `results_posted` payload. Spanish copy, one WhatsApp message each; `results_posted` renders "Oscuro 4 – Claro 1", scorers with counts, "2 goles sin autor" when applicable, "MVP: X".
- `report_url` in payloads: prefix with `NEXT_PUBLIC_APP_URL` at render time when the stored value is relative.
- Notification list: render the three new types; show `results_reminder` only to users in `pending_player_ids`; link to the match page `#reportar`.
- Group settings `notification-settings.tsx`: fields for the four new `notification_settings` columns (duración por defecto, minutos hasta pedir el resultado, horas hasta el recordatorio con 0 = sin recordatorio, días de ventana).

### 11.3 App: player report UX (track S2)

- New `report-form.tsx` (client) on the match page under anchor `#reportar`, shown when status is `finished`, the viewer has a confirmed signup, and the window is open. Steps per §6: score (skippable), goals/assists chips per team with "estos fueron todos", MVP chips (self excluded). Submits via `submit_match_report`. Blind: the form never shows consensus data before the viewer's own report exists. After submitting: own report summary, "Editar" (reopens form pre-filled with own report), "Coincidís con N de M en el resultado", and the current consensus block.
- New `result-consensus.tsx`: the result block for every member: score with status pill (`Provisional` / `Consenso` / `Cerrado`; hidden when `pending` and the viewer can't report), reporters count "3 de 14 reportaron", scorers/assisters, "2 goles sin autor", MVP. Replaces `match-score-display.tsx` usage.
- `post-match-voting.tsx`: remove the MVP part (now in the report form); keep teammate ratings as an optional step below the report, with edit allowed inside the window.
- Dashboard nudge on `/groups`: "Cargá el resultado" for the most recent finished match the user played and hasn't reported.

### 11.4 App: admin tools and forms (track S3)

- `match-results.tsx` editor: save through `admin_set_match_result` (single RPC, no client-side deletes, no client-side `emit_notification`), prefilled from the current consensus when unlocked, button copy "Guardar y cerrar resultado". Score fields are editable independently of the goal list (unattributed goals allowed). When locked: "Reabrir" -> `admin_unlock_match_result`.
- New `match-reports-table.tsx` (admin/captain only): who reported what (score, scorers, assists, MVP), agreement with the consensus highlighted, reports `submitted_after_lock` flagged, timestamp. Data from `match_reports` + `match_report_stats` via the client (RLS allows select).
- Match create/edit forms: `duration_minutes` and `results_request_delay_minutes` fields ("Duración", "Pedir el resultado X min después del final"), defaults from `notification_settings`. `admin_set_match_status` to `finished` keeps working as an early exit.
- Group `settings-form.tsx`: weights editor writing `groups.settings.result_weights` (three numeric inputs, defaults shown).
- Match page `page.tsx`: minimal wiring of S2/S3 components; keep edits localised (S2 and S3 both touch this file, so each adds its block in one place and does not reshuffle existing code).

### 11.5 Verification per track

- SQL: psql against the local stack; each RPC exercised as `maxo@test.local` (admin), `juan@test.local` (captain) and a member via `set role authenticated` + `request.jwt.claims`; scenarios for §4 (2-1 vs three 4-1; partial scorers complementing; over-attribution trimming; window; lock).
- App: `npm run type-check`, `npm run lint`, `npm run build`; then `next dev -p 300x` against the stack and Playwright screenshots at 1366x768 of every touched screen, saved under the scratchpad and listed in the final report.
