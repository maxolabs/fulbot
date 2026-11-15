# fulbot

Weekly amateur football organiser: signups, AI-balanced teams, crowd-sourced
results. Next.js 14 + Supabase. Product spec in `init-prompt.md`; design docs
in `docs/`.

## Development

```bash
npm ci
cp .env.local.example .env.local   # fill in Supabase keys, CRON_SECRET, NEXT_PUBLIC_APP_URL
npm run dev
```

Migrations live in `supabase/migrations`. Production applies them with the
Supabase CLI (`supabase link` + `supabase db push`, tracked in
`supabase_migrations.schema_migrations`); see docs/deploy.md. Scenario scripts
for the SQL live in `supabase/tests/`. `supabase/seed.sql` builds a demo
dataset for a local stack (every account's password is `password123`); it
never runs on production.

Checks (the same ones CI runs, `.github/workflows/ci.yml`):

```bash
npm run type-check
npm run lint
npm test          # node:test unit tests (src/**/*.test.ts) through tsx
npm run build
```

`supabase/config.toml` configures a local Supabase stack (`supabase start`:
API on 56621, database on 56622, the mail catcher on 56624) with email
confirmation on and the Spanish templates from `supabase/templates/`.

## Deploying

Production setup (migrations with the Supabase CLI, Supabase Auth URLs,
SMTP, the Spanish email templates, Vercel environment variables, the pg_cron
ticker's Vault secrets, the post-deploy check and `/api/health` monitoring) is
in [docs/deploy.md](docs/deploy.md).

## Device notifications and WhatsApp

Players can enable Web Push in **Settings → Notifications on this device**.
An alert opens the relevant match, teams, or result form. Invitations,
announcements, visible results, and team images can be shared into an existing
WhatsApp group; the user selects the group and sends. No WhatsApp credentials
or unofficial client are required. Image sharing uses the native share sheet
where supported, with download and copy fallbacks.

To enable device delivery:

1. Apply `supabase/migrations/00022_device_push.sql` after the earlier migrations.
2. Generate one key pair with `npx web-push generate-vapid-keys --json`.
   Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and a real contact
   `VAPID_SUBJECT=mailto:you@your-domain.com` in the deployment, then rebuild.
   Keep the same key pair across deployments so existing subscriptions work.
3. Make sure the minute ticker runs (below): in production the pg_cron job
   with its Vault secrets. Each tick opens recurring match lists, checks
   reminders, runs scheduled jobs, and drains the device-push queue (plus the
   optional WhatsApp webhook outbox, for groups that configured one).
   The daily cron alone does **not** provide timely notifications.
4. Serve over HTTPS (localhost is allowed for development). On iOS/iPadOS 16.4+
   install the app on the Home Screen, open that icon, then enable notifications.

Subscriptions are per account and device, removed on sign-out, and opt-in only.
Delivery respects active memberships and notification preferences; result
reminders target pending reporters. Existing notifications aren't replayed when
a new device subscribes. Read events and cancelled/past match announcements are
suppressed at dispatch. Sensitive rating nudges remain inside the app.
Push uses browser vendors' delivery services directly, without a notification
SaaS provider. OS notification settings and Focus modes control presentation.

Delivery retries are bounded and leased; a crash after provider acceptance can
still cause a retry. Stable notification tags collapse duplicate alerts.
Expired subscriptions (HTTP 404/410) are removed automatically.

Validation: `npx tsx --test src/lib/notifications/push-payload.test.ts` and, on a
disposable database with all migrations applied,
`psql -v ON_ERROR_STOP=1 -f scripts/test-device-push.sql`.
Before release, enable notifications on a physical phone, open a match list
from a second account, tap the alert, and share a lineup image to WhatsApp.

## Ticker

After a match the app asks the players for the score, goals and MVP, sends one
reminder, and closes the reporting window (see
`docs/match-results-consensus.md`). Each of those steps is a row in the
`scheduled_jobs` table with a `run_at`. Nothing runs them by itself: the
`/api/cron/tick` endpoint claims every due row, runs it and drains the WhatsApp
outbox, and something has to call that endpoint regularly.

The drivers all call the same endpoint; the work never depends on which one
fired, and calling it more often than needed is harmless:

1. **Production: Supabase pg_cron** (migration 00036). The `fulbot-tick` job
   runs every minute inside the database and POSTs `/api/cron/tick` through
   pg_net, with the app URL and `CRON_SECRET` read from Vault
   (`fulbot_app_url`, `fulbot_cron_secret`). Without those secrets it does
   nothing, which is the case on a local stack. Setup and checks:
   [docs/deploy.md](docs/deploy.md#4-ticker-pg_cron).

2. **Local development: the ticker script.** A loop that POSTs
   `/api/cron/tick` every minute.

   ```bash
   # reads NEXT_PUBLIC_APP_URL and CRON_SECRET from .env.local
   npm run ticker
   ```

   Env: `NEXT_PUBLIC_APP_URL` (or `TICKER_APP_URL` to point at a different
   deployment), `CRON_SECRET`, optional `TICKER_INTERVAL_MS` (default 60000,
   minimum 5000). It logs one line per tick and never exits on a failed tick,
   only on missing configuration. `Dockerfile.ticker` packages it as a
   container, for hosting the app somewhere without pg_cron.

3. **Backstops.** The daily Vercel cron (`vercel.json`, `/api/cron/daily`,
   12:00 UTC) runs a tick and the daily sweeps, and the dashboard layout fires
   a detached tick at most once a minute per instance on signed-in traffic.
   Neither is a minute driver: without one, result requests and reminders
   arrive late and `/api/health` reports `degraded`.

To trigger a tick by hand:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/tick
```

The response lists the jobs claimed in that pass (`claimed`, `done`, `failed`,
`jobs[]`) and the outbox drain result.

To know whether the scheduler is alive, point an uptime monitor at
`GET /api/health` (200 `ok` / 503 `degraded`; details with the
`CRON_SECRET` bearer). See [docs/deploy.md](docs/deploy.md#8-monitoring).
