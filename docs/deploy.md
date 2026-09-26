# Deploying fulbot

Production setup for a hosted Supabase project and Vercel. Local
development is in the [README](../README.md); the local Supabase stack reads
`supabase/config.toml`, which mirrors the auth settings below.

Checklist, in order:

1. [Supabase: database and migrations](#1-database-and-migrations)
2. [Supabase: Auth](#2-supabase-auth) (URLs, confirm email, SMTP, templates, rate limits)
3. [Vercel: environment variables](#3-vercel-environment-variables)
4. [Scheduler: pick a ticker](#4-scheduler)
5. [Monitoring](#5-monitoring)
6. [Smoke test](#6-smoke-test)

---

## 1. Database and migrations

Migrations live in `supabase/migrations` (`00001_…` to `00027_…`) and must
run in order. Each file is written to be re-runnable, but none is meant to be
skipped.

### Tracking what has been applied

Until now migrations were pasted by hand into the SQL editor, so nothing
records which ones the hosted database has. Pick one way and stick to it.

**A. Supabase CLI (recommended).** The CLI keeps a table
(`supabase_migrations.schema_migrations`) of applied versions; the version of
`00027_text_limits.sql` is `00027`.

```bash
supabase login
supabase link --project-ref <project-ref>

# One time: mark the migrations that were already applied by hand.
# Check first with a query from the list below if you are unsure.
supabase migration repair --status applied 00001 00002 00003 ... 00026

supabase migration list   # local vs remote: every row must match
supabase db push          # applies only what is missing (e.g. 00027)
```

After that, `supabase db push` is the only way migrations reach production.

**B. By hand.** Keep pasting files into the SQL editor (or
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/000NN_….sql`),
and record each one in a table so the next person knows where you stopped:

```sql
create table if not exists public._applied_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
insert into public._applied_migrations (version) values ('00027');
```

Quick checks for the recent migrations, when unsure whether one ran:

| Migration | Applied if this returns a row |
|-----------|-------------------------------|
| 00019 | `select 1 from pg_tables where tablename = 'scheduler_state'` |
| 00024 | `select 1 from pg_proc where proname = 'trg_users_protect_identity'` |
| 00025 | `select 1 from pg_tables where tablename = 'recurring_match_occurrences'` |
| 00026 | `select 1 from pg_proc where proname = 'notification_visible_to'` |
| 00027 | `select 1 from pg_constraint where conname = 'groups_name_length'` |

`supabase/seed.sql` is demo data for a local stack. Never run it on
production.

## 2. Supabase Auth

Dashboard → **Authentication**.

### URL configuration

| Setting | Value |
|---------|-------|
| Site URL | the production `NEXT_PUBLIC_APP_URL`, e.g. `https://fulbot.app` |
| Redirect URLs | `https://fulbot.app/api/auth/**` |
| | `https://*-<vercel-team>.vercel.app/api/auth/**` (preview deploys, optional) |
| | `http://localhost:3000/api/auth/**` (local dev against this project, optional) |

The `/api/auth/**` entry covers both landing routes:

- `/api/auth/confirm`: the links in the templates below. It verifies the
  token hash on the server, so the link works in any browser, the installed
  PWA or the mail app's web view.
- `/api/auth/callback`: the PKCE `?code=` landing used by Supabase's default
  templates. It only works in the browser that started the sign-up or reset,
  so paste the templates.

A redirect URL that is not allow-listed makes Supabase fall back to the Site
URL, and the player lands on `/` instead of the invite that sent them.

### Sign-in providers → Email

- **Confirm email: on.** Sign-up shows "Revisá tu correo" and waits for the
  link; login maps "Email not confirmed" to a message with a resend button.
- **Secure email change: on.**
- **Minimum password length: 6** (the forms enforce 6 too).
- **Email OTP expiration: 3600** seconds (the reset template says one hour).

### SMTP (required)

Supabase's built-in mailer only sends a couple of emails an hour and only to
members of the Supabase organisation. Configure a real provider (Resend,
Postmark, Amazon SES, Brevo…) under **Authentication → Emails → SMTP
Settings**:

- Sender email on a domain you control, with SPF and DKIM set up at the
  provider (otherwise confirmations land in spam).
- Sender name: `fulbot`.

### Email templates

Authentication → Emails → Templates. Paste the HTML from `supabase/templates/`
(Spanish files for a Spanish-speaking group; the `.en.html` files are the
English versions):

| Template | File | Subject |
|----------|------|---------|
| Confirm signup | `confirm-signup.es.html` | Confirmá tu cuenta de fulbot |
| Reset password | `reset-password.es.html` | Elegí una contraseña nueva para fulbot |

Both link to
`{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=…&next={{ .RedirectTo }}`.
`next` must stay last: `/api/auth/confirm` unwraps the `?next=` inside
`RedirectTo` to send the player back to the invite or page they came from.
A link that fails (expired, already used) lands on `/login` with a message
for its type and the original target kept.

### Rate limits

Authentication → Rate Limits. With custom SMTP:

- Emails sent per hour: **30** or more (sign-ups, resends and resets share
  it; a group joining at once after a WhatsApp invite can burst).
- Token verifications: default is fine.

The resend button waits 60 s between sends, matching Supabase's per-address
limit; a rate-limit error is shown as "Demasiados intentos".

## 3. Vercel environment variables

Project → Settings → Environment Variables (Production, and Preview if you
use previews). Rebuild after changing any `NEXT_PUBLIC_*` value: they are
inlined at build time.

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | server only: guest sign-up, scheduler, push, health |
| `NEXT_PUBLIC_APP_URL` | yes* | `https://fulbot.app`, no trailing slash. *On Vercel it falls back to `https://$VERCEL_PROJECT_PRODUCTION_URL` |
| `CRON_SECRET` | yes | `openssl rand -hex 32`. Vercel Cron sends it as `Authorization: Bearer …` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | for push | `npx web-push generate-vapid-keys --json`, once; keep the pair forever |
| `VAPID_PRIVATE_KEY` | for push | |
| `VAPID_SUBJECT` | for push | `mailto:you@your-domain.com` |
| `OPENAI_API_KEY` | no | AI team balancing; without it the deterministic balancer runs |
| `OPENAI_MODEL` | no | default `gpt-4o-mini` |
| `HEALTH_MAX_TICK_AGE_MINUTES` | no | `/api/health` threshold, default 10 |

The build checks the environment (`next.config.mjs`): on Vercel, in CI, or
with `FULBOT_STRICT_ENV=1`, it **fails** when the app URL (explicit or the
Vercel fallback) or the Supabase URL/anon key is missing, instead of shipping
invite and share links that point at `http://localhost:3000`. A local
`next build` only warns. At runtime the server and middleware throw a clear
error naming the missing Supabase variable (`src/lib/env.ts`).

Preview deploys use the production domain for share links when only the
fallback is set. Set `NEXT_PUBLIC_APP_URL` per environment if previews need
their own links.

Security headers (`next.config.mjs`): `frame-ancestors 'none'` and
`X-Frame-Options: DENY` (no page, including the one-tap `/m` page, can be
framed), `nosniff`, `strict-origin-when-cross-origin`, and a Permissions-Policy
that turns off camera, microphone, geolocation and topics.

## 4. Scheduler

Result requests, reminders, recurring match lists, the WhatsApp outbox and
device push all run from `POST /api/cron/tick` (see the README's Ticker
section). Something must call it every minute. Options, best first:

1. **`scripts/ticker.ts` on an always-on machine** (a small VPS, a Raspberry
   Pi, Fly.io/Railway, or the `Dockerfile.ticker` container):
   `NEXT_PUBLIC_APP_URL=… CRON_SECRET=… npm run ticker`. Free, one-minute
   precision, logs one line per tick and a `WARN` line per failed job.
2. **An external cron service** calling
   `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://fulbot.app/api/cron/tick`
   every minute (cron-job.org, Upstash QStash, Better Stack). Nothing to host.
   GitHub Actions `schedule` is not a good fit: 5-minute minimum and often
   delayed by much more.
3. **Vercel Cron every minute** (Pro plan): add
   `{ "path": "/api/cron/tick", "schedule": "* * * * *" }` to `vercel.json`.
   Hobby only allows daily crons.
4. **Nothing extra.** The daily Vercel cron (`/api/cron/daily`, 12:00 UTC)
   plus the tick fired by signed-in page loads. Results requests and
   reminders then arrive late (up to a day for a group nobody opens), and
   `/api/health` reports `degraded`.

## 5. Monitoring

`GET /api/health` answers `200 {"status":"ok"}` or `503 {"status":"degraded"}`.
Degraded means: no tick in the last `HEALTH_MAX_TICK_AGE_MINUTES` (default
10), a pending job overdue by more than 10 minutes, a scheduled job failed in
the last 24 hours, or the database could not be read.

Point an uptime monitor (UptimeRobot, Better Stack, Uptime Kuma) at
`https://fulbot.app/api/health`, checking for HTTP 200 every 5 minutes. It
catches a dead ticker as well as a down app.

For the details, send the cron secret:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://fulbot.app/api/health | jq
# { "status": "degraded", "last_tick_at": "…", "last_tick_age_seconds": 1830,
#   "overdue_jobs": 2, "failed_jobs_24h": 1, "recent_failures": [ … ],
#   "problems": ["no tick for 31 min", "2 overdue job(s)", …] }
```

Anonymous callers only ever see `status`.

## 6. Smoke test

After the first deploy and after any auth change:

1. Register with a new address from a phone. The confirmation email arrives
   from your SMTP sender; open it **in the mail app** (not the browser that
   registered): you land signed in on `/groups`.
2. Open an invite link while signed out → "Crear cuenta para unirme" →
   confirm on another device → you land on the invite.
3. Tap the same confirmation link again: `/login` explains the email may
   already be confirmed.
4. "¿Olvidaste tu contraseña?" → the reset email → a new password → signed in.
5. Share a `/m/<match>` link in WhatsApp: the preview shows the group, date
   and spots.
6. `curl https://fulbot.app/api/health` → `{"status":"ok"}` once the ticker
   runs.
7. Visit a mistyped URL: the board 404 page with "Ir a mis grupos".
