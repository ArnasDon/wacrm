-- ============================================================
-- 051_followup.sql — BLOCO 3/4: follow-up inteligente
--
-- Two small, additive changes on top of the ai_suggestions /
-- ai_usage_log foundation from BLOCOS 1-2 — no new tables, no new
-- categories (ai_suggestions already has 'followup' from migration
-- 049), no duplicate template/history system.
--
--   1. ai_suggestions.snoozed_until — backs "Adiar". A snoozed
--      suggestion stays status='pending' (it isn't resolved, just
--      postponed) but the list route excludes it from the default
--      pending view until this timestamp passes, at which point it
--      resurfaces on its own — no separate "postponed" status value,
--      no second place to look for it.
--
--   2. ai_usage_log.mode gains 'followup' — the candidate-scoring
--      cron and the message-drafting calls both log through the same
--      cost ledger as lead_analysis/auto_reply/draft.
--
--   3. An index to make "conversations quiet for N hours" (the
--      follow-up candidate scan) a cheap query instead of a seq scan.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_suggestions
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'lead_analysis', 'followup'));

CREATE INDEX IF NOT EXISTS idx_conversations_account_last_message
  ON conversations(account_id, last_message_at);
