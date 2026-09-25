# UX/UI polish

Branch: `codex/ux-ui-polish`

Preserves the Pizarra/Papel palette, Syne and IBM Plex typography, flat surfaces,
dashed cards, and restrained orange actions.

## Review findings addressed

- The persistent dashboard layout could retain the previous group's title and
  mobile navigation destinations. The shell now resolves the current route and
  remembers the visited group for global pages.
- Mobile group dashboards hid create/invite controls. Both are now accessible
  above the next match; draft-only schedules have accurate empty-state copy.
- Desktop match entry relied on recognizing the date as a link. The full-width
  match-details footer now appears on desktop too.
- Match status/counts squeezed dates and venues on phones. Responsive rows give
  metadata a separate line, with a compact horizontal layout on wider screens.
- Injury badges squeezed player names. Mobile rows keep names and nicknames
  readable and place fitness status below the name.
- Desktop page headers now have a clearer divider, wrapping actions, and balanced
  content margins. Mobile navigation has an active indicator and hover feedback.
- Small buttons and segmented controls have larger touch targets. Mobile inputs
  use 16px text; browser zoom is enabled; native controls follow the theme.
- Keyboard users have a translated skip link and a global visible-focus fallback.
  Bottom actions and content clearance account for the device safe area.
- Password fields offer show/hide controls, meaningful autocomplete names, a
  persistent minimum-length hint, and focused mismatch feedback on registration.
- Invite opens a sheet with the selectable link (plus a copy-link button),
  WhatsApp and copy-message actions; copying reports success only after the
  clipboard write succeeds.
- Dashboard navigation has an accessible, reduced-motion-aware skeleton fallback.

## Verification

- `npm run lint`, `npm run type-check`, and `git diff --check` passed.
- `npm run build` passed in an isolated temporary copy. Existing Google Font
  downloads required network permission. The build reported existing Browserslist
  age and edge-runtime/static-generation notices.
- Browser review used the local seeded account and 320px, 390px, 1024px, and
  1440px viewport widths. Narrow player lists had no horizontal document overflow.
- Checked group list, group dashboards, player directory, profile, preferences,
  login, and registration. Verified group switching and retained navigation
  context through Profile, password show/hide and successful sign-in, keyboard
  theme selection, and skip-link focus transfer to main content.
- Inspected light and dark theme previews without saving preference changes.
- Registration submission and clipboard-denial fallback were reviewed in code;
  no account was created. Physical-device safe-area behavior still warrants a
  device check; browser viewports do not emulate a real home indicator.

## Deeper workflow changes

- Match detail now starts with an organizer panel: Inscripciones → Equipos →
  Resultado. Build teams, close/reopen registration, and finish the match are
  visible actions. Edit/cancel and announcement sharing remain in Gestionar.
- The mobile primary action stays visible above bottom navigation, including on
  long rosters. Passing the scheduled time no longer hides organizer actions;
  signup actions themselves stay hidden on past matches.
- Full capacity reads “Cupo completo” to distinguish it from a finished match.
- Team creation offers automatic balancing or manual assignment from scratch.
  Desktop has three drop zones, including empty teams. Mobile has team switches,
  live counts, tap-to-assign buttons, and native team/position selects. Search,
  level averages, assignment progress, validation, and persistent saving controls
  support both paths. Guests retain their separate identity when saving.
- Cancel and in-app links prompt before discarding an edited lineup; reloads use
  the browser's unsaved-change warning. Browser history navigation is not blocked.
- Saved positions drive the pitch and exported lineup geometry, rather than
  silently relabeling players into a size-based formation. Regeneration requires
  confirming that it replaces manual changes.
- Group overview puts team actions above a collapsible roster and gives drafts
  a clear review/open action. The match list separates “Por resolver” from past
  completed matches (admins only; members see past matches as before). Guests and balancing rules are visible disclosures on mobile.

## Publishing and rollout

Apply `supabase/migrations/00023_publish_match_teams.sql` before releasing this
version. Both manual and automatic generation call `publish_match_teams`, which
validates permissions, lifecycle, the complete confirmed roster, unique player
identities, positions, and team sizes. Saving assignments, updating match status,
and queuing the existing team notification happen in one transaction; failures
preserve the previous lineup. Manual saves clear stale AI analysis.

The migration was applied and tested only against the local Docker Supabase
instance. No remote database or deployment was changed.

## Additional verification

- TypeScript, lint, isolated production build, and four team-builder/formation
  tests passed. PostgreSQL rollback tests cover authenticated publishing,
  duplicate/missing/outsider players, invalid positions, uneven teams, restricted
  roles, and finished-match rejection.
- Local browser checks at 320px, 390px, and 1440px verified desktop dragging into
  an empty team, touch assignment, guest positions, unsaved-change confirmation,
  publishing, persisted teams after reload, and editing saved teams. Automatic
  regeneration was checked using the deterministic fallback (no OpenAI key).
- Close/reopen registration controls were exercised on a disposable local match.
  Temporary match/notification data was removed after verification. The original
  seeded match was used for read-only visual review.
- Mobile team view had no horizontal overflow at 320px. Physical touch dragging
  and device safe areas still need real-device testing; mobile assignment also
  works without dragging.

## Review follow-up (2026-09-24)

Independent review of this branch; fixes applied on top:

- `00022_device_push.sql` failed on Supabase (`uuid_generate_v4()` is not on the
  function's `search_path`); now `gen_random_uuid()`. Members can no longer call
  `emit_notification` directly (it now reaches lock screens); the dashboard's
  lazy `match_created` emit uses the service role. Subscriptions are inserted
  only through `/api/push/subscription` (validated, max 10 devices per user);
  clients keep read/delete. Result reminders skip players who already reported;
  cancelled/past matches also suppress `waitlist_promoted`. Settled deliveries
  are purged after 7 days. SQL tests extended.
- `00023_publish_match_teams.sql` announces `teams_created` only on the first
  publish; later edits no longer ping the group (tested).
- Push: republished teams/results replace the previous alert (per-match tag);
  SW click falls back when `navigate()` throws; `pushsubscriptionchange`
  re-registers; invalid VAPID settings disable push instead of failing every
  send. The settings card shows a status badge, retry after load errors,
  busy labels, dismissed-prompt feedback, re-checks on return from settings,
  drops a browser subscription the server doesn't know for this account, and
  hides itself when push isn't configured.
- Team builder: AI output limited to valid position codes (invalid output uses
  the retry/fallback path); legacy/free-text positions normalized to `CM`; a
  failed save refreshes and merges the confirmed roster instead of losing the
  draft; errors are localized; focus moves to the editor; the mobile tab
  switches to a team when the pool empties; drag overlay has no shadow.
- One orange per screen on the match page: workflow links that the mobile
  ActionBar already carries are desktop-only; the header “Ver equipos” shows
  only for members; members don't see organizer copy. New copy for closed
  signups below the minimum. Guest form ids no longer duplicate.
- 16px mobile text now also applies to selects/textareas with `text-sm`;
  segmented controls are 44px; light focus ring deepened to 3.8:1; focus
  fallback covers `summary`; disclosure summaries have 44px targets; hover
  tints only on hover-capable pointers; WhatsApp team text localized; share
  image falls back to a primary Download where file sharing isn't supported.
