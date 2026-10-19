-- ============================================================
-- 042_message_failure_reason
--
-- Issue #535. When Meta cannot deliver an outbound message it posts a
-- `failed` status webhook whose `errors[0]` carries the reason — a
-- stable numeric `code` (131049 "per-user marketing limit", 131026
-- "undeliverable", 131047 "re-engagement window closed", ...), a short
-- `title`, and a human-readable `error_data.details`. The webhook
-- handler wrote only `status = 'failed'` and dropped the rest, so an
-- agent staring at a red X in the inbox had no way to tell a blocked
-- number from an expired template from an account-level cap.
--
-- Two changes:
--
--   1. `messages.error_code` / `error_title` / `error_details` — the
--      three pieces Meta sends, stored separately so the code stays
--      filterable and the details stay readable. All nullable: they are
--      only populated on a `failed` status and are deliberately NOT
--      cleared if a later non-failed status arrives for the same wamid
--      (rare, but Meta does not promise ordering), so the reason is
--      never lost to a race.
--
--   2. Nothing on `broadcast_recipients`. That table already has a
--      free-text `error_message` column (migration 001) which the
--      sender populates on synchronous API failures; the webhook now
--      writes "[code] title: details" into the same column for
--      asynchronous ones, so the broadcast detail page's existing
--      error column shows both without a schema change there.
--
-- No backfill is possible: the failure payloads that were already
-- received were discarded at the door.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS error_code INTEGER,
  ADD COLUMN IF NOT EXISTS error_title TEXT,
  ADD COLUMN IF NOT EXISTS error_details TEXT;

COMMENT ON COLUMN messages.error_code IS
  'Meta''s numeric error code from a failed status webhook (errors[0].code). '
  'NULL unless the message failed. Not cleared by a later status update.';

COMMENT ON COLUMN messages.error_title IS
  'Meta''s short error label from a failed status webhook (errors[0].title). '
  'NULL unless the message failed.';

COMMENT ON COLUMN messages.error_details IS
  'Meta''s human-readable explanation from a failed status webhook '
  '(errors[0].error_data.details). NULL unless the message failed and Meta '
  'supplied details.';
