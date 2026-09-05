-- ============================================================
-- 103_task_google_sync.sql
--
-- Lets a CRM task (migration 097) mirror into Google Tasks — the
-- "Tasks" panel inside Google Calendar's own UI — for accounts that
-- have Google Calendar connected. See src/lib/google-calendar/
-- tasks-api.ts for the sync calls and src/app/api/tasks/*.ts for
-- where they're wired in (create/update/complete/delete).
--
-- `google_task_list_id` is always literally '@default' today (the one
-- list every Google account has) — stored rather than hardcoded at
-- every call site so a future "pick a list" setting doesn't need a
-- backfill. Both columns stay NULL for a task whose account never had
-- Google Calendar connected, or whose sync attempt failed (best-
-- effort, never blocks the underlying CRM task) — callers treat NULL
-- as "not mirrored", never as an error.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS google_task_id TEXT,
  ADD COLUMN IF NOT EXISTS google_task_list_id TEXT;
