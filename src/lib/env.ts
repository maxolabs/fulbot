import * as z from 'zod/mini'

// Runtime validation of the environment the app cannot work without. Fails
// with a message that names the variable instead of a `!` assertion turning
// into "Cannot read properties of undefined" deep inside @supabase/ssr.
//
// NEXT_PUBLIC_* values are inlined at build time, so each one is read with a
// literal `process.env.X` (a dynamic lookup would be empty in the browser).
//
// Server and middleware only, with zod/mini to keep the edge middleware
// small. The browser client (supabase/client.ts) has its own plain check, so
// zod stays out of the browser bundle.
//
// The build-time check lives in next.config.mjs (plain JS, which cannot import
// TypeScript on Next 14): it resolves the public app URL with the same rules
// as resolveAppUrl() in app-url.ts and fails a CI or Vercel build that has
// none.

const supabaseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: 'NEXT_PUBLIC_SUPABASE_URL must be the project URL (https://<ref>.supabase.co)' }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string({ error: 'NEXT_PUBLIC_SUPABASE_ANON_KEY is not set' }).check(z.minLength(1, { error: 'NEXT_PUBLIC_SUPABASE_ANON_KEY is not set' })),
})

export interface SupabasePublicEnv {
  url: string
  anonKey: string
}

let cachedSupabaseEnv: SupabasePublicEnv | null = null

/** Supabase URL and anon key, validated once; throws a clear error when missing. */
export function getSupabasePublicEnv(): SupabasePublicEnv {
  if (cachedSupabaseEnv) return cachedSupabaseEnv
  const parsed = supabaseSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `- ${issue.message}`).join('\n')
    throw new Error(
      `Invalid Supabase configuration:\n${problems}\nSet them in .env.local (see .env.local.example) or in the deployment's environment variables (docs/deploy.md).`
    )
  }
  cachedSupabaseEnv = {
    url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }
  return cachedSupabaseEnv
}
