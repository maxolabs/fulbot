# Member scoring ("Compromiso")

Design proposal, 2026-09-10. Revised 2026-09-11 on top of main after PR #1
(peer ratings, 00018) and PR #2 (crowd-sourced results and scheduler,
00019/00020). No code yet.

## 1. What it is, and what it is not

A **member score** measures how good someone is *as a member of the group*:
shows up when they say they will, cancels with notice, arrives on time, wears the
right color, pays, and does their part after the match (reports the result,
rates teammates, rates a newcomer). It is completely independent of the player
rating (`player_rating_summary.overall`, how good they are *on the pitch*). A
5/5 player can be a 2/5 member and vice versa.

The score exists to let the admin turn on group policies that reward reliable
members, mainly **priority when a match fills up**. It is not a punishment tool
and it should never feel like one: it must be explainable, recoverable and
private by default.

### Why not reuse `player_profiles.reliability_score`

Today's `reliability_score` (00004, still refreshed from
`recompute_player_stats` in 00019) has four structural problems:

| Problem | Effect |
|---|---|
| Global per player, not per group | One group's no-shows leak into another group's ranking |
| Only decreases, never recovers | Two no-shows in 2024 still cost 30% in 2026 |
| New players start at 1.00 (perfect) | Newcomers outrank veterans with one late cancel |
| Only two inputs (late cancel, no-show) | No punctuality, jersey, payment, participation |

The member score replaces it. `reliability_score` is dropped once the UI
(profile, players list, player page) and `team-generator.ts` read the new
field, the same way 00018 dropped `overall_rating`.

## 2. Core model: events, not scores

Store **what happened**, derive the score. Every input is a row in
`member_events`; the score is a cached aggregate that can be recomputed from
scratch at any time. This gives auditability ("why am I at 3.2?"), reversibility
(admin deletes a wrong event), and tunability (change weights, recompute).

```sql
CREATE TYPE member_event_type AS ENUM (
  -- attendance (system)
  'attended',            -- confirmed when the match finished
  'no_show',             -- admin marked did_not_show
  'late_cancel',         -- cancelled inside the notice window
  'early_cancel',        -- cancelled with notice; neutral, logged for the breakdown
  -- conduct (admin / captain checklist)
  'arrived_late',
  'wrong_jersey',
  'unpaid',              -- reversed by 'paid'
  'paid',
  -- participation (system, from PR #1 and PR #2 data)
  'reported_result',     -- submit_match_report, not after lock
  'rated_teammates',     -- at least one match_ratings row for the match
  'voted_mvp',           -- match_mvp_votes row for the match
  'rated_new_member',    -- peer_ratings row (rated or skipped) for a newcomer
  -- social / manual
  'peer_kudos',          -- structured positive tag from a teammate (v3)
  'admin_adjustment'     -- manual +/- with mandatory note
);
CREATE TYPE member_event_source AS ENUM ('system', 'admin', 'peer');

CREATE TABLE member_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id      UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES player_profiles(id) ON DELETE CASCADE,
  match_id      UUID REFERENCES matches(id) ON DELETE CASCADE,   -- NULL for admin_adjustment / rated_new_member
  subject_id    UUID REFERENCES player_profiles(id) ON DELETE CASCADE, -- rated_new_member: who was rated
  type          member_event_type NOT NULL,
  points        SMALLINT NOT NULL,          -- weight snapshot at insert time
  source        member_event_source NOT NULL,
  reported_by   UUID REFERENCES player_profiles(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (group_id, player_id, match_id, subject_id, type, reported_by)
);

ALTER TABLE group_memberships
  ADD COLUMN member_score      DECIMAL(3,2),   -- 1.00..5.00, NULL = not enough history
  ADD COLUMN member_breakdown  JSONB,          -- per-dimension sub-scores + counts
  ADD COLUMN member_score_at   TIMESTAMPTZ,
  ADD COLUMN signup_cooldown   BOOLEAN NOT NULL DEFAULT FALSE;  -- §5.2

ALTER TABLE matches
  ADD COLUMN signup_opened_at  TIMESTAMPTZ;    -- set by trigger on status -> signup_open (§5.1)
```

Score lives on `group_memberships`, not `player_profiles`: it is a property of
the (player, group) pair. Guests have no membership and therefore no score.

### Config lives in `groups.settings->'member_scoring'`

`groups.settings` already hosts `result_weights` (00020); this is its second
tenant.

```jsonc
{
  "enabled": false,
  "window_matches": 10,          // only the group's last N finished matches count
  "late_cancel_hours": 6,        // today hardcoded in update_player_reliability
  "min_matches_for_score": 3,    // below this the member is "nuevo" (neutral)
  "weights": {
    "attended": 2, "no_show": -15, "late_cancel": -6, "arrived_late": -3,
    "wrong_jersey": -2, "unpaid": -5,
    "reported_result": 1, "rated_teammates": 1, "voted_mvp": 1, "rated_new_member": 1,
    "peer_kudos": 1
  },
  "dimensions": {                // weights of the sub-scores in the overall
    "asistencia": 0.40, "aviso": 0.20, "puntualidad": 0.15, "reglas": 0.10, "participacion": 0.15
  },
  "visibility": "self",          // self | group   (admins and captains always see everything)
  "priority": {
    "mode": "off",               // off | window | waitlist | reserved
    "threshold": 3.0,
    "window_hours": 24,
    "reserved_spots": 4
  },
  "no_show_cooldown": false,     // next signup after a no_show goes to waitlist
  "captains_can_report": true
}
```

Weights are defaults per group and are snapshotted into `member_events.points`
at insert time. The dimensions below are ratios, so `points` only drives
`admin_adjustment` and the raw-points view in the breakdown; the snapshot is
kept so a later "points mode" or a weight change does not rewrite history.

## 3. Scoring

### Dimensions

Each dimension is a 0..1 ratio over the rolling window, then the overall is the
weighted mean mapped to 1..5. Sub-scores are what the member sees; the single
number is what policies use.

| Dimension | Ratio over window | Events |
|---|---|---|
| Asistencia | played / (played + no_shows) | `attended`, `no_show` |
| Aviso | early_cancels / (early + late cancels), 1.0 if no cancels | `early_cancel`, `late_cancel` |
| Puntualidad | on time / played | `arrived_late` |
| Reglas | matches without jersey/payment flags / played | `wrong_jersey`, `unpaid`/`paid` |
| Participación | matches with any participation event / played matches whose results window has closed (§3.1) | `reported_result`, `rated_teammates`, `voted_mvp`, `rated_new_member` |

`overall = 1 + 4 * Σ(dimension_weight * ratio)`. With defaults, one no-show in a
10-match window costs roughly 0.2 stars; three cost ~0.6. A late cancel costs
less than a no-show, and an early cancel costs nothing. That gradient is the
point: the behavior we want is "avisá temprano", not "nunca te bajes".

`admin_adjustment` events are added as raw points after the mapping, clamped to
[1,5], and always shown separately in the breakdown with their note.

### 3.1 Participación: the post-match civic duty

PR #2 turned "did you do your part after the match" into concrete, timestamped
data. Every one of these is already written by an existing RPC or table, so the
member score only has to listen:

| Action | Source of truth | When it counts |
|---|---|---|
| Reported the result | `match_reports` via `submit_match_report` | `submitted_after_lock = false` and reporter still confirmed (same rule as `usable_match_reports`) |
| Rated teammates | `match_ratings` (per match, ratings-only voting) | at least one row for the match inside `match_report_window_open` |
| Voted MVP | `match_mvp_votes` | one row inside the window |
| Rated a newcomer | `peer_ratings` (00018), rated **or skipped** | within 14 days of the `rate_new_member` notification |

A match counts as "participated" if the member did **any** of the first three.
Reporting the score and rating players are different efforts, so the breakdown
shows them separately ("reportaste 7/10, puntuaste 4/10"), but the ratio does
not punish someone for skipping the MVP vote when they already reported.

**Denominator.** A played match enters the denominator only once its results
window has closed (`date_time + results_window_days < now()`, the same moment
`run_results_window_close_job` fires) **or** the member already participated.
So participation gives immediate positive feedback ("gracias, +compromiso"),
and non-participation only costs once the window is actually over. No extra
job is needed: `recompute_member_score` derives the denominator from
`matches.date_time` and `notification_settings.results_window_days`.

**Newcomer ratings.** Each `rate_new_member` notification is one opportunity
for every other active member. It adds one item to the Participación ratio if
the join happened within the time span of the current window. Skipping counts
as participating: "no lo conozco" is an honest answer, silence is not.

**Optional tier (not in v1).** Reports submitted before the `results_reminder`
fires could earn an extra point ("reportó sin que le recuerden"). Cheap to add
later because `scheduled_jobs.run_at` for the reminder is known per match.

**Not doing:** feeding the member score back into `result_weight` so reliable
members' reports weigh more in the consensus. It is tempting, but it makes two
systems circular and the consensus harder to explain. Role weights stay as they
are.

### Rolling window instead of decay

Use the **group's last N finished matches** (default 10) rather than calendar
time or exponential decay. Groups play on a weekly cadence, so 10 matches is
about two and a half months; a member who fixes their behavior is clean again
after ten matches. This is simple to explain ("solo cuentan los últimos 10
partidos") and a member can see exactly when a bad event drops off. Matches the
member did not sign up for are neutral: they neither help nor hurt.

### Newcomers

A member with fewer than `min_matches_for_score` played matches in the window
has `member_score = NULL` and is shown as "Nuevo". For policies, NULL is
treated as `threshold` (qualifies for priority). Newcomers should not be
penalised for having no history, and they also should not outrank a veteran
with a 4.8. Ties in priority ordering fall back to signup time.

### Recompute

`recompute_member_score(p_group_id, p_player_id)`, `SECURITY DEFINER`,
idempotent, reads `member_events` joined to the last N finished matches of the
group and writes the membership columns. Called from:

- `recompute_player_stats` (00019), which `finalize_match_results` already
  runs for every involved player: emit `attended` for confirmed and `no_show`
  for did_not_show, then recompute. This replaces the
  `update_player_reliability` call on line 485 of 00019.
- `auto_finish_match` / `admin_set_match_status` to `finished`: emit
  `attended` right away so the score does not wait for results consensus.
- `cancel_my_signup` / `admin_remove_signup`: emit `late_cancel` or
  `early_cancel` from `late_cancel_hours` and recompute immediately, so the
  member sees the consequence at once, not a week later.
- `admin_set_signup_status` when switching to/from `did_not_show`: swap
  `attended` ↔ `no_show`.
- `submit_match_report` / `delete_my_match_report`: insert/delete
  `reported_result`.
- New AFTER triggers on `match_ratings` and `match_mvp_votes` (00018 already
  has `match_ratings_recompute` for the player rating; add a sibling for the
  member event), and on `peer_ratings` for `rated_new_member`.
- The conduct-check RPC (§4.2) and the admin adjustment RPC.
- A one-off backfill migration that derives attendance, cancel and
  participation events from existing `match_signups`, `match_reports`,
  `match_ratings`, `match_mvp_votes` and `peer_ratings`, so groups do not start
  from zero.

## 4. Inputs

### 4.1 System events (free)

Attendance, cancels and all four participation events come from data the app
already has. This alone makes v1 useful with zero extra admin work.

### 4.2 Conduct check (admin / captain, per match)

The manual dimensions (punctuality, jersey, payment) need a human. Add a
**conduct check** to the finished-match page, in the admin block next to the
results editor and the no-show marking (`match-admin-actions.tsx`,
`match-reports-table.tsx`): one row per confirmed player, all defaults "todo
bien", with three toggles: 🕐 llegó tarde, 👕 camiseta equivocada, 💸 no pagó.
One tap per exception, save once. Admins and (if enabled) captains can fill
it; anyone with the role can correct it later. Each toggle upserts or deletes
one `member_events` row keyed by the unique constraint.

The whole check should take under a minute for 14 players. If it takes longer,
admins will not do it and the manual dimensions silently become "everyone is
perfect", which is fine: the score degrades gracefully to attendance and
participation only.

Reminder: the admin already gets `results_reminder` / `results_needs_review`
from the scheduler. The conduct check rides on those (the admin's reminder
payload links to both), rather than adding a fourth timed job per match.

### 4.3 Peer input (v3, positive only)

Peers can give one **structured kudos tag** per match ("puntual", "trajo la
pelota", "buena onda"), never negatives. Negative peer reporting is an abuse
vector in a friend group; positive-only kudos still gives members a visible way
to help each other's score. Cap at +1 per receiver per match regardless of how
many kudos they get.

### 4.4 Admin adjustment

`admin_adjust_member_score(group_id, player_id, points, note)` with a mandatory
note, logged as an event. This is the escape hatch for anything the model does
not capture, and the dispute path ("me marcaron tarde pero avisé").

## 5. Policies the admin can enable

All off by default. Each one is one setting and one place in the code.

### 5.1 Priority signup (`priority.mode`)

Three shapes, strongest recommendation first:

**`window` (recommended default when enabled).** When signup opens, members
with `member_score >= threshold` (or NULL / newcomers) can take confirmed
spots. Everyone else can still sign up but lands on the waitlist. When
`window_hours` elapse, the waitlist is promoted in normal order until the match
is full. Nobody is ever bumped after being confirmed, so it feels fair, and
below-threshold members do not have to come back later: they sign up once and
get promoted automatically if there is room.

Implementation, now that PR #2 shipped a job queue:

- `matches.signup_opened_at`, set by a BEFORE trigger on `status → signup_open`
  (same pattern as `trg_matches_set_finished_at`). Recurring matches get it
  when `generate_recurring_matches` opens them.
- `signup_for_match` checks `now() < signup_opened_at + window_hours` and the
  caller's `member_score`; below threshold means `status = 'waitlist'` even if
  there is room, with a distinct reason returned so the UI can explain it.
- A new `scheduled_jobs.job_type = 'priority_window_close'` scheduled by
  `schedule_match_jobs` at `signup_opened_at + window_hours` when the mode is
  `window`; its handler calls `promote_from_waitlist` until full and emits the
  existing `waitlist_promoted` notification. Extend the `job_type` CHECK and
  add the branch in `run_scheduled_job`. The ticker, the daily cron floor and
  the opportunistic tick on dashboard traffic (00019 §scheduler_state) all
  drive it, so a player opening the match page after the window is enough for
  promotion to happen even with no ticker running.

**`waitlist`.** Signup stays first-come-first-served, but when a confirmed
player cancels, `promote_from_waitlist` picks the highest-scored waitlisted
member instead of the earliest. Cheap to build (one ORDER BY change), but it
makes waitlist position unpredictable, which people hate ("estaba primero en la
lista y me saltearon").

**`reserved`.** `reserved_spots` of `max_players` are held for above-threshold
members until `window_hours` before kickoff. Same effect as `window` but framed
around the match time instead of the open time; useful for groups where signups
open a week ahead. Same job, different `run_at`.

Do **not** build "bump": displacing a confirmed low-score member when a
high-score member arrives late. It is the one variant that creates real
resentment and it is what people fear when they hear "scoring".

### 5.2 No-show cooldown (`no_show_cooldown`)

After a `no_show`, the member's next signup in this group goes to the waitlist
regardless of space, once. This is the rule most real groups already enforce
verbally ("el que falta sin avisar la próxima va al final"). Implementation:
`group_memberships.signup_cooldown` set by the `no_show` event, consumed and
cleared by the next `signup_for_match`.

### 5.3 Team generator input

Replace `reliabilityScore` in `team-generator.ts` with the member score. It is
already in the prompt; this just makes it mean something.

### 5.4 Visibility and recognition (`visibility`)

Default `self`: every member sees their own score, breakdown and event log;
admins and captains see everyone's (same rule 00018 chose for player ratings).
`group` makes the score visible on the players list and player page for all
members. Rankings by conduct in a friend group can turn toxic, so this stays
opt-in.

Positive recognition is separate from visibility and is always on: an
"Ejemplar" badge (score ≥ 4.5 with ≥ 10 matches) through the existing
`player_badges` / `award_badges_for_match` path, next to `ironman`.

### 5.5 Nudges

In-app `notifications` rows inserted directly (never through
`emit_notification`, so nothing reaches the WhatsApp outbox; same choice as
`rate_new_member`):

- `member_score_dropped` when a member crosses below `threshold`: "Tu
  compromiso bajó a 2.8. Contás 2 bajas tarde en los últimos 10 partidos. Con
  3 partidos seguidos a tiempo recuperás la prioridad." The message must always
  say how to recover.
- `member_score_recovered` when they regain it.
- Participation feedback is already covered by `results_request` /
  `results_reminder`; the report form's success state adds "+1 compromiso" so
  the loop closes on the spot.

## 6. UI touchpoints

| Where | What |
|---|---|
| Group settings (`settings/`) | New `member-scoring-settings.tsx` card: enable, window, thresholds, priority mode, visibility, cooldown, weights under "Avanzado" |
| Finished match page | Conduct check (§4.2) in the admin block beside `match-reports-table.tsx` |
| Report form (`report-form.tsx`) | "+1 compromiso" in the success state |
| Player page (`players/[playerId]`) | Replace the reliability % with the star score, five dimension bars (participation split into reported / rated), and the event log for the window. Admin: adjust button |
| Players list (`players/`) | Score column when visibility is `group` or viewer is admin/captain |
| Profile (`profile/`) | Per-group score list instead of the single global reliability bar |
| Match page signup box (`signup-actions.tsx`) | During a priority window, below-threshold members see "Inscripción prioritaria hasta las 21:00. Te anotás en lista de espera y pasás automáticamente si queda lugar." |
| Public match page (`/m/[matchId]`) | Same message for logged-in members; guests unaffected |

## 7. Fairness rules baked in

- **Explainable**: every point traces to an event with a date, a match and who
  reported it. No black-box number.
- **Recoverable**: rolling window means nothing is permanent.
- **Notice is rewarded, not just absence punished**: early cancel costs zero.
- **Doing your part is rewarded before not doing it is punished**:
  participation counts the moment it happens, non-participation only after the
  window closes.
- **Private by default**, positive recognition public.
- **Never bump a confirmed player.**
- **Newcomers are neutral**, never top or bottom.
- **Only admins/captains can report negatives**; peers only positives.
- **Guests are outside the system**: they sign up through admins anyway.

## 8. Phasing

**v1 (core, no policies).** Migration 00021 with `member_events`, membership
columns, settings shape, `recompute_member_score`, system events wired into
`recompute_player_stats` / finish / cancel / set-status / `submit_match_report`
/ rating and vote triggers, backfill, conduct check UI, score + breakdown on
player page, settings card with enable/window/visibility. Replace
`reliability_score` reads and drop the column. Groups get a meaningful score
after this alone.

**v2 (policies).** `priority.mode = window` with `signup_opened_at` and the
`priority_window_close` job, no-show cooldown, signup-box messaging, threshold
nudges.

**v3 (social).** Peer kudos, "Ejemplar" badge, `reserved` and `waitlist`
modes, the "reported before the reminder" tier, payment tracking if it turns
out to be wanted as a real feature rather than a flag.

## 9. Open decisions

1. **Payment**: is "no pagó" a conduct flag, or does the group want actual
   payment tracking (who owes what)? The flag is cheap; tracking is its own
   feature. Proposal: flag only in v1.
2. **Captains reporting**: default on or off? Proposal: on, since captains
   already exist as a trusted role and admins are usually one person.
3. **Default weights and dimension weights**: the numbers above are a first
   guess; they should be validated against one real group's history via the
   backfill before committing. Participación at 0.15 is deliberately the
   second-largest after Asistencia because it is the cheapest behavior to
   change and the one the results feature depends on.
4. **Default priority mode when the admin enables it**: `window` proposed.
5. **`late_cancel_hours`**: 6h today; many groups would say "el día anterior".
   Per group setting either way.
6. **Newcomer rating deadline**: 14 days proposed for `rated_new_member`.
7. **Fate of `reliability_score`**: drop the column (proposed, mirrors
   00018's drop of `overall_rating`), or keep it as a view over the new score.

## 10. Implementation contract (agents build against this; names are final)

Decisions taken 2026-09-11 to unblock implementation: payment is a flag only;
captains can report by default; weights and dimension weights as in §2;
priority default mode `window`; `late_cancel_hours` 6 by default; newcomer
rating deadline 14 days; `reliability_score` is dropped. Scope is v1 + v2 plus
the `waitlist` and `reserved` modes and the "Ejemplar" badge; peer kudos, the
"before the reminder" tier and payment tracking stay out.

Local stack for verification (this branch has its own, do not touch
`fulbot-mr`): Supabase API `http://127.0.0.1:56621`, Postgres
`postgresql://postgres:postgres@127.0.0.1:56622/postgres`, Studio
`http://127.0.0.1:56623`, project id `fulbot-ms`. Config lives in the
scratchpad `stack/` directory whose `supabase/migrations` and `seed.sql` are
symlinks into this worktree; app env for `next dev` is `stack/app.env`. Seed
accounts all use password `password123`; `maxo@test.local` is admin of
`futbol-lunes`, `juan@test.local` its captain, `nico@test.local` admin of
`futbol-jueves`. Only track M0 may run `supabase db reset`; every other track
treats the database as read-mostly shared state.

### 10.1 Migration `00021_member_scoring.sql` (track M0)

Schema exactly as §2, with these additions and precisions:

- `member_events.match_id` is NOT NULL except for `admin_adjustment` and
  `rated_new_member` (CHECK). `subject_id` is NOT NULL only for
  `rated_new_member` (CHECK).
- RLS: SELECT for the row's own `player_id`, and for admins/captains of the
  group (`is_group_admin_or_captain`). No client INSERT/UPDATE/DELETE; all
  writes go through SECURITY DEFINER functions.
- `group_memberships.member_score`, `member_breakdown`, `member_score_at`,
  `signup_cooldown` as §2. Breakdown JSON shape (all numbers, ratios 0..1):
  ```jsonc
  { "window_matches": 10, "played": 8, "is_new": false,
    "asistencia":    { "ratio": 0.89, "played": 8, "no_shows": 1 },
    "aviso":         { "ratio": 1.0,  "early": 2, "late": 0 },
    "puntualidad":   { "ratio": 0.88, "late_arrivals": 1 },
    "reglas":        { "ratio": 1.0,  "wrong_jersey": 0, "unpaid": 0 },
    "participacion": { "ratio": 0.6, "eligible": 5, "participated": 3,
                       "reported": 3, "rated": 1, "voted_mvp": 2,
                       "newcomers_eligible": 1, "newcomers_rated": 1 },
    "adjustments": -1, "raw_points": 14 }
  ```
- `matches.signup_opened_at`, set by BEFORE trigger `matches_set_signup_opened_at`
  when status becomes `signup_open` and the column is NULL.
- `scheduled_jobs.job_type` CHECK gains `'priority_window_close'`.
  `schedule_match_jobs` schedules it for matches in `signup_open` when the
  group's `member_scoring.enabled` and `priority.mode IN ('window','reserved')`:
  `run_at = signup_opened_at + window_hours` for `window`,
  `date_time - window_hours` for `reserved`. `run_scheduled_job` dispatches to
  `run_priority_window_close_job(p_match_id)`, which promotes from the waitlist
  in `(waitlist_position, signup_time)` order until the match is full (reusing
  `promote_from_waitlist`) and lets the existing `waitlist_promoted`
  notifications fire.
- Settings reader `member_scoring_settings(p_group_id) RETURNS JSONB`: merges
  `groups.settings->'member_scoring'` over the §2 defaults so every consumer
  reads one shape. `STABLE SECURITY DEFINER`.
- `recompute_member_score(p_group_id UUID, p_player_id UUID) RETURNS void`
  as §3. Window = the group's last `window_matches` matches with
  `status = 'finished'` ordered by `date_time DESC`. Participación denominator
  as §3.1 (window closed: `date_time + results_window_days < now()`, with
  `results_window_days` from `notification_settings`, default 7). Newcomer
  opportunities: `rate_new_member` notifications of the group created within
  `[oldest window match date_time, now()]` whose `payload->>'player_id'` is not
  the member themself; rated if a `peer_ratings` row (skipped or not) by the
  member for that player exists within 14 days of the notification.
  `min_matches_for_score` → `member_score = NULL`, `is_new = true`. Writes
  `member_score_dropped` / `member_score_recovered` in-app notifications
  (direct INSERT into `notifications`, `recipient_player_id` = the member,
  payload `{ group_id, group_name, score, previous_score, threshold, breakdown }`)
  when the score crosses `priority.threshold` in either direction and scoring
  is enabled.
- `recompute_group_member_scores(p_group_id UUID)` loops active memberships.
- Event emitters (all `SECURITY DEFINER`, all idempotent through the UNIQUE
  constraint, all ending in `recompute_member_score` for the affected member):
  - `emit_attendance_events(p_match_id)`: `attended` for every confirmed
    registered signup, `no_show` for `did_not_show`; deletes the opposite
    event if present. Called from `auto_finish_match`, from
    `admin_set_match_status` when the new status is `finished`, and from
    `recompute_player_stats` in place of `update_player_reliability`.
  - `admin_set_signup_status` (00007, redefine): after the update, when the
    match is finished, call `emit_attendance_events(match_id)`.
  - `cancel_my_signup` and `admin_remove_signup` (redefine): if the signup was
    `confirmed` or `waitlist` and the match is not finished/cancelled, insert
    `late_cancel` when `now() > date_time - late_cancel_hours`, else
    `early_cancel`. Guest signups emit nothing.
  - `submit_match_report` / `delete_my_match_report` (00020, redefine): insert
    `reported_result` when the report is usable (`submitted_after_lock = false`);
    delete it on report deletion.
  - Trigger `member_events_from_match_ratings` AFTER INSERT/DELETE on
    `match_ratings`: `rated_teammates` exists iff the voter has ≥1 row for the
    match.
  - Trigger `member_events_from_mvp_votes` AFTER INSERT/DELETE on
    `match_mvp_votes`: `voted_mvp`.
  - Trigger `member_events_from_peer_ratings` AFTER INSERT on `peer_ratings`:
    `rated_new_member` with `subject_id = rated_player_id`, only when a
    `rate_new_member` notification for that subject exists in the group within
    the last 14 days.
  - `no_show` event sets `group_memberships.signup_cooldown = true` when
    `no_show_cooldown` is enabled.
- Admin RPCs (`is_group_admin_or_captain` unless noted, honoring
  `captains_can_report`):
  - `set_conduct_flag(p_match_id UUID, p_player_id UUID, p_type member_event_type, p_on BOOLEAN)`
    for `arrived_late`, `wrong_jersey`, `unpaid`. Match must be finished,
    player must have a confirmed signup. `p_on = false` deletes the row.
    `unpaid` off also deletes any `paid`; there is no separate `paid` toggle in
    the UI, the enum value is kept for the backfill/ledger only.
  - `admin_adjust_member_score(p_group_id UUID, p_player_id UUID, p_points SMALLINT, p_note TEXT)`,
    admin only, note required, `p_points` in [-20, 20].
  - `admin_delete_member_event(p_event_id UUID)`, admin only, for disputes;
    recomputes.
  - `admin_recompute_member_scores(p_group_id UUID)`, admin only.
- `signup_for_match` (00007, redefine) reads `member_scoring_settings`:
  - if `signup_cooldown` is true: force `waitlist`, clear the flag, and set
    `match_signups.notes` untouched; return the signup with a new OUT-style
    column? No: keep the return type `public.match_signups` and add a column
    `match_signups.waitlist_reason TEXT` with values `full | priority_window |
    reserved | cooldown | NULL`, set on insert and cleared on promotion.
  - `window` mode: while `now() < signup_opened_at + window_hours` and the
    caller's `member_score` is not NULL and `< threshold`, force `waitlist`
    with reason `priority_window`.
  - `reserved` mode: while `now() < date_time - window_hours`, a below-threshold
    caller may only take confirmed spots beyond `max_players - reserved_spots`;
    otherwise `waitlist` with reason `reserved`.
  - `waitlist` mode: `promote_from_waitlist` orders by
    `COALESCE(member_score, threshold) DESC, waitlist_position, signup_time`
    when this mode is active for the group; unchanged otherwise.
- `award_badges_for_match`: add `ejemplar` badge for members with
  `member_score >= 4.5` and `played >= 10` in the current breakdown, revoked
  when the condition no longer holds (same pattern as hat_trick).
- Drop `player_profiles.reliability_score` and `update_player_reliability`.
- Backfill at the end of the migration: attendance and cancel events from
  `match_signups` × finished matches (late/early from `cancel_time` and the
  group's `late_cancel_hours` default 6), participation from `match_reports`,
  `match_ratings`, `match_mvp_votes`, `rated_new_member` from `peer_ratings` ×
  `rate_new_member` notifications; then `recompute_group_member_scores` for
  every group. Backfilled rows use `source = 'system'`.
- Grants: follow 00013 (REVOKE from PUBLIC, GRANT to `authenticated`; job
  functions to `service_role` only).
- Update `src/types/database.ts` (tables, enums, new RPCs, new columns) and
  `supabase/seed.sql`: enable scoring for `futbol-lunes` with `priority.mode =
  'window'` and mark one no-show, one late cancel, two late arrivals and one
  wrong jersey across the finished matches so the UI has something to show.
  Remove every `reliability_score` reference in seed and types.
- Verification: `supabase db reset` on the branch stack succeeds; a psql
  script in the scratchpad exercises every RPC as `maxo@test.local` (admin),
  `juan@test.local` (captain) and a plain member through `set_config('request.jwt.claims', ...)`
  or `SET ROLE authenticated`, asserts RLS on `member_events`, checks the
  breakdown for a seeded member by hand, and runs `run_scheduled_job` on a
  `priority_window_close` row. `npm run type-check` passes.

### 10.2 App: settings and admin tools (track M1)

- `src/app/(dashboard)/groups/[groupSlug]/settings/member-scoring-settings.tsx`
  (client) rendered from `settings/page.tsx` below the results weights:
  toggle enabled; `window_matches`, `late_cancel_hours`,
  `min_matches_for_score`; visibility radio; priority mode radio with
  `threshold`, `window_hours`, `reserved_spots` (only for `reserved`);
  `no_show_cooldown`; `captains_can_report`; a collapsed "Avanzado" block with
  the per-event weights and the five dimension weights (must sum to 1, show
  the sum). Save = merge into `groups.settings.member_scoring` exactly like
  `settings-form.tsx` does for `result_weights`, then call
  `admin_recompute_member_scores`.
- Conduct check: `src/app/(dashboard)/groups/[groupSlug]/matches/[matchId]/conduct-check.tsx`
  (client), rendered by `page.tsx` in the admin block for finished matches
  when scoring is enabled, visible to admins and (if `captains_can_report`)
  captains. One row per confirmed registered player with three toggles
  (🕐 Llegó tarde, 👕 Camiseta, 💸 No pagó) bound to existing `member_events`;
  each toggle calls `set_conduct_flag` immediately (optimistic, revert on
  error). Guests are listed greyed out with "invitado, sin puntaje".
- Admin adjustment: on the player page (M2 owns the page; M1 owns the
  component `member-score-adjust.tsx` exporting a button + dialog with points
  and note, calling `admin_adjust_member_score`). Coordinate through the
  contract: M2 renders `<MemberScoreAdjust groupId playerId />` when the
  viewer is admin.
- i18n: add keys under `memberScoring.*` to both `es.json` and `en.json`.
- Verify with screenshots at 1366×768 and 400px: settings card (both states),
  conduct check with two flags on, adjust dialog.

### 10.3 App: score display and replacing reliability (track M2)

- `src/components/member-score.tsx`: `MemberScoreStars` (1..5 with one
  decimal, "Nuevo" when NULL) and `MemberScoreBreakdown` (five bars from
  `member_breakdown`, participation split into reported / rated / MVP /
  newcomers, adjustments line, raw points).
- Player page `players/[playerId]/page.tsx`: replace the reliability % with
  the stars + breakdown + event log (last window, from `member_events`, with
  date, match, type, points, reporter, note) when the viewer may see it
  (`visibility = 'group'`, or viewer is admin/captain, or viewer is the
  player). Render `<MemberScoreAdjust>` from M1 for admins.
- Players list `players/page.tsx`: score column under the same visibility
  rule; sortable.
- Profile `profile/page.tsx`: per-group list "Compromiso en <grupo>: ★4.2"
  replacing the reliability bar.
- Team generator `route.ts` + `team-generator.ts`: `reliabilityScore` →
  `memberScore` (1..5, NULL → 3.5) from the membership; prompt text
  "Compromiso".
- Report form `report-form.tsx`: success state shows "+1 compromiso" when
  scoring is enabled for the group.
- Remove every remaining `reliability_score` read. i18n keys under
  `memberScore.*`.
- Verify with screenshots: player page as admin and as a plain member with
  `visibility = 'self'` (must not see others' scores), players list, profile.

### 10.4 App: signup flow and notifications (track M3)

- `signup-actions.tsx` and the public `/m/[matchId]` page: read the match's
  `signup_opened_at`, the group's `member_scoring_settings` (new RPC call from
  the server component) and the viewer's membership score; when the viewer
  would be forced to the waitlist show the explanatory copy from §6 with the
  actual window end time (group timezone, formatted client-side to avoid the
  hydration mismatch noted in `docs/rework-plan.md`). After signup, read
  `waitlist_reason` and show the matching message ("Estás en lista de espera
  por la ventana prioritaria / por tu ausencia en el último partido / porque
  el partido está lleno").
- `signup-list.tsx`: waitlist rows show a small tag with the reason for
  admins/captains.
- Notifications: add `member_score_dropped` and `member_score_recovered` to
  `src/lib/notifications/types.ts`, `templates.ts` and
  `notification-list.tsx` (in-app only; deep link to the player's own page).
  Add `priority_window_close` nothing to render (it reuses `waitlist_promoted`).
- Match form (`matches/new`, `edit`): nothing new; `signup_opened_at` is set
  by the trigger.
- Verify with screenshots: match page as a below-threshold member during a
  window (use the seed's `futbol-lunes` open match and set a low score through
  `admin_adjust_member_score`), as an above-threshold member, and the
  notifications page showing the two new types.

### 10.5 Audit (track M4, after merge)

Independent agent against §§2–6 and 10.1–10.4 on the merged branch: runs
`npm run type-check`, `npm run lint`, `npm run build`, `supabase db reset`
on the branch stack, boots `next dev` with `stack/app.env`, and captures every
screen listed above as a logged-in admin and as a plain member, reading the
PNGs, not the JSX. Reports gaps as a list with file and line.
