import localFont from 'next/font/local'

// Pizarra type (docs/ui-rework/01-brand.md §2): Syne for display, IBM Plex
// Sans for body, IBM Plex Mono for eyebrows, counts and positions. Exposed as
// CSS variables on <html> by the root layout and global-error;
// tailwind.config.ts maps them to font-display / font-sans / font-mono.
//
// Self-hosted (next/font/local) so a build never fetches Google Fonts: the
// Sep 25 production build failed inside next/font/google. The woff2 files in
// src/assets/fonts are built by scripts/build-fonts.py from the google/fonts
// sources and match what next/font/google served: Syne and IBM Plex Sans as
// the same variable files (Plex Sans pinned to normal width), IBM Plex Mono as
// static Regular and Medium, the latin + latin-ext (+ vietnamese for Plex)
// subsets, and only the weights declared below. Licences: OFL-*.txt there.
//
// Each weight is its own @font-face pointing at the shared variable file,
// as next/font/google declared them, so the browser snaps to these weights.

export const fontDisplay = localFont({
  src: [
    { path: '../assets/fonts/Syne-Variable.woff2', weight: '700', style: 'normal' },
    { path: '../assets/fonts/Syne-Variable.woff2', weight: '800', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-display',
})

export const fontBody = localFont({
  src: [
    { path: '../assets/fonts/IBMPlexSans-Variable.woff2', weight: '400', style: 'normal' },
    { path: '../assets/fonts/IBMPlexSans-Variable.woff2', weight: '500', style: 'normal' },
    { path: '../assets/fonts/IBMPlexSans-Variable.woff2', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-body',
})

export const fontMono = localFont({
  src: [
    { path: '../assets/fonts/IBMPlexMono-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../assets/fonts/IBMPlexMono-Medium.woff2', weight: '500', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-mono',
})

/** The three font variables, for the className of an <html> element. */
export const fontVariables = [fontDisplay.variable, fontBody.variable, fontMono.variable].join(' ')
