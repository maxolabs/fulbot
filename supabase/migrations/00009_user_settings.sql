-- fulbot rework T6: user settings
-- Adds per-user notification preferences (keys: waitlist_promoted, teams_created,
-- match_reminder, results_posted — all boolean, default true when present via app code).

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
