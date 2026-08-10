-- ============================================================
-- 052_learning.sql — BLOCO 4/4: aprendizado supervisionado da IA
--
-- No new tables. Learnings ride on `ai_suggestions` (category
-- 'learning', already in the CHECK since migration 049) with
-- everything category-specific in `payload` — same pattern as
-- pipeline_move (BLOCO 2) and followup (BLOCO 3). Approving a
-- learning writes into the account's EXISTING knowledge base
-- (`ai_knowledge_documents` / `ai_knowledge_chunks`, migration 030,
-- via the existing `ingestDocument()`), never a new store — this is
-- what "o conhecimento passa a integrar a base utilizada pela IA"
-- means concretely: the same base `retrieveKnowledge()` already
-- feeds into drafts/auto-reply.
--
-- Two small additions:
--
--   1. ai_configs.learning_last_scanned_at — the cron's cursor, so
--      each run only scans messages since the last scan (same cost
--      discipline as lead_intelligence.last_message_id in BLOCO 2)
--      instead of re-reading the account's whole history every time.
--
--   2. ai_usage_log.mode gains 'learning'.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS learning_last_scanned_at timestamptz;

ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'lead_analysis', 'followup', 'learning'));
