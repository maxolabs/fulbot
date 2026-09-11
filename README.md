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

Migrations live in `supabase/migrations` and are applied by hand (Supabase
dashboard or `psql`). `supabase/seed.sql` builds a demo dataset for a local
stack (every account's password is `password123`).

## Ticker

After a match the app asks the players for the score, goals and MVP, sends one
reminder, and closes the reporting window (see
`docs/match-results-consensus.md`). Each of those steps is a row in the
`scheduled_jobs` table with a `run_at`. Nothing runs them by itself: the
`/api/cron/tick` endpoint claims every due row, runs it and drains the WhatsApp
outbox, and something has to call that endpoint regularly.

Three drivers call the same endpoint; the work never depends on which one
fired, and calling it more often than needed is harmless:

1. **The ticker script** (recommended). A loop that POSTs `/api/cron/tick`
   every minute. Run it on anything that stays on: a laptop, a Raspberry Pi, a
   small VPS.

   ```bash
   # reads NEXT_PUBLIC_APP_URL and CRON_SECRET from .env.local
   npm run ticker

   # or explicitly
   NEXT_PUBLIC_APP_URL=https://your-app.vercel.app CRON_SECRET=... npm run ticker
   ```

   Env: `NEXT_PUBLIC_APP_URL` (or `TICKER_APP_URL` to point at a different
   deployment), `CRON_SECRET`, optional `TICKER_INTERVAL_MS` (default 60000,
   minimum 5000). It logs one line per tick and never exits on a failed tick,
   only on missing configuration.

   As a container:

   ```bash
   docker build -f Dockerfile.ticker -t fulbot-ticker .
   docker run -d --restart unless-stopped \
     -e NEXT_PUBLIC_APP_URL=https://your-app.vercel.app \
     -e CRON_SECRET=... \
     fulbot-ticker
   ```

2. **The daily Vercel cron** (`vercel.json`, `/api/cron/daily`) runs a tick
   first thing every day. With no ticker running this is the floor: a Monday
   21:00 match gets its result request at the next 12:00 UTC run instead of an
   hour after the final whistle.

3. **Signed-in traffic.** The dashboard layout fires a detached tick at most
   once a minute per instance, so the first player who opens the app after a
   match triggers the request for everyone even if no ticker is up.

To trigger a tick by hand:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/tick
```

The response lists the jobs claimed in that pass (`claimed`, `done`, `failed`,
`jobs[]`) and the outbox drain result.
