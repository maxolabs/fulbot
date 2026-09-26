import { PHASE_PRODUCTION_BUILD } from 'next/constants.js'

// Build-time environment check (PLAT-9). Mirrors resolveAppUrl() in
// src/lib/app-url.ts; this file is plain JS and cannot import TypeScript on
// Next 14. The runtime checks live in src/lib/env.ts.
//
// The public app URL builds every link that leaves the app (invites, WhatsApp
// texts, share sheets, Open Graph). Without it those links point at
// localhost, so a CI or Vercel build (or any build with FULBOT_STRICT_ENV=1)
// fails; a local `next build` only warns.
function resolveAppUrl() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
  return null
}

const strictEnv = Boolean(process.env.CI || process.env.VERCEL || process.env.FULBOT_STRICT_ENV)
const appUrl = resolveAppUrl()

function checkBuildEnv() {
  const missing = []
  if (!appUrl) missing.push('NEXT_PUBLIC_APP_URL (or VERCEL_PROJECT_PRODUCTION_URL on Vercel)')
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (missing.length > 0) {
    const message = `Missing environment variables: ${missing.join(', ')}. See docs/deploy.md.`
    if (strictEnv) throw new Error(message)
    // Build workers load this file again and inherit the env: warn once.
    if (!process.env.FULBOT_ENV_WARNED) {
      process.env.FULBOT_ENV_WARNED = '1'
      const hint = appUrl ? '' : ' Invite and share links will use http://localhost:3000.'
      console.warn(`\n[fulbot] ${message}${hint}\n`)
    }
  }
}

// Security headers (PLAT-10). frame-ancestors keeps the one-tap public /m
// page (and everything else) out of other sites' iframes; the rest of the
// CSP is left to a later pass because Next inlines scripts.
const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
]

/** @type {import('next').NextConfig} */
const baseConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // Inline the resolved URL so client code sees the Vercel fallback too.
  env: appUrl ? { NEXT_PUBLIC_APP_URL: appUrl } : {},

  // `next build`'s bundled ESLint integration predates flat config and can't
  // see eslint.config.mjs; `npm run lint` (plain `eslint .`) is the source of
  // truth for linting instead.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Image optimization configuration
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

/** @param {string} phase */
export default function nextConfig(phase) {
  if (phase === PHASE_PRODUCTION_BUILD) checkBuildEnv()
  return baseConfig
}
