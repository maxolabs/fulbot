// Scheduler ticker (docs/match-results-consensus.md §5, §11.2).
//
// The app has no resident process on a serverless host, so this tiny loop is
// the "always-on" driver of the results scheduler: every TICKER_INTERVAL_MS it
// POSTs /api/cron/tick with the CRON_SECRET, which claims and runs every due
// `scheduled_jobs` row (auto-finish, result request, reminder, window close)
// and drains the WhatsApp outbox. Run it anywhere that stays up: a laptop, a
// Raspberry Pi, a small VPS, or the Dockerfile.ticker container.
//
//   npm run ticker
//   TICKER_INTERVAL_MS=30000 npm run ticker
//
// Required env: NEXT_PUBLIC_APP_URL (or TICKER_APP_URL) and CRON_SECRET.
// `npm run ticker` loads .env.local through tsx's --env-file flag; a plain
// `tsx scripts/ticker.ts` needs the variables exported by hand.
//
// Exit codes: 1 only for configuration errors (missing env). A failing tick
// (network down, app deploying, migration not applied yet) is logged and
// retried on the next interval -- the endpoint is idempotent, so a missed or
// doubled tick never corrupts anything.

const DEFAULT_INTERVAL_MS = 60_000
const REQUEST_TIMEOUT_MS = 55_000

function readConfig(): { url: string; secret: string; intervalMs: number; maxTicks: number } {
  const base = (process.env.TICKER_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').trim()
  const secret = (process.env.CRON_SECRET ?? '').trim()
  const problems: string[] = []
  if (!base) problems.push('NEXT_PUBLIC_APP_URL (or TICKER_APP_URL) is not set')
  if (!secret) problems.push('CRON_SECRET is not set')
  if (problems.length > 0) {
    for (const p of problems) console.error(`[ticker] config error: ${p}`)
    process.exit(1)
  }

  const rawInterval = Number(process.env.TICKER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS)
  const intervalMs =
    Number.isFinite(rawInterval) && rawInterval >= 5_000 ? Math.floor(rawInterval) : DEFAULT_INTERVAL_MS

  // TICKER_MAX_TICKS is for tests/CI: stop after N ticks instead of forever.
  const rawMax = Number(process.env.TICKER_MAX_TICKS ?? 0)
  const maxTicks = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : 0

  return { url: `${base.replace(/\/+$/, '')}/api/cron/tick`, secret, intervalMs, maxTicks }
}

function stamp(): string {
  return new Date().toISOString()
}

async function tickOnce(url: string, secret: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const started = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      signal: controller.signal,
    })
    const elapsed = Date.now() - started
    let body: Record<string, unknown> = {}
    try {
      body = (await res.json()) as Record<string, unknown>
    } catch {
      // Non-JSON body (e.g. an HTML error page while the app deploys).
    }

    if (!res.ok) {
      console.error(
        `[ticker] ${stamp()} HTTP ${res.status} in ${elapsed}ms: ${String(body.error ?? res.statusText)}`
      )
      return
    }

    const outbox = body.outbox as Record<string, unknown> | undefined
    const outboxText =
      outbox && 'error' in outbox
        ? `outbox error: ${String(outbox.error)}`
        : `outbox sent=${String(outbox?.sent ?? 0)} failed=${String(outbox?.failed ?? 0)}`
    console.log(
      `[ticker] ${stamp()} ok in ${elapsed}ms: claimed=${String(body.claimed ?? 0)} ` +
        `done=${String(body.done ?? 0)} failed=${String(body.failed ?? 0)} ${outboxText}`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[ticker] ${stamp()} request failed: ${message}`)
  } finally {
    clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  const { url, secret, intervalMs, maxTicks } = readConfig()
  console.log(`[ticker] ${stamp()} starting: ${url} every ${intervalMs}ms${maxTicks ? ` (max ${maxTicks} ticks)` : ''}`)

  let stopping = false
  const stop = (signal: string) => {
    if (stopping) return
    stopping = true
    console.log(`[ticker] ${stamp()} ${signal} received, stopping after the current tick`)
  }
  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))

  let ticks = 0
  while (!stopping) {
    await tickOnce(url, secret)
    ticks++
    if (maxTicks && ticks >= maxTicks) break
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  console.log(`[ticker] ${stamp()} stopped after ${ticks} tick(s)`)
}

void main()
