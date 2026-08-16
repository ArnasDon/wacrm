-- ============================================================
-- 043_data_deletion_insert_failures.sql, retry queue for RGPD
-- deletion-request INSERTs that fail transiently.
--
-- Context: src/lib/eter/data-deletion.ts previously called
-- createDeletionRequest() with no dedicated error handling of its
-- own. The webhook route (src/app/api/whatsapp/webhook/route.ts)
-- wraps the WHOLE handleInboundDataDeletionRequest call in a
-- `.catch()` that logs and returns 'none' — meaning ANY unexpected
-- error from the INSERT (a transient DB blip, a connection reset) was
-- silently reinterpreted as "this wasn't an APAGAR command at all",
-- and execution fell through to flow/automation/AI dispatch as if the
-- lead had sent a normal message. The request was lost with no queue,
-- no retry, and no alert — exactly the same failure shape as the
-- AI SDR approval-forwarding incident this migration's sibling
-- (042_aisdr_approval_forward_queue.sql) fixed, applied here to the
-- RGPD deletion path per the same standard.
--
-- Design notes (mirrors aisdr_approval_forwards deliberately, per the
-- instruction to reuse that pattern rather than invent a new one)
--   - This table does NOT replace data_deletion_requests. It only
--     records a FAILED ATTEMPT to write into that table, so the
--     attempt can be retried instead of vanishing. A successful
--     createDeletionRequest() call never touches this table at all.
--   - Idempotency: a partial unique index caps at most one `failed`
--     row per (account_id, phone) — a lead re-sending "APAGAR" while
--     a previous attempt is still failing does not pile up duplicate
--     failure rows; the existing row's `attempts` is bumped instead
--     (see recordDeletionInsertFailure in
--     data-deletion-insert-failures.repo.ts).
--   - `status`: `failed` (queued for the reprocessing cron),
--     `recovered` (a later retry succeeded — data_deletion_requests
--     now has the real row), `gave_up` (the reprocessing cron
--     exhausted its retry budget — terminal, needs a human).
--   - No RLS-exposed end-user write path — internal operational
--     queue, service-role client only, same as aisdr_approval_forwards.
--
-- Idempotent, safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS data_deletion_insert_failures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id  uuid REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL,
  phone            text NOT NULL,
  profile_name     text,
  status           text NOT NULL DEFAULT 'failed'
                     CHECK (status IN ('failed', 'recovered', 'gave_up')),
  attempts         int NOT NULL DEFAULT 1,
  last_error       text,
  recovered_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_deletion_insert_failures_account_id_idx
  ON data_deletion_insert_failures (account_id);

-- Idempotency guard: at most one `failed` row per (account_id, phone) —
-- a repeated "APAGAR" while the previous attempt is still failing
-- bumps the existing row instead of creating a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS data_deletion_insert_failures_one_failed_per_phone
  ON data_deletion_insert_failures (account_id, phone)
  WHERE status = 'failed';

-- Reprocessing cron sweep: due `failed` rows, oldest first.
CREATE INDEX IF NOT EXISTS data_deletion_insert_failures_status_updated_at_idx
  ON data_deletion_insert_failures (status, updated_at);

ALTER TABLE data_deletion_insert_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS data_deletion_insert_failures_select ON data_deletion_insert_failures;
CREATE POLICY data_deletion_insert_failures_select ON data_deletion_insert_failures FOR SELECT
  USING (is_account_member(account_id));

CREATE OR REPLACE FUNCTION public.update_data_deletion_insert_failures_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS data_deletion_insert_failures_updated_at ON data_deletion_insert_failures;
CREATE TRIGGER data_deletion_insert_failures_updated_at
  BEFORE UPDATE ON data_deletion_insert_failures
  FOR EACH ROW
  EXECUTE FUNCTION public.update_data_deletion_insert_failures_updated_at();
