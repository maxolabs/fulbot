# fulbot rework plan (Sep 2026)

Source spec: `init-prompt.md` (root). This document is the **shared contract** for the
rework tracks. Every track must follow the conventions in §1 and the contracts in §2
exactly; other tracks depend on them.

Product decisions taken by the owner (2026-09-05):

1. **One-time guests can sign up from the public match link** with just a name, no account.
2. **Only admins** can add or remove guests from inside the app.
3. **"Close signups" is a real state** (`signup_closed`): the list freezes but stays visible.

Verification available on this machine: `npm run type-check`, `npm run lint`,
`npm run build`. There is **no local Postgres** (no Docker). Migrations cannot be
executed here, so write them defensively (idempotent where possible, `IF NOT EXISTS`,
`CREATE OR REPLACE`) and review them by reading.

---

## 1. Conventions for every track

- **Stack**: Next.js 14 App Router, TypeScript, Supabase (`@supabase/ssr`), Tailwind,
  `lucide-react`, `@dnd-kit`. Do not add dependencies unless listed for your track.
- **UI language**: Spanish (Rioplatense, "vos" form, e.g. "Inscribite", "Bajarme").
  Mobile-first. Reuse `src/components/ui/*` primitives.
- **Types**: every new table, column, enum value, or RPC you add MUST be reflected in
  `src/types/database.ts` (Row/Insert/Update, Enums, Functions). New code must NOT use
  `(supabase as any)`; use the typed client. You may leave existing `as any` casts
  in files you don't otherwise rewrite.
- **Server vs client**: reads and simple member writes may stay in client components
  through RLS. Anything that needs elevated rights (cron, notifications fan-out,
  anonymous guest signup) goes through a SECURITY DEFINER SQL function or a route
  handler using the service-role client (`src/lib/supabase/admin.ts`, see §2.7).
- **Migrations**: one or two files per track, with the number assigned in §3. Never
  renumber. `ALTER TYPE ... ADD VALUE` must live alone in its own file (Postgres
  forbids using a new enum value in the same transaction).
- **Match status enum** (after this rework):
  `draft | signup_open | signup_closed | full | teams_created | finished | cancelled`.
  Transitions: draft → signup_open ⇄ signup_closed; signup_open ⇄ full (automatic on
  count); any of signup_open/full/signup_closed → teams_created; teams_created →
  finished; any non-finished → cancelled.
- **Public signup URL** stays `/m/[matchId]`.
- **Env vars** (document any new one in `.env.local.example`):
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL` (default
  `gpt-4o-mini`), `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`.
- **Process hygiene**: never start detached/background processes (no `&`, no
  `nohup`, no `next dev` left running). Run checks in the foreground.
- **Before reporting done**: `npm run type-check && npm run lint && npm run build`
  must all pass in your worktree. Commit everything on your branch with a clear message.
  Your final report must list files changed, migrations added, and anything you could
  not finish.

---

## 2. Shared contracts

### 2.1 Signup RPCs (track T1 owns; T4/T5 extend)

All SECURITY DEFINER, all derive the acting player from `auth.uid()`; never trust a
caller-supplied player id for self actions.

```sql
-- member self-service
signup_for_match(p_match_id uuid, p_notes text default null, p_position_preference text default null)
  returns match_signups   -- raises if not a member, match not open, or already signed up
cancel_my_signup(p_match_id uuid) returns void   -- promotes waitlist via promote_from_waitlist

-- admin/captain (checks is_group_admin_or_captain on the match's group)
admin_add_guest_signup(p_match_id uuid, p_display_name text, p_notes text default null) returns match_signups
admin_remove_signup(p_signup_id uuid) returns void        -- works for players and guests; promotes waitlist
admin_set_signup_status(p_signup_id uuid, p_status signup_status) returns void  -- used for did_not_show (T4)
admin_set_match_status(p_match_id uuid, p_status match_status) returns matches  -- validates transitions in §1

-- anonymous public link (callable by anon role)
get_public_match(p_match_id uuid) returns jsonb
  -- { id, group_name, group_slug, date_time, location, notes, status, max_players,
  --   confirmed_count, waitlist_count, confirmed_names: text[], waitlist_names: text[] }
public_guest_signup(p_match_id uuid, p_display_name text, p_token uuid) returns jsonb
  -- creates guest_players row (group_id from match, self_signup_token = p_token) + signup
  -- (confirmed or waitlist). Rejects if match not signup_open/full, name blank, or a guest
  -- with the same token already has an active signup on this match.
  -- returns { signup_id, status, waitlist_position }
cancel_guest_signup(p_match_id uuid, p_token uuid) returns void

-- internal helper, reused by T4/T5
promote_from_waitlist(p_match_id uuid) returns uuid  -- promoted signup id or null;
  -- reorders waitlist positions; sets match status full/signup_open accordingly
```

Schema additions (T1): `guest_players.self_signup_token uuid unique null`;
`match_status` gets `signup_closed`. Old `process_match_signup` and
`cancel_match_signup` are dropped.

Logged-in users who are not members of the group see a single "Unirme al grupo e
inscribirme" action on the public page (join via the group's invite code with
`join_group_via_invite`, then `signup_for_match`).

The public page stores the guest token in a cookie `fulbot_guest_<matchId>` (httpOnly,
1 year) set by a route handler `POST /api/matches/[matchId]/guest-signup`, which is the
only caller of `public_guest_signup`. Cancel goes through `DELETE` on the same route.

### 2.2 Rules data shape (track T2 owns)

`rule_sets.data` canonical shapes:

```json
{ "player_ids": ["<uuid>", "<uuid>"] }   // avoid_pair, force_pair
{ "min_count": 1 }                       // min_defenders, min_goalkeepers
```

T2 migrates existing rows (`player_id_a`/`player_id_b` → `player_ids`) and makes the
rules manager, the generate route, and the generator read/write only these shapes.

### 2.3 AI team generation (track T2 owns)

- Provider stays OpenAI (`OPENAI_API_KEY`, `OPENAI_MODEL`). Use JSON mode
  (`response_format: { type: 'json_object' }`) and validate the response with zod.
- Hard-constraint validation after every response: every confirmed player assigned
  exactly once, team sizes differ by at most 1, avoid_pair never on the same team,
  force_pair always on the same team, each team has ≥1 player with
  `goalkeeper_willingness >= 1` when the min_goalkeepers rule exists (default 1).
  On violation retry once with the violations listed; if still invalid, fall back to
  the deterministic balancer.
- Deterministic fallback `src/lib/ai/fallback-balancer.ts`: greedy snake draft by rating
  honoring the same hard constraints. Also used when `OPENAI_API_KEY` is missing.
- Rotation: call `get_recent_match_history(group_id, 5)` and pass teammate-pair counts
  so the model rotates combinations.
- `matches.ai_input_snapshot` stores `{ input, output, provider, model, generatedAt }`
  with the full payload sent and received.
- Team generation sets match status to `teams_created` (a direct update in the route
  is fine in wave 1; T1's `admin_set_match_status` lands in the same wave).
- Manual editing (`draggable-teams.tsx`): must support guests (keep
  `player_id`/`guest_player_id` pairs), allow changing a player's position with a
  select, and persist positions. Save replaces assignments atomically via RPC
  `save_team_assignments(p_match_id uuid, p_assignments jsonb)`.

### 2.4 Recurring matches (track T3 owns)

Table `recurring_patterns`:
`id, group_id, weekday smallint (0=Sun), match_time time, location text, max_players
smallint, signup_opens_weekday smallint, signup_opens_time time, timezone text,
is_active bool, created_by_user_id, created_at, updated_at`.
`matches.recurring_pattern_id` references it.

SQL `generate_recurring_matches(p_group_id uuid default null) returns integer`
(SECURITY DEFINER): for each active pattern, if the next occurrence's signup-open moment
(in the pattern's timezone) is in the past and no match exists for that pattern at that
occurrence datetime, insert the match with status `signup_open` and emit the
`match_created` notification (§2.6). Idempotent. Compute the timezone math in SQL
(`AT TIME ZONE`), not in JS.

Triggers to run it: (a) `GET /api/cron/recurring` guarded by
`Authorization: Bearer ${CRON_SECRET}`, registered in `vercel.json` daily at 12:00 UTC
(Vercel Hobby allows one daily cron with ±59 min drift; document this), and (b) lazily
from the group page server component (call the RPC for that group before rendering, so
the Monday match appears even if the cron drifted).

UI: recurring pattern editor in group settings; a `MatchAnnouncement` component on the
match page and right after creation with the announcement text (date, time, location,
spots, signup link, "remera oscura/clara según tu equipo") plus Copy and a `wa.me`
share button.

### 2.5 Post-match (track T4 owns)

- `matches.mvp_player_id uuid null`. SQL `recompute_match_mvp(p_match_id)` picks the
  top-voted candidate (tie → earliest vote) and updates `mvp_player_id` and
  `player_profiles.mvp_count` idempotently (decrement the previous holder, increment the
  new one). A trigger on `match_mvp_votes` (insert/delete) calls it. `finalize_match_results`
  no longer increments `mvp_count` directly.
- Voting window: votes are accepted while status is `finished` and
  `date_time > now() - interval '7 days'` (enforce in RLS/RPC).
- No-shows: admin UI on a finished match to mark confirmed players `did_not_show`
  (through `admin_set_signup_status`). `update_player_reliability` already counts them.
- Badges: SQL `award_badges_for_match(p_match_id)` called at the end of
  `finalize_match_results`: `hat_trick` (≥3 goals), `playmaker` (≥2 assists),
  `safe_hands` (GK with clean sheet), `mvp` (from `mvp_player_id`, awarded by the MVP
  trigger instead), `ironman` (10 consecutive finished matches of the group attended).
  Use the existing `player_badges` table; `UNIQUE(player_id, badge_type, match_id)` makes it
  idempotent. Show badges on the profile page (already exists) and as small icons in
  `signup-list.tsx`.
- Dashboard nudge: on `/groups` show "Votá el MVP" for the most recent finished match
  the user played and hasn't voted in.

### 2.6 Notifications (track T5 owns)

Tables:

```sql
notifications (id, group_id, match_id null, recipient_player_id null,  -- null = whole group
  type text, payload jsonb, read_at timestamptz null, created_at)
notification_outbox (id, group_id, match_id null, type text, payload jsonb,
  channel text, -- 'whatsapp_webhook'
  status text default 'pending', -- pending | sent | failed
  attempts int default 0, last_error text, created_at, sent_at)
```

SQL `emit_notification(p_group_id uuid, p_match_id uuid, p_type text, p_payload jsonb)`
(SECURITY DEFINER): inserts an in-app row honoring `notification_settings` toggles and,
when `whatsapp_webhook_url` is set, an outbox row. Types: `match_created`,
`waitlist_promoted`, `teams_created`, `match_reminder`, `results_posted`.

T5 also: replaces `promote_from_waitlist`'s body to emit `waitlist_promoted` (CREATE OR
REPLACE, same signature), and makes the generate route emit `teams_created`.

TypeScript: `src/lib/notifications/` with `types.ts` (event union), `templates.ts`
(Spanish message text per type, used for WhatsApp/outbox), `channels/whatsapp-webhook.ts`
(POST JSON `{ text, event }`), `dispatch.ts` (drain outbox, service-role client).
Routes: `GET /api/cron/notifications` (drain outbox) and `GET /api/cron/reminders`
(emit `match_reminder` for matches starting within `reminder_hours_before`), both
guarded by `CRON_SECRET` and added to `vercel.json`.
UI: bell icon with unread count in the header, `/notifications` page listing the
user's group notifications, mark-as-read.

### 2.7 Settings, i18n, edit match (track T6 owns)

- `src/lib/supabase/admin.ts`: service-role client factory (server only).
- `/settings` page: language (`users.preferred_language`), theme (`light | dark |
  system`, stored in cookie `fulbot_theme`, applied to `<html class>` by the root layout
  server-side; default stays dark), per-user notification prefs
  (`users.notification_prefs jsonb default '{}'`).
- i18n: a `LanguageProvider` + `useT()` client hook and `getT()` server helper on top of
  the existing `src/i18n/*.json`. Migrate these surfaces fully: header, landing page,
  login/register, `/groups` list, `/settings`, match page header/status labels,
  signup actions. Add keys as needed to both JSON files. Leave the rest Spanish and list
  what remains in your report.
- `/groups/[groupSlug]/matches/[matchId]/edit`: form for date, time, location,
  max_players, notes (admin/captain only), using the group timezone for the datetime.
- Dashboard: each group card on `/groups` shows the next upcoming match (date + count)
  linking to it.

---

## 3. Tracks, waves, and migration numbers

| Track | Scope | Migrations | Wave |
|-------|-------|------------|------|
| T1 signup | §2.1, public page rewrite, close-signups state, admin remove/guest UI | `00006_signup_closed_enum.sql`, `00007_signup_flow.sql` | 1 |
| T2 ai-teams | §2.2, §2.3 | `00008_rules_shape_and_assignments.sql` | 1 |
| T6 settings | §2.7 | `00009_user_settings.sql` | 1 |
| T3 recurring | §2.4 | `00010_recurring_matches.sql` | 2 |
| T4 post-match | §2.5 | `00011_post_match.sql` | 2 |
| T5 notifications | §2.6 | `00012_notifications.sql` | 2 |

Wave 2 starts from `main` after wave 1 is merged, so T3/T4/T5 can rely on T1's RPCs
and T6's admin client.

Files likely touched by several tracks (expect merge care):
`src/types/database.ts`, `src/app/(dashboard)/groups/[groupSlug]/matches/[matchId]/page.tsx`,
`match-admin-actions.tsx`, `src/components/layout/header.tsx`, `.env.local.example`,
`vercel.json`.
