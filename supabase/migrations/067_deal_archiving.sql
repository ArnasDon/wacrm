-- ============================================================
-- 067_deal_archiving.sql — Leads Arquivados
--
-- A deal leaving the active Pipeline board is not the same fact as
-- winning/losing it (deals.status already means that, see
-- 002_pipelines_enhancements.sql) and not the same as deleting the
-- lead (contacts row + cascades). `archived_at` is a third,
-- orthogonal fact: "hidden from the active board", independent of
-- status and reversible at any time. A nullable timestamp (not a
-- boolean) matches this codebase's own convention for this kind of
-- flag (notifications.read_at, ai_suggestions.resolved_at,
-- ai_suggestions.snoozed_until) and gives "when" for free.
--
-- No RLS change needed — deals_update already allows any account
-- member with 'agent'+ to write any column (017_account_sharing.sql).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE deals ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_deals_pipeline_archived
  ON deals (pipeline_id, archived_at);
