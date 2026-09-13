# 01 · Brand: tokens, type, shape, marks

Direction C "Pizarra" from `branding-proposals.html`, applied to the name **fulbot**.
The metaphor is the coach's chalkboard: a slate-green board, chalk-white lines and text,
one cone-orange for the single thing to do on a screen.

## 1. Palette

The app already drives colour through HSL variables in `src/app/globals.css` consumed by
`tailwind.config.ts` (`hsl(var(--x))`). The rework **replaces the values, not the
mechanism**. Because Tailwind composes `hsl(var(--border))` without alpha, every token is a
solid colour; chalk transparency is baked in (mixed over the surface it sits on).

### Dark · "Pizarra" (default, `.dark` on `<html>`)

| Token | HSL | Hex | Role |
|---|---|---|---|
| `--background` | `162 36% 14%` | `#173129` | the board |
| `--card` / `--popover` | `159 34% 17%` | `#1C392F` | surface |
| `--secondary` / `--muted` / `--accent` | `158 32% 22%` | `#264A3D` | raised surface, hover, avatars |
| `--foreground` / `--card-foreground` | `46 35% 93%` | `#F3F0E6` | chalk |
| `--muted-foreground` | `146 12% 66%` | `#9FB4A8` | faded chalk |
| `--border` / `--input` | `150 9% 42%` | `#61746A` | chalk at 32% over surface |
| `--primary` | `24 100% 62%` | `#FF8A3D` | cone orange |
| `--primary-foreground` | `0 0% 10%` | `#1A1A1A` | text on orange, **never white** |
| `--ring` | `24 100% 62%` | | focus ring = cone |
| `--destructive` | `4 85% 70%` | `#F47A71` | raised from `4 72% 55%` for the 4.5:1 floor |
| `--destructive-foreground` | `0 0% 10%` | `#1A1A1A` | ink on destructive, **never chalk** |

### Light · "Papel"

| Token | HSL | Hex | Role |
|---|---|---|---|
| `--background` | `46 35% 93%` | `#F3F0E6` | paper |
| `--card` / `--popover` | `45 50% 97%` | `#FBF9F3` | |
| `--secondary` / `--muted` / `--accent` | `44 30% 89%` | `#EAE5D8` | |
| `--foreground` | `162 36% 14%` | `#173129` | board-green ink |
| `--muted-foreground` | `154 8% 40%` | `#5E6E66` | |
| `--border` / `--input` | `43 16% 79%` | `#D3CFC2` | |
| `--primary` | `24 87% 55%` | `#F07A2A` | cone, one step deeper for contrast on paper |
| `--primary-foreground` | `0 0% 10%` | | |
| `--ring` | `24 87% 55%` | | |
| `--destructive` | `4 70% 45%` | | |

### Fixed colours (not themed)

| Name | Hex | Use |
|---|---|---|
| Team dark ("Oscuras") | `#1C1C1E` | lineup dots, team headers, export image |
| Team light ("Claras") | `#F3F0E6` | same, with `#1B1F2A` text |
| Pitch | `#173129` in both themes | the pitch is always a board |
| Chalk line | `rgba(243,240,230,.75)` | pitch markings, dashed |
| Success | `152 45% 52%` `#4CB57F` | "Inscripción abierta", confirmed, consensus reached |
| Warning | `40 90% 55%` `#F2B53A` | waitlist, provisional result |

Replace the hard-coded Tailwind `green-500` / `yellow-500` in `Badge` with the success and
warning tokens (`--success`, `--warning`, plus `-foreground`), added to `globals.css` and
`tailwind.config.ts` the same way as the others. Remove `.glow-sm` / `.glow-md`; the board
does not glow.

### Rules

- One orange per screen: the primary action. Secondary buttons are chalk outline. If two
  things on a screen are orange, one of them is wrong.
- Orange always carries dark ink (`--primary-foreground`), in both themes.
- Text on the board is chalk, never pure white; muted text is faded chalk, never grey.
- Semantic colours (success, warning, destructive) never appear on buttons except
  destructive.

## 2. Type

Loaded with `next/font/google` in `src/app/layout.tsx`, exposed as CSS variables and
mapped in `tailwind.config.ts` (`fontFamily.display`, `fontFamily.sans`, `fontFamily.mono`).
Inter is removed.

| Role | Face | Weights | Where |
|---|---|---|---|
| Display | **Syne** | 700, 800 | page titles, match date, team names, wordmark, big numbers |
| Body | **IBM Plex Sans** | 400, 500, 600 | everything else |
| Mono | **IBM Plex Mono** | 400, 500 | eyebrows, positions (`GK`, `CM`), counts (`11 / 14`), times, table numbers, list indices |

Scale (Tailwind classes, mobile → `lg`):

| Element | Class |
|---|---|
| Page title | `font-display text-2xl lg:text-3xl font-extrabold tracking-tight` |
| Hero (match date on the match screen) | `font-display text-3xl lg:text-4xl font-extrabold` |
| Section title (card) | `font-display text-base font-bold` |
| Eyebrow | `font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground` |
| Body | `text-sm` (14px) mobile, `text-[15px]` on `lg` in reading areas |
| Meta | `text-xs text-muted-foreground` |
| Numbers | `font-mono tabular-nums` |

`text-wrap: balance` on titles. Display face never below 16px; mono never for sentences.

## 3. Shape

- `--radius: 0.25rem` (4px). Cards and inputs `rounded-md`; buttons `rounded` (3px, override
  in the cva base); avatars stay circles; pitch `rounded-sm`.
- **Chalk rule**: cards and the pitch use `border-dashed`; buttons, inputs, tabs, tables
  use solid 1px. Dashed is the brand, so it is rationed: at most the card outlines and the
  pitch on any screen. Nested cards are not dashed (use a solid `border-t` divider instead).
- Board texture: `body` gets `background-image: radial-gradient(hsl(var(--foreground) / .045) 1px, transparent 1px); background-size: 7px 7px` in dark only (chalk dust). Cards are flat on top of it.
- No shadows except sheets and popovers (`shadow-lg shadow-black/40`).
- Icons: `lucide-react`, `strokeWidth={1.75}`, 16px inline and 20px in nav.

## 4. Wordmark and mark

- **Wordmark**: `fulbot` lowercase in Syne 800, letter-spacing `-0.01em`. `ful` in chalk,
  `bot` in cone orange, exactly as today's header does with the primary colour. On paper:
  `ful` in board-green ink, `bot` in orange.
- **Mark** (icon, favicon, PWA, sidebar): a board-green rounded square (radius 22% of side)
  with an inset dashed chalk border (inset 12%, 2px, dash 6/4) and the two chalk glyphs
  `X O` in Syne 800 centred, tracking `-0.04em`. The glyphs are the tactics board; they do
  not spell anything. Rendered as SVG in `public/icons/icon-192.svg` and `icon-512.svg`
  (maskable: keep the glyphs inside the inner 80%).
- Sidebar brand: mark at 22px + wordmark at 15px. Mobile top bar on the group dashboard
  shows the wordmark alone; other mobile screens show the screen title instead.

## 5. PWA and metadata

- `public/manifest.json`: `theme_color` `#173129`, `background_color` `#173129`,
  `short_name` `fulbot`, `name` `fulbot — Organizá tus partidos`.
- `viewport.themeColor` in `layout.tsx`: `#173129`; `appleWebApp.statusBarStyle` stays
  `black-translucent`.
- Login, register, `/invite`, `/m/[matchId]` render on the board in both themes (see `03-screens.md` §12).

## 6. Exported lineup image (`/api/export/lineup-image`)

Same language as the web pitch so the WhatsApp image is recognisably the app:

- Canvas `#173129`, dashed chalk markings (`@vercel/og` supports `borderStyle: 'dashed'`
  on divs; draw the outline, halfway line and the two boxes as bordered divs, the centre
  circle as a dashed-border circle).
- Header: wordmark (`fulbot`, `bot` in `#FF8A3D`), match date and time in IBM Plex Mono.
- Dots: 44px circles, `#1C1C1E` / `#F3F0E6`, 2px chalk stroke, initials in Syne 800,
  name below in IBM Plex Mono 13px chalk.
- Team panels: name in Syne, "7 jugadores" in mono; ratings stay hidden (as today).
- Fonts: `@vercel/og` needs font files. Add `src/assets/fonts/Syne-ExtraBold.ttf` and
  `IBMPlexMono-Medium.ttf` (OFL, from Google Fonts) and pass them via `fonts: [...]`.
  No `system-ui` fallback in the image; it must match the app.
