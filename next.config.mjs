/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,

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
}

export default nextConfig
