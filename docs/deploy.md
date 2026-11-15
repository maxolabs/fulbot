# Deploying fulbot

Production is two services:

- **Vercel** runs the Next.js app.
- **Supabase** (hosted) runs Postgres, Auth, Vault and the minute ticker
  (`pg_cron` + `pg_net`, migration 00036).

Local development is in the [README](../README.md). The local Supabase stack
reads `supabase/config.toml`, which mirrors the auth settings below.

Owner decisions recorded here (2026-11-15): the product name stays
**fulbot**; the auth email templates and the WhatsApp messages are in
**Spanish**.

Checklist for a new project, in order:

1. [Database: link and push the migrations](#1-database)
2. [Supabase Auth](#2-supabase-auth): URLs, email settings, SMTP, the `.es` templates
3. [Vercel: environment variables and deploy](#3-vercel)
4. [Ticker: the two Vault secrets](#4-ticker-pg_cron)
5. [Post-deploy check](#5-post-deploy-check)
6. [Smoke test](#6-smoke-test)

Later: [future migrations](#7-future-migrations), [monitoring](#8-monitoring),
[local development drivers](#9-local-development).

---

## 1. Database

The hosted database is built only from `supabase/migrations`
(`00001_…` to `00037_…`), applied in order by the Supabase CLI. The CLI
records each applied version in `supabase_migrations.schema_migrations`, so
`supabase db push` only ever applies what is missing. Nothing is pasted into
the SQL editor by hand.

### A fresh project

Create the project (Postgres 17, like `[db] major_version` in
`config.toml`), keep the database password, then from the repo root:

```bash
supabase login                              # once per machine
supabase link --project-ref <project-ref>   # asks for the database password
supabase migration list                     # fresh project: the Remote column is empty
supabase db push --dry-run                  # lists 00001 … 00037
supabase db push                            # applies them in order
supabase migration list                     # every row now has Local = Remote
```

`db push` never runs `supabase/seed.sql` (demo accounts with the password
`password123`): never pass `--include-seed` against production.

Migration 00036 enables `pg_cron` (schema `pg_catalog`) and `pg_net`
(schema `extensions`) and schedules the `fulbot-tick` job. It does nothing
until the Vault secrets of [step 4](#4-ticker-pg_cron) exist. Check that the
job belongs to `postgres` (the CLI may log in through a temporary role):

```sql
select jobname, schedule, username, active from cron.job;
-- fulbot-tick | * * * * * | postgres | t
```

If `username` is not `postgres`, run in the SQL editor (which runs as
`postgres`):

```sql
select cron.unschedule(jobid) from cron.job where jobname = 'fulbot-tick' and username <> 'postgres';
select cron.schedule('fulbot-tick', '* * * * *', 'select public.fulbot_cron_tick()');
```

### Rebuilding an existing project

The cleanest rebuild is a new project with the steps above (then point
Vercel at it). To reset the current one instead, back it up first
(`supabase db dump --linked -f backup.sql`), then
`supabase db reset --linked --no-seed`. **Always pass `--no-seed`**: without
it the reset runs `seed.sql` on production. The reset rebuilds the app's
schema, not Supabase's own schemas: old Auth users can survive without their
`public.users` rows, so delete them under Authentication → Users for a clean
start. Afterwards check `select name from vault.secrets` and the job query
above, and redo step 4 if the secrets are gone.

## 2. Supabase Auth

Dashboard → **Authentication**, or the single Management API call at the
end of this section.

### URL configuration

| Setting | Value |
|---------|-------|
| Site URL | the production `NEXT_PUBLIC_APP_URL`, e.g. `https://fulbot.app` |
| Redirect URLs | `https://fulbot.app/api/auth/**` |
| | `https://*-<vercel-team>.vercel.app/api/auth/**` (preview deploys, optional) |
| | `http://localhost:3000/api/auth/**` (local dev against this project, optional) |

The email templates link to `{{ .SiteURL }}/api/auth/confirm`, which verifies
the token hash on the server: the link works in any browser, the installed
PWA or the mail app's web view. `/api/auth/callback` is the PKCE `?code=`
landing of Supabase's default templates and only works in the browser that
asked for the email, which is why the templates below are required. A
redirect URL that is not allow-listed makes Supabase fall back to the Site
URL, and the player lands on `/` instead of the invite that sent them.

### Sign-in providers → Email

- **Confirm email: on.** Sign-up shows "Revisá tu correo"; login maps
  "Email not confirmed" to a message with a resend button.
- **Secure email change: on.** The change email goes to the current and the
  new address; the change applies when both links are opened.
- **Secure password change: off** (the settings "Cambiar contraseña" row
  does not ask for the current password).
- **Minimum password length: 6** (the forms enforce 6 too).
- **Email OTP expiration: 3600** seconds (the templates say one hour).

### SMTP (required)

Supabase's built-in mailer sends a couple of emails an hour, only to members
of the Supabase organisation. Configure a real provider (Resend, Postmark,
Amazon SES, Brevo…) under **Authentication → Emails → SMTP Settings**:

- Sender address on a domain you control, with SPF and DKIM set up at the
  provider (otherwise confirmations land in spam).
- Sender name: `fulbot`.

### Email templates (Spanish)

Supabase takes one template per email type, and the chosen language is
Spanish. Authentication → Emails → Templates, paste the HTML of these files
(the same ones the local stack uses through `config.toml`):

| Template | File | Subject |
|----------|------|---------|
| Confirm signup | `supabase/templates/confirm-signup.es.html` | Confirmá tu cuenta de fulbot |
| Reset password | `supabase/templates/reset-password.es.html` | Elegí una contraseña nueva para fulbot |
| Change email address | `supabase/templates/email-change.es.html` | Confirmá el cambio de email en fulbot |

The links:

- signup: `{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next={{ .RedirectTo }}`
- recovery: `…&type=recovery&next={{ .RedirectTo }}`. `next` stays last:
  `/api/auth/confirm` unwraps the `?next=` inside `RedirectTo` to send the
  player back to the invite or page they came from.
- email change: `…&type=email_change&next=/settings`. Each of the two links
  (current and new address) verifies its own token and lands on `/settings`
  (or on `/login?redirect=/settings` when opened in a browser that is not
  signed in; the change is applied either way).
  With the default template the first click would end on `/login?error`.

A link that fails (expired, already used) lands on `/login` with a message
for its type and the original target kept. The `.en.html` files are English
translations kept for reference; they are not used.

### Rate limits

Authentication → Rate Limits, with custom SMTP: **emails sent per hour 30**
or more (sign-ups, resends, resets and email changes share it; a group
joining at once after a WhatsApp invite can burst). The resend button waits
60 s between sends, matching Supabase's per-address limit.

### The same settings through the Management API

Everything above except SMTP in one call (a personal access token from
supabase.com/dashboard/account/tokens; run from the repo root, needs `jq`):

```bash
APP_URL=https://fulbot.app
jq -n \
  --arg site "$APP_URL" \
  --arg allow "$APP_URL/api/auth/**" \
  --rawfile confirm supabase/templates/confirm-signup.es.html \
  --rawfile recovery supabase/templates/reset-password.es.html \
  --rawfile change supabase/templates/email-change.es.html \
  '{
    site_url: $site,
    uri_allow_list: $allow,
    mailer_autoconfirm: false,
    mailer_secure_email_change_enabled: true,
    security_update_password_require_reauthentication: false,
    password_min_length: 6,
    mailer_otp_exp: 3600,
    mailer_subjects_confirmation: "Confirmá tu cuenta de fulbot",
    mailer_templates_confirmation_content: $confirm,
    mailer_subjects_recovery: "Elegí una contraseña nueva para fulbot",
    mailer_templates_recovery_content: $recovery,
    mailer_subjects_email_change: "Confirmá el cambio de email en fulbot",
    mailer_templates_email_change_content: $change
  }' > /tmp/fulbot-auth.json

curl -sS -X PATCH "https://api.supabase.com/v1/projects/<project-ref>/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/fulbot-auth.json | jq '{site_url, uri_allow_list, mailer_subjects_email_change}'
```

`uri_allow_list` is comma-separated and the call **replaces** the whole
list: include every entry you want to keep (preview pattern, localhost) in
`$allow`, e.g. `--arg allow "$APP_URL/api/auth/**,http://localhost:3000/api/auth/**"`. SMTP goes in the same endpoint (`smtp_host`, `smtp_port`, `smtp_user`,
`smtp_pass`, `smtp_admin_email`, `smtp_sender_name`) or in the dashboard;
raise `rate_limit_email_sent` to 30 once SMTP is set. Check the result in the
dashboard (Templates shows the Spanish HTML).

## 3. Vercel

Project → Settings → Environment Variables, for Production (and Preview if
you use previews). Vercel applies environment changes only to new
deployments: redeploy after changing **any** variable (`NEXT_PUBLIC_*` values
are also inlined at build time). In particular, set `CRON_SECRET` and
redeploy before storing the Vault secrets of step 4, or every tick gets 401. Mark the server-only secrets as Sensitive.

| Variable | Required | What it does · how to get it |
|----------|----------|------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL, `https://<ref>.supabase.co` (Project Settings → Data API). Browser and server clients. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | The `anon` key (Project Settings → API Keys, the JWT-based "legacy" keys, like the local stack). Browser and server clients under RLS. The app has not been tested with the newer `sb_publishable_…` / `sb_secret_…` keys; keep the legacy keys enabled until it is. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | The `service_role` key, same page. **Server only.** Used by the admin client: the scheduler tick and cron routes, guest sign-up on `/m`, push delivery, `/api/health`, and account deletion (`/api/account/delete`), which needs it to delete the Auth user. |
| `NEXT_PUBLIC_APP_URL` | yes | The canonical production URL, no trailing slash, e.g. `https://fulbot.app`. Invite, share and WhatsApp links, Open Graph. Use the same value for the Supabase Site URL and the Vault secret `fulbot_app_url`. Falls back to `https://$VERCEL_PROJECT_PRODUCTION_URL` on Vercel. |
| `CRON_SECRET` | yes | `openssl rand -hex 32`. Every `/api/cron/*` route and the detailed `/api/health` require `Authorization: Bearer $CRON_SECRET`. The same value goes into the Vault secret `fulbot_cron_secret`; Vercel Cron sends it to `/api/cron/daily` by itself. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | for push | `npx web-push generate-vapid-keys --json`, once; keep the pair forever (changing it orphans every subscription). |
| `VAPID_PRIVATE_KEY` | for push | The private half of that pair. Server only. |
| `VAPID_SUBJECT` | for push | `mailto:you@your-domain.com`. Without all three VAPID values device push is off (the tick reports `push.configured: false`). |
| `OPENAI_API_KEY` | no | AI team balancing (platform.openai.com → API keys). Without it the deterministic balancer runs and labels the result "Sin IA". |
| `OPENAI_MODEL` | no | Default `gpt-4o-mini`. |
| `HEALTH_MAX_TICK_AGE_MINUTES` | no | Minutes without a tick before `/api/health` reports degraded. Default 10; the pg_cron job ticks every minute. |

Not set by hand: `VERCEL`, `VERCEL_PROJECT_PRODUCTION_URL` (Vercel system
variables), `CI`, `FULBOT_STRICT_ENV` (force the build-time check off
Vercel), `NODE_ENV`. `TICKER_APP_URL`, `TICKER_INTERVAL_MS` and
`TICKER_MAX_TICKS` are only read by `scripts/ticker.ts` (local).

The build checks the environment (`next.config.mjs`): on Vercel, in CI or
with `FULBOT_STRICT_ENV=1` it **fails** when the app URL or the Supabase
URL/anon key is missing, instead of shipping links to `http://localhost:3000`.
At runtime the server throws an error naming any missing Supabase variable
(`src/lib/env.ts`). Fonts are committed (`src/assets/fonts`, `next/font/local`),
so the build makes no network request for them.

`vercel.json` registers one daily cron (`/api/cron/daily`, 12:00 UTC), which
Hobby allows. It is a backstop that runs the same tick plus the daily sweeps;
the minute driver is pg_cron.

Leave Vercel's Deployment Protection off for the production domain (the
default) and don't put `/api/cron/tick` behind a firewall challenge: pg_cron
calls it without a browser.

Routes worth knowing: the app's public pages are `/`, `/login`, `/register`,
`/invite/<code>`, `/m/<match>`, `/privacy` and `/terms` (no setup needed);
the server routes that need the service role key are `/api/cron/*`,
`/api/health`, `/api/matches/<id>/guest-signup` and `/api/account/delete`.

Security headers (`next.config.mjs`): `frame-ancestors 'none'` and
`X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin`, and a
Permissions-Policy that turns off camera, microphone, geolocation and topics.

## 4. Ticker (pg_cron)

Result requests, reminders, recurring match lists, auto-finish, the WhatsApp
outbox and device push all run from `POST /api/cron/tick`, and it must be
called every minute. In production the database does it: the `fulbot-tick`
pg_cron job runs `public.fulbot_cron_tick()` every minute, which reads two
Vault secrets and queues `POST <app url>/api/cron/tick` with
`Authorization: Bearer <secret>` through pg_net. Until both secrets exist the
job runs and returns at once.

Once the app is deployed and `CRON_SECRET` is set in Vercel, store the two
secrets. Either paste into the SQL editor:

```sql
select vault.create_secret('https://fulbot.app', 'fulbot_app_url', 'fulbot: URL the pg_cron ticker posts to');
select vault.create_secret('<the CRON_SECRET value>', 'fulbot_cron_secret', 'fulbot: bearer for /api/cron/tick');
```

or keep the secret out of the editor's history with psql (Dashboard →
Connect → Session pooler URI):

```bash
echo "select vault.create_secret(:'url', 'fulbot_app_url', 'fulbot: URL the pg_cron ticker posts to');
      select vault.create_secret(:'secret', 'fulbot_cron_secret', 'fulbot: bearer for /api/cron/tick');" \
  | psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -v url="$APP_URL" -v secret="$CRON_SECRET"
```

Rules for the values:

- `fulbot_app_url` is the final URL, exactly `NEXT_PUBLIC_APP_URL`: pg_net does
  not follow redirects, so `https://fulbot.app` when the site redirects
  `www` to the apex (or the other way round) must be the one that answers.
  A trailing slash is tolerated.
- `fulbot_cron_secret` is byte-for-byte the Vercel `CRON_SECRET`.

To rotate the secret: set the new `CRON_SECRET` in Vercel and redeploy, then

```sql
select vault.update_secret(id, '<new value>') from vault.secrets where name = 'fulbot_cron_secret';
```

Ticks fail with 401 between the two steps and resume on the next minute.

To pause the ticker: `select cron.alter_job(jobid, active := false) from cron.job where jobname = 'fulbot-tick';`
(`active := true` to resume). The function also prunes the job's own
`cron.job_run_details` rows older than a week, once an hour; pg_net keeps
responses for 6 hours.

Privileges: `fulbot_cron_tick()` is executable only by its owner
(`postgres`, which owns the job); `get_ticker_status()` only by
`service_role`, for `/api/health`. Neither returns secret values. Supabase
grants `net.http_post` to the API roles by default, but the `net` schema is
not exposed through the Data API.

## 5. Post-deploy check

Within two minutes of storing the secrets:

```bash
curl -s https://fulbot.app/api/health
# {"status":"ok"}  (HTTP 200)

curl -s -H "Authorization: Bearer $CRON_SECRET" https://fulbot.app/api/health | jq
# status "ok", last_tick_age_seconds < 120,
# driver.job.active true, driver.secrets.app_url/cron_secret true,
# driver.last_run.status "succeeded", driver.last_response.status_code 200
```

`driver.last_response` is the newest row in pg_net's response table, whoever
queued the request. The ticker is the only pg_net caller today; if another
feature starts using pg_net, read that field with care (or filter by URL).

The same from SQL:

```sql
select jobname, schedule, username, active from cron.job;            -- fulbot-tick, * * * * *, postgres, t
select status, return_message, start_time
  from cron.job_run_details d join cron.job j using (jobid)
 where j.jobname = 'fulbot-tick' order by runid desc limit 3;         -- succeeded, "1 row"
select status_code, timed_out, error_msg, created, left(content, 120)
  from net._http_response order by id desc limit 3;                  -- 200, {"success":true,…}
select last_tick_at, now() - last_tick_at as age from public.scheduler_state;  -- under a minute
```

When it is not ticking, the authorized health response lists the likely
cause under `problems`:

| `problems` says | Fix |
|-----------------|-----|
| `Vault secret(s) … missing` | Step 4. |
| `HTTP 401: fulbot_cron_secret does not match CRON_SECRET` | Update the Vault secret, or redeploy after changing `CRON_SECRET`. |
| `HTTP 30x: fulbot_app_url redirects` | Store the URL the redirect points to. |
| `HTTP 404` / `HTTP 5xx` | Wrong URL, or the deploy is broken: open `<url>/api/cron/tick` logs in Vercel. |
| `timed out` / `Couldn't resolve host` | Wrong host in `fulbot_app_url`. |
| `pg_cron job fulbot-tick is missing / inactive` | Re-run `supabase db push` (00036), or `cron.alter_job(…, active := true)`. |

## 6. Smoke test

After the first deploy and after any auth change:

1. Register with a new address from a phone. The confirmation email arrives
   in Spanish from your SMTP sender; open it **in the mail app** (not the
   browser that registered): you land signed in on `/groups`.
2. Open an invite link while signed out → "Crear cuenta para unirme" →
   confirm on another device → you land on the invite.
3. Tap the same confirmation link again: `/login` explains the email may
   already be confirmed.
4. "¿Olvidaste tu contraseña?" → the reset email → a new password → signed in.
5. Settings → "Cambiar email": both emails arrive; after opening both links
   you are on `/settings` with the new address.
6. Share a `/m/<match>` link in WhatsApp: the preview shows the group, date
   and spots.
7. `curl https://fulbot.app/api/health` → `{"status":"ok"}`.
8. Visit a mistyped URL: the board 404 page with "Ir a mis grupos".

## 7. Future migrations

1. Add `supabase/migrations/000NN_<name>.sql` with the next number. Write it
   re-runnable (`create or replace`, `if [not] exists`, `drop … if exists`)
   and never edit a migration that production already has.
2. Test it on the local stack (`supabase migration up`, then the scenario
   scripts in `supabase/tests/`), and regenerate
   `src/types/database.generated.ts`.
3. Deploy: `supabase db push --dry-run` (shows only the new file), then
   `supabase db push`, then merge the app change (Vercel deploys `main`).
   Database first is the default because the app usually calls what the
   migration adds; when a migration removes something the running app still
   uses, deploy the app first.
4. `supabase migration list` must show Local = Remote for every row.

If a change was ever applied by hand in the SQL editor, record it instead of
re-running it: `supabase migration repair --status applied 000NN`.

## 8. Monitoring

`GET /api/health` answers `200 {"status":"ok"}` or `503 {"status":"degraded"}`.
Degraded means:

- no tick in the last `HEALTH_MAX_TICK_AGE_MINUTES` (default 10);
- a pending job overdue by more than 10 minutes;
- a scheduled job that failed for good (5 attempts) in the last 24 hours;
- the database could not be read.

With the pg_cron job ticking every minute the status stays `ok`; it turns
`degraded` within ten minutes of the ticks stopping, whatever the cause
(secrets, the app, the job). Point an uptime monitor (UptimeRobot, Better
Stack, Uptime Kuma) at `https://fulbot.app/api/health`, expecting HTTP 200
every 5 minutes: it catches a dead ticker as well as a down app. Anonymous
callers only ever see `status`; the bearer adds the details shown in
[step 5](#5-post-deploy-check) and the recent job failures.

## 9. Local development

The local stack runs migration 00036 too, so the `fulbot-tick` job exists
and runs every minute, doing nothing (no Vault secrets). Locally the tick is
driven by `scripts/ticker.ts`:

```bash
npm run ticker   # reads NEXT_PUBLIC_APP_URL and CRON_SECRET from .env.local, POSTs /api/cron/tick every minute
```

Signed-in page loads also fire a tick at most once a minute
(`src/lib/notifications/opportunistic-tick.ts`).

To try the pg_cron path locally, point the secrets at the dev server as the
database container sees it, watch a tick arrive, then remove them:

```sql
select vault.create_secret('http://host.docker.internal:3000', 'fulbot_app_url');
select vault.create_secret('<CRON_SECRET from .env.local>', 'fulbot_cron_secret');
-- wait for the next minute, then:
select status_code, left(content, 120) from net._http_response order by id desc limit 1;
delete from vault.secrets where name in ('fulbot_app_url', 'fulbot_cron_secret');
```

`Dockerfile.ticker` packages the same script as a container, for running the
app somewhere without pg_cron.
