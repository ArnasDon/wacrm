-- ============================================================
-- Migration 061 — Lead qualification score & Google Gemini provider.
--
-- 1. Adds a `lead_score` column on `conversations` so inbound messages
--    can be auto-qualified as hot / warm / cold.
-- 2. Adds 'google' to the allowed AI providers on `ai_configs`
--    and `ai_usage_log`.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS lead_score TEXT
  CHECK (lead_score IN ('hot', 'warm', 'cold'));

CREATE INDEX IF NOT EXISTS idx_conversations_lead_score
  ON conversations(lead_score)
  WHERE lead_score IS NOT NULL;

COMMENT ON COLUMN conversations.lead_score IS
  'AI-inferred lead temperature: hot | warm | cold. NULL = not yet scored.';

-- Allow 'google' in ai_configs provider check
ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'openai_compatible', 'google'));

-- Allow 'google' in ai_usage_log provider check
ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'openai_compatible', 'google'));
