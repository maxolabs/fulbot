# Product-completion review — 2026-09-25

Workflow: 6 aspect reviewers → triage → 4 fix tracks (worktrees) → merge → independent audit, then follow-ups (00031 guest cancel, 00032 edit guard, regenerated types, deploy doc, name validation). Branch `maxolabs/rework`, from 5f7f9df. Nothing pushed; migrations 00027–00032 are not on hosted Supabase (see docs/deploy.md).

## Aspect summaries

### onboarding
The happy path now works end to end: landing, register or login, invite link, join, then the group home. The 43-commit wave fixed the old onboarding blockers: open redirects, the lost ?redirect on register, rejoin by removed members, raw Supabase errors, html lang and cookie sync, and the check-inbox screen. What still stands between this and real users is mostly the email side of Supabase auth. Confirmation and reset links only work in the browser that asked for them (PKCE). There is no way to resend a confirmation email. Registering again with an existing email silently waits for a mail that never comes. The production Supabase Auth setup (SMTP, Site URL, redirect allow-list) is not documented anywhere, and without it no stranger can confirm an account. Past sign-up, the gaps are in the first-run and account lifecycle. New players are never asked for their position, which the team balancer relies on. Groups longer than 30 characters in name fail to create. There is no change password, delete account or leave group, and removing a member does not stop them because the same invite link brings them back. Remaining items are P3 polish: i18n on public pages, pasted invite links, and the sidebar name.

### groups
The Sep 10 blockers for groups are fixed on maxolabs/rework. 00024 closed self-insert as admin and the world-readable groups table, added a DB last-admin guard, made "Eliminar grupo" actually delete through a DELETE policy, and made join_group_via_invite idempotent and able to reactivate removed members. The player page now 404s for non-members, and the shell and group-cookie logic hold together. What still stands between this aspect and a shippable product is the membership lifecycle. A regular member has no way to leave a group. An admin can remove someone, but it doesn't stick: the invite code can never be rotated, and the same code is handed to any signed-in user who opens a match link, so the removed person rejoins in one tap. Removal also leaves their confirmed signups in place. Smaller gaps: the group time zone is fixed to Buenos Aires and nothing in the UI edits it; the "self" visibility setting for member scores is only enforced in the UI; the general settings form is still hardcoded in Spanish; and there are a few edge cases (slug "new", deleting a group leaves stale global stats).

### matches
The core weekly loop works and holds up under concurrency: creating a match, the recurring generator (00025 occurrences, per-pattern error isolation, time-zone check), signup/waitlist with locking and renumbering, guests, no-shows, the public /m page, and the manual transitions. The recheck's area C items #1, #3, #4, #5, #6, #11, #14, #15 and the anon guest cap are fixed. Four P1 gaps remain before real groups can rely on it. (1) Waitlist promotion and signup removal ignore match state, so a drop-out after teams are made, or an admin removal on a finished or cancelled match, silently promotes someone. The lineup goes stale and attendance drifts. (2) A match whose teams were never built in the app can never finish and keeps signups open after kickoff. (3) Nobody is told when a match is moved or a player drops. (4) Signup opening and auto-finish only happen on time if a minute-level ticker is actually deployed. Below that: direct matches UPDATE via RLS bypasses the state machine, the group time zone can't be set, and several match forms are still hardcoded Spanish.

### teams-scoring
Team generation is close to shippable. Automatic and manual saves both go through the atomic publish_match_teams RPC. The Sep 10 items D-1, D-5, D-9, D-14, D-15 and D-17 are fixed (00024 revokes save_team_assignments and adds a membership check to get_recent_match_history; f21e1a6 makes the GK minimum conditional and adds output language and a real regenerate). Without OPENAI_API_KEY the app falls back cleanly to the rule-based balancer and labels the result "Sin IA". The largest remaining gap is in the core weekly flow: once teams are published, players can still leave and waitlisters are still promoted, but the lineup is never updated or flagged. The teams screen silently drops the leaver, and the post-match report, MVP and clean-sheet logic keep using the stale lineup. The other gaps are privacy leaks around the admin-only scoring model: ai_input_snapshot now stores the full prompt, guest levels are shown to every member, member_score is readable over the API, and the AI analysis is shown to everyone. The rest is resilience (no OpenAI timeout), fallback goalkeeper quality, and Spanish-only rating vocabulary.

### postmatch-notifications
The post-match pipeline is solid: blind reports, weighted consensus, a settled MVP, the window anchored at finished_at (00026), and deduped results_posted/results_changed. On the notification side, 00026 gave the in-app list, the unread dot and mark-all a single visibility rule, device push has leases and staleness guards, and the WhatsApp outbox now claims atomically with an SSRF-safe webhook. The biggest thing left is operational. Every time-critical step (match reminders, push/WhatsApp delivery, recurring list opening, auto-finish, result requests) needs something to call /api/cron/tick. The only built-in drivers are a 12:00 UTC daily cron and signed-in page loads, so if no ticker runs and nobody opens the app in time, match reminders are silently lost, and nothing shows that the scheduler is down. The second gap is product shape: a match whose teams were never published can't be finished (not automatically, not by hand). It disappears from every list, and its attendance, no-shows and results are never recorded. The rest is polish: notification text is Spanish-only and partly wrong (the reminder always says "Hoy"), the report form and reports table are still hardcoded Spanish and use a native confirm(), nobody is told when a match's date or place changes, and the WhatsApp outbox has no staleness guard or backoff.

### platform-readiness
The 43-commit wave after the Sep 24 recheck fixed most of the platform security problems. The open membership, groups, badges and signup policies are closed (00024), the function grants are consistent, and every migration after 00013 revokes anon/PUBLIC. The cron routes check CRON_SECRET, the guest RPCs are capped and rate-limited, and es/en have the same 1055 keys with no missing keys in code. `npm run type-check` and `npm run lint` both pass; I did not run `npm run build`. What still blocks a real launch is platform plumbing, not features. There are no error or not-found pages, no account deletion and no privacy/terms pages. Nothing documents the Supabase production settings (redirect allow-list, custom SMTP), and migrations are applied by hand with no tracking or CI. The PKCE email links break when the link opens in a different browser, which is the normal case for an installed PWA. Smaller items: captains and admins can write match result columns directly, several core screens and the in-app notification text are still Spanish-only, and shared WhatsApp links have no Open Graph preview. I only checked migration ordering statically (enum split in 00006, realtime publication guarded in 00025, drops ordered correctly) and found no ordering error, but nothing proves a clean apply on a fresh database.

## Owner decisions (not implemented)

### OD-1 — Can a member removed by an admin rejoin with the invite link or an open /m link (GRP-2b, ONB-8)?
- Options: (a) Yes. Rotating the code (Track B) is the only way to keep them out. (b) No. Add group_memberships.removed_at/removed_by, have join_group_via_invite and get_match_join_info refuse admin-removed rows, and add an 'Ex miembros' list with 'Volver a agregar'.
- Recommendation: (b). Removal should stick. A self-leave (Track B's leave_group) stays rejoinable. This is a small follow-up on Track B's migration.

### OD-2 — What happens to the published lineup when a confirmed player drops out after teams_created (MATCH-1, TS-1)?
- Options: (a) The waitlist promotes, and the promoted player takes the leaver's team and position automatically. (b) No auto-promotion after teams_created. The organizer re-publishes. (c) Promote but leave the lineup alone, only flag it.
- Recommendation: (a) when someone is promoted. When nobody is, flag lineup_needs_review. Track C builds the flag, the banner and removing the leaver's assignment either way. The auto-swap goes in only once this is confirmed.

### OD-3 — How does a match finish when teams were never built in the app (MATCH-2, PM-2)?
- Options: (a) Allow signup_open/full/signup_closed -> finished as an attendance-only finish (no results or MVP flow) in auto_finish_match and admin_set_match_status. (b) Keep teams mandatory. After kickoff + duration, notify admins and show a '¿Se jugó?' card (build teams or cancel). (c) Auto-mark the match expired or cancelled.
- Recommendation: (a). Groups that only use the signup list still get attendance, no-shows and member scoring. Track C already rejects signups after kickoff, and Track D fixes the form hint.

### OD-4 — Which production driver calls /api/cron/tick every minute (MATCH-4, PM-1)?
- Options: (a) Supabase pg_cron + pg_net posting to /api/cron/tick with CRON_SECRET from Vault. (b) Vercel Pro per-minute cron in vercel.json. (c) An external cron (GitHub Actions, cron-job.org). (d) Host scripts/ticker.ts on a VPS.
- Recommendation: (a). No extra host and no paid plan. Track A adds /api/health so a dead ticker gets noticed, and documents the setup.

### OD-5 — Account deletion data-retention policy, and privacy/terms content (ONB-7, ONB-10, PLAT-2)
- Options: (a) Hard delete the auth user and anonymize player_profiles ('Jugador eliminado'), keeping match history. Delete push subscriptions and authored peer_ratings. Block deletion while the user is the last admin of a group with other members. (b) Full cascade delete, which removes the player from past lineups and stats. You also need to supply the privacy policy and terms text.
- Recommendation: (a). Once decided and the text exists: /privacy and /terms pages, links from the landing and register pages, and a 'Borrar mi cuenta' flow in /settings.

### OD-6 — ai_input_snapshot readability. This was already known, but its impact has grown: it now stores the full prompt, with ratings, skills and Compromiso (TS-2).
- Options: (a) Move it to an admin/captain-only table match_ai_snapshots written by publish_match_teams. (b) REVOKE the column and read it through a SECURITY DEFINER RPC. (c) Strip ratings, memberScore and the prompt before saving.
- Recommendation: (a), combined with (c) as defense in depth. Track C already hides the analysis card from members (TS-3).

### OD-7 — Captain powers beyond the spec: edit and cancel the match, change status and cap, add guests, remove signups (MATCH-11)
- Options: (a) Update the spec so captains are co-organizers. (b) Restrict those RPCs and screens to admins, leaving captains teams, rules and publish.
- Recommendation: (a). Groups usually rely on captains as co-organizers. Just document it.

### OD-8 — Do self-signup guests from the public /m link bypass member-scoring priority (MATCH-8)?
- Options: (a) Treat them like below-threshold members, i.e. waitlisted during the priority window or reserved period. (b) Keep them confirmed and document it.
- Recommendation: (a) while a priority policy is active.

### OD-9 — Per-group vs global stats and ratings. This was already known; it now also covers player_rating_summary feeding team balancing (TS-11) and stale global stats after a group is deleted (GRP-8).
- Options: (a) Per-group: add group_id to player_rating_summary and stats, and recompute on group delete. (b) Keep them global and recompute the affected players after delete_group.
- Recommendation: (a) for ratings used by the balancer. Skill seen in one group is a weak signal for another.

### OD-10 — Permanent group-level teaming rules in group settings (GRP-7)?
- Options: (a) Add a 'Reglas del grupo' card that reuses RulesManager with no matchId. (b) Keep rules per match only.
- Recommendation: (a). Cheap, and it fits weekly groups.

### OD-11 — Who gets notified when a confirmed player drops out (spec §4.4 says the whole group)?
- Options: (a) Admins and captains only, and only after teams_created or inside the late-cancel window. (b) The whole group, as the spec says.
- Recommendation: (a). Group-wide is noisy. Track D implements a lineup_changed notification to admins and captains, and widening the audience later is a one-line change.

### OD-12 — Migration tracking on hosted Supabase (PLAT-3)
- Options: (a) Run supabase init, run `supabase migration repair --status applied` for what is already on hosted, then deploy with `supabase db push`. (b) Keep applying by hand, with a checklist.
- Recommendation: (a). The repair step needs your hosted credentials. Track A adds config.toml and documents the steps.

## Fix tracks (implemented)

### auth-platform — Auth email flows, error pages, production setup and platform hardening (migration 00027)
- **ONB-1/PLAT-4** (P1) Confirmation and reset links fail on another browser, the PWA or the mail app (PKCE only), and a failure drops the invite redirect
- **ONB-2** (P1) No way to resend the confirmation email
- **PLAT-1** (P1) No not-found, error or global-error pages anywhere
- **PLAT-3/ONB-4** (P1) Production setup (Supabase Auth URLs, SMTP, templates, env, ticker) undocumented; no CI
- **PLAT-9** (P2) Missing NEXT_PUBLIC_APP_URL silently yields localhost invite and share links; Supabase env vars use non-null assertions
- **ONB-3** (P2) Registering an existing email shows 'Revisá tu correo' but no email arrives
- **PLAT-7** (P2) No scheduler health signal (dead ticker and failed jobs go unnoticed)
- **PLAT-8** (P2) Shared /m and /invite links have no Open Graph preview; public URLs are indexable
- **PLAT-10** (P3) No security headers (clickjacking on the public one-tap /m page)
- **PLAT-11/ONB-14** (P3) Names and texts have no length or blank checks server-side; the register name is not trimmed
- **ONB-12** (P3) 'Unirme con código' breaks on a pasted full link or an uppercase code
- **ONB-13** (P3) Sidebar shows the stale users.name after a profile rename

### groups-membership — Membership lifecycle, group time zone, and group settings/create polish (migration 00028)
- **GRP-1** (P1) Members cannot leave a group
- **GRP-2a** (P1) The invite code can never be rotated, so a leaked link cannot be revoked
- **GRP-3** (P1) Group time zone fixed to Buenos Aires; no UI sets it
- **GRP-4** (P2) Removing a member leaves their confirmed and waitlist signups on upcoming matches
- **GRP-6** (P2) Group general settings form is hardcoded Spanish, and the weight validation doesn't match its message
- **ONB-5** (P2) Group names longer than 30 characters fail to create (auto-slug not truncated); generic 400; untranslated 401
- **GRP-9** (P3) Slug 'new' is accepted but makes the group unreachable
- **ONB-6** (P2) New players are never asked for position or GK willingness, so the balancer treats everyone as CM

### match-lifecycle-teams — Match state guards, roster changes after teams, column privileges, teams privacy and balancer robustness (migration 00029)
- **MATCH-1/TS-1** (P1) Waitlist promotion and signup removal ignore match status; the lineup goes stale after teams_created
- **MATCH-2 (non-decision part)** (P1) Signups are still accepted by the RPCs after kickoff
- **MATCH-5/PLAT-5** (P2) Admins and captains can write any matches column and match_events directly, bypassing the state machine and consensus
- **TS-3** (P2) AI reasoning and warnings, written from private ratings and Compromiso, are shown to all members
- **GRP-5/TS-5** (P2) member_score and its breakdown are readable by every member through the API, even with visibility 'self'
- **TS-4** (P2) Guest estimated level is shown to every member, and admins cannot edit it
- **TS-6** (P2) OpenAI call has no timeout or retry budget, so the fallback may never run
- **TS-7** (P2) The fallback puts the best-rated player in goal when nobody is GK-willing; peer can_keep and goalkeeping data are ignored
- **MATCH-9** (P3) Native confirm() for leaving a match, and generic signup errors with no refresh
- **MATCH-10/PM-8** (P3) Match status and result changes are not live on open match pages
- **TS-9** (P3) Prompt includes absent players' raw UUIDs and a hardcoded '7-a-side'; min_defenders stays hard even when it can't be met
- **TS-10** (P3) Manual builder publishes with no GK or pair-rule warnings

### notifications-i18n — Notification content and new types, outbox robustness, and remaining Spanish-only screens (migration 00030)
- **PM-6/MATCH-3** (P1) No notification when an announced match changes date, time or location; a rescheduled match gets no new reminder
- **MATCH-1/TS-1 (notification part)** (P1) Admins are not told when a confirmed player drops out after teams are published
- **PM-3** (P2) In-app notification text is Spanish-only, and waitlist_promoted speaks to the recipient in the third person
- **PM-4** (P2) match_reminder always says 'Hoy' and mentions shirts even when the match is tomorrow or has no teams
- **PM-5** (P2) Report form and reports table are hardcoded Spanish; report deletion uses native confirm(); raw RPC errors are shown
- **MATCH-7** (P2) Create-match, add-guest, announcement and edit-hint screens are hardcoded Spanish; dates always formatted es-AR
- **TS-8** (P2) Rating vocabulary (dimensions, hints, scale, tags) is Spanish-only; stray literals on the rate screen
- **PM-7** (P3) The WhatsApp outbox sends stale match messages late and retries with no backoff
- **ONB-7 (password part)** (P3) No way to change password while signed in

## Dropped findings

- **ONB-8**: Duplicate of GRP-1 (leave group) and GRP-2 (rotate the code; rejoin blocking is OD-1).
- **ONB-9**: Duplicate of GRP-3 (group time zone), which is in Track B.
- **MATCH-6**: Duplicate of GRP-3, which is in Track B.
- **ONB-10**: Merged into OD-5 (privacy/terms need your content).
- **PLAT-2**: Owner decision OD-5 (data retention and legal text).
- **ONB-7**: Account deletion and email change go to OD-5. Only the 'Cambiar contraseña' row is kept (Track D).
- **PLAT-4**: Duplicate of ONB-1, merged in Track A.
- **ONB-4**: Merged into PLAT-3 (production setup docs) in Track A.
- **TS-5**: Duplicate of GRP-5, which is in Track C.
- **PLAT-5**: Duplicate of MATCH-5, merged in Track C. The teams/team_assignments part is already a known owner decision.
- **PM-8**: Duplicate of MATCH-10, merged in Track C.
- **PLAT-6**: Split into its specific items: GRP-6 (Track B), MATCH-7, PM-3 and PM-5 (Track D), MATCH-9 (Track C).
- **MATCH-3**: Duplicate of PM-6 (match_updated) in Track D. The drop-out audience is OD-11.
- **PM-1**: Driver choice is OD-4. The health endpoint is kept in Track A (PLAT-7).
- **MATCH-4**: Duplicate of PM-1, see OD-4.
- **PM-2**: Duplicate of MATCH-2. Finish semantics are OD-3; the non-decision parts are in Track C.
- **TS-2**: Known owner decision (ai_input_snapshot), see OD-6.
- **TS-11**: Known owner decision on per-group vs global stats, see OD-9.
- **GRP-8**: Depends on the per-group stats decision, see OD-9.
- **GRP-7**: Product decision, see OD-10.
- **MATCH-8**: Product decision, see OD-8.
- **MATCH-11**: Product decision, see OD-7.
- **ONB-11**: P3 polish (language toggle on public pages). Low value next to the i18n items already in the tracks.
- **GRP-10**: P3 cosmetic: fixes itself on reload. Deferred to keep tracks sized.
- **PLAT-12**: P3: only admins and captains can call it. Deferred; OpenAI cost is capped by TS-6's timeout and retry budget.
- **PLAT-7 (Sentry part)**: Needs a third-party account. Only the health endpoint and the ticker warning are kept.

## Independent audit (after merge, before follow-ups)

**Audit of maxolabs/rework, 5f7f9df..428d7fc (4 merges, 24 fix commits, migrations 00027–00030)**

Summary: 40 of the 41 planned items are fixed in the code. MATCH-5/PLAT-5 is partial. I found no regressions from the merges. I checked each item by reading the migrations, the new and changed routes and components, and the i18n files. I did not run the app or apply anything to a database, and made no changes.

Boundary and cross-cutting checks, all clean:
- **i18n:** es.json and en.json have the same 1366 keys. Every literal `t('…')` key in `src` exists in both. No `tú` forms turned up in the new Spanish strings.
- **No `dark:` classes or raw colour classes** were added.
- **Client/server boundary:** nothing 'use client' is imported wrongly. The leave-group row and the stale-lineup notice are client components rendered from server pages. `signupErrorKey` is only imported by client files.
- **Hydration:** the new date formatting in templates, OG metadata and reminders passes a `timeZone`. The new-group page reads the browser's time zone after mount.
- **Column privileges on `group_memberships`:** all 24 selects in `src` use only the granted columns (`id, group_id, player_id, role, is_active, joined_at`) or embeds. A scan of the migrations found no non-SECURITY DEFINER function that updates `matches` or reads the score columns.

## Per-item verdicts

### auth-platform

| Item | Verdict | Evidence |
|---|---|---|
| ONB-1/PLAT-4 | fixed (needs ops) | `api/auth/confirm` verifies with `verifyOtp({type, token_hash})` and also accepts `?code=`. `resolveNext` unwraps the nested callback `next` and always passes through `safeRedirect`. `failureUrl` keeps the invite target, and for a reset link it uses the inner redirect. The templates link to `/api/auth/confirm`. It only works on another device once the owner pastes those templates into Supabase. |
| ONB-2 | fixed | `resend-confirmation.tsx`: 60 s cooldown, restarts on a 429, uses the outline button (not the cone). It appears in the register inbox screen, the login error for an unconfirmed email, and after a failed confirmation link. |
| ONB-3 | fixed | `identities.length === 0` shows a 'Ya tenés cuenta' screen with login and recover links that keep `?redirect`. |
| PLAT-1 | fixed | `not-found.tsx`, `global-error.tsx` (own html/body), and error boundaries for the dashboard, `/m` and `/invite`. They share `ErrorScreen`. Minor: global-error always renders dark and without the font variables. |
| PLAT-3/ONB-4 | fixed, but the doc is out of date | `docs/deploy.md`, `supabase/config.toml` and the CI workflow exist. deploy.md only covers migrations up to 00027 (gap 2). |
| PLAT-9 | fixed | `resolveAppUrl` falls back to the Vercel domain. `env.ts` uses zod/mini. `next.config.mjs` fails the build under CI, VERCEL or FULBOT_STRICT_ENV. CI sets placeholder env vars. |
| ONB-3 (email in use) | fixed | Covered above. |
| PLAT-7 | fixed | `/api/health` returns 200 or 503. It uses the right columns (`scheduler_state.last_tick_at`, `scheduled_jobs.updated_at`). The ticker prints a WARN line per failure. |
| PLAT-8 | fixed | `generateMetadata` on `/m` and `/invite` uses React `cache()` and robots noindex/nofollow. The edge OG image shows no names or ratings. `metadataBase` is set in the root layout. |
| PLAT-10 | fixed | Headers on `/:path*`: frame-ancestors 'none', X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy. |
| PLAT-11/ONB-14 | fixed (small UX gap) | 00027 cleans existing rows, then adds the CHECK constraints; `handle_new_user` trims and clamps the name. The register form trims and validates. The profile form and the group settings form don't trim, so a blank name hits the constraint and shows the generic save error. |
| ONB-12 | fixed | `normalizeInviteCode` drops query and hash, takes the last path segment, lowercases it and encodes it. |
| ONB-13 | fixed | The layout selects `display_name` and falls back to `users.name`. |

### groups-membership

| Item | Verdict | Evidence |
|---|---|---|
| GRP-1 | fixed | `leave_group`: locks the group, refuses the last admin, cancels upcoming signups before deactivating (so notifications still pass the membership check). `LeaveGroupRow` confirms in a Sheet. |
| GRP-2a | fixed | `regenerate_invite_code` is admin-only and retries on a collision. The settings card is admin-only. |
| GRP-3 | fixed | Time zone trigger validates against `pg_timezone_names`. `create_group_with_admin` gains `p_timezone`; the old 6-argument version is dropped and the grants are restated. `TimezoneSelect` is shared by the three forms. |
| GRP-4 | fixed | `admin_remove_member` deactivates the member, then runs `admin_remove_signup` on each upcoming signup (promotion runs; the caller is an admin, so notifications pass). |
| GRP-6 | fixed | The settings form uses `useT`. The weight check is `MIN_WEIGHT..MAX_WEIGHT`, matching the message. |
| ONB-5 | fixed | Slug capped at 30 with hyphens trimmed. Errors are per field, and 23505, 23514 and 22023 are mapped. The 401 is translated. |
| GRP-9 | fixed | `RESERVED_SLUGS` in both the client and the API, plus a `groups_slug_not_reserved` CHECK after renaming any existing slug 'new'. |
| ONB-6 | fixed | `profile_completed_at` with a backfill. Profile save sets it. The group home shows a prompt row with a dismiss server action, and stays hidden if the column is missing. |

### match-lifecycle-teams

| Item | Verdict | Evidence |
|---|---|---|
| MATCH-1/TS-1 | fixed | Trigger `trg_match_signups_sync_lineup` removes the leaver's team slot and sets the review flag. `publish_match_teams` clears it. `promote_from_waitlist` stops on draft, finished and cancelled matches. The three cancel RPCs lock the match and refuse finished or cancelled ones. The stale-lineup notice shows on the match and teams pages. |
| MATCH-2 (non-decision part) | fixed | Both signup RPCs raise 'El partido ya empezó' once `now() >= date_time`. The error is mapped in the UI. |
| MATCH-5/PLAT-5 | **partial** | Status, results, MVP and the AI snapshot are now locked down. The INSERT policy is limited to draft/signup_open, and the direct `match_events` policies are dropped. But `date_time` and `location` are still directly writable in any status, including finished, cancelled or after kickoff, and the edit page has no status guard. |
| TS-3 | fixed | The teams page sends reasoning, warnings, balance score and provider only to admins and captains. The prompt forbids quoting ratings, skills or Compromiso. |
| GRP-5/TS-5 | fixed | Table-level SELECT revoked and only the public columns granted. `get_member_scores` applies the visibility rule. All readers now use it. |
| TS-4 | fixed | The page strips `estimated_rating` for members, and the list hides it. New admin/captain RPC `admin_set_guest_rating`. The level is still readable through RLS (owner decision). |
| TS-6 | fixed | 15 s per request, `maxRetries: 0`, 25 s total deadline, then the fallback. `maxDuration = 60`. |
| TS-7 | fixed | `gkScore` counts willingness, the can_keep tag and peer goalkeeping. Ties go to the lower-rated player, so the best player is no longer put in goal by default. |
| MATCH-9 | fixed | Two-tap leave button, Sheets for the public page and score events, and mapped errors that refresh the page. `match-admin-actions` already confirms inline (the self-report's "still uses confirm()" is wrong; `src` has no `confirm()` left). |
| MATCH-10/PM-8 | fixed | `matches` added to the realtime publication; the wrapper subscribes to its UPDATEs. |
| TS-9 | fixed | `rulesForPlayers` drops rules for absent players. The '7-a-side' text is gone. `defendersPolicy` makes min_defenders soft when it can't be met. |
| TS-10 | fixed | `lineupWarnings` (no keeper, several keepers, broken pairs) shows as a non-blocking line in the builder. |

### notifications-i18n

| Item | Verdict | Evidence |
|---|---|---|
| PM-6/MATCH-3 | fixed | `matches_notify_updated` sends `match_updated`. The audience and push handling cover it. Reminders are deduped per `payload.date_time` in both SQL and `reminders.ts`, so a rescheduled match gets a new reminder. |
| MATCH-1/TS-1 (notification part) | fixed | Deferred trigger sends `lineup_changed` to admins and captains, skipping the person acting and anyone who left. It inserts directly, so an anonymous guest's cancel is not rejected. |
| PM-3 | fixed | `templates.ts` reads `ui.notifications.*` in the viewer's language. `waitlist_promoted` is second person in the app. WhatsApp stays Spanish (no group language). |
| PM-4 | fixed | Says Hoy, Mañana or the weekday in the group's time zone, adds the location, and mentions shirts only when teams exist. |
| PM-5 | fixed | Report form and reports table translated. Deletion uses a Sheet; RPC errors are mapped. Minor: the reports table formats dates in the browser's time zone, not the group's. |
| MATCH-7 | fixed | The create, edit-hint, add-guest and announcement screens are translated. The date formatters take a locale. |
| TS-8 | fixed | `ui.ratings.*` keys and helpers in `lib/ratings.ts`. |
| PM-7 | fixed | New `available_at` column with backoff (2, 4, 8, 16 min, capped at 60). Stale rows are marked 'skipped' before claiming (there is no CHECK constraint on outbox status, so 'skipped' is safe). |
| ONB-7 (password part) | fixed | The Account card links to `/update-password?redirect=/settings`, which is protected by the middleware. It doesn't ask for the current password, and `secure_password_change` is false in config. |

## Remaining gaps, most important first

1. **High, existed before this wave: a guest cannot free a spot when someone is on the waitlist.** `cancel_guest_signup` runs as anon and calls `promote_from_waitlist`, which calls `emit_notification('waitlist_promoted')`. The membership check in the 00030 version of `emit_notification` raises 'No sos miembro de este grupo' for a caller whose role claim is 'anon', so the whole cancel rolls back. This is a reading of the code, not a test. Fix: skip the membership check when the call comes from a trusted SECURITY DEFINER path (for example, have `promote_from_waitlist` insert the notification directly), or add an internal variant of `emit_notification` with no auth check.
2. **High, deploy: the code depends on 00027–00030 being applied first.** Without them: create group fails (no `p_timezone`), profile save fails (no `profile_completed_at`), leave, remove and invite-link rotation fail, and scores quietly disappear (`get_member_scores` missing). `docs/deploy.md` stops at 00027 and has no check queries for 00028–00030 and no ordering note. Also, `src/types/database.ts` was not regenerated: the code works around the new RPCs and columns with casts, and `group_memberships.Row` still lists `member_score` and the other revoked columns, so a future select of them would type-check and then fail with a permission error.
3. **Medium: leaving or being removed skips matches that already have teams.** `leave_group` and `admin_remove_member` leave out `teams_created` matches, so a removed member stays confirmed in a published lineup. The 00029 trigger now handles teams_created leavers cleanly, so these could include that status (ties to OD-2).
4. **Medium: MATCH-5 is partial.** Direct `date_time` and `location` edits are not limited by status; add a status guard in the edit page and a trigger or policy check.
5. **Low: blank names get a generic error.** The profile and group settings forms don't trim or check the name before saving.
6. **Low: `/api/health` will always report degraded** for a deployment that picks the documented "no ticker, daily cron only" option.
7. **Low: the "open it on any device" copy depends on the templates.** It is only true once they are pasted; with the default PKCE template it still fails on another device.
8. **Low: small leftovers.** Unused i18n keys remain (`checkInboxBody`, `resetSent`, `matches.confirmCancelSignup`). The reports table uses the browser's time zone. `global-error` ignores the theme and fonts. `guest_players.display_name` has no length limit in the database.
9. **Low: leaving or removal counts as a cancellation.** Both go through the normal cancel paths, which record early or late cancel events that affect the member score.

## Decisions for the owner
- `team_assignments` direct-write policies (00003).
- `ai_input_snapshot` readable by every member through RLS.
- Per-group vs global stats.
- Guest identity, and `guest_players.estimated_rating` still readable through RLS.
- Product name ("fulbot" is hardcoded in metadata and the OG image).
- Which email template language to paste: Supabase takes one template per email type.
- Whether groups get a language for WhatsApp messages (today always Spanish).
- Whether leaving or removal should count as an early or late cancel.
- OD-1: block removed members from rejoining.
- OD-2: put the promoted player in the leaver's team slot.
- OD-3: finish semantics for matches without teams.
- OD-5: email change and account deletion.

## Follow-ups after the audit
- Audit gap 1 (guest cancel with waitlist): reproduced on local DB, fixed in 00031.
- Gap 2: types regenerated (`database.generated.ts`), deploy.md covers 00027–00032.
- Gap 4 (MATCH-5): 00032 edit guard + notice on the edit page.
- Gap 5: names trimmed/validated with a translated message.
- Gap 8: unused keys removed; reports and locked-at times in the group time zone.
- Badge rendered as span (div-in-p hydration warning).
- Still open: gap 3 (leave/remove skips teams_created matches — ties to OD-2), gap 6/7 (health without ticker, templates), gap 9 (leave counts as cancellation), global-error theme.
