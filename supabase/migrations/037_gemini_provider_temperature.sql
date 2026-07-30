-- ============================================================
-- 037_gemini_provider_temperature
--
-- Two additions to the BYO-key AI assistant (migration 029):
--
--   1. Google Gemini as a third provider alongside OpenAI and
--      Anthropic — widen the `provider` CHECK on both `ai_configs`
--      and `ai_usage_log` (033) to allow 'gemini'.
--   2. A per-account sampling `temperature`, clamped to [0, 1] — the
--      range valid across all three providers (Anthropic caps at 1;
--      OpenAI/Gemini allow up to 2). Default 1.0 matches each
--      provider's own implicit default when the param was omitted
--      (the previous behaviour of every adapter), so existing rows
--      keep generating exactly as before until an admin dials it in.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS temperature numeric NOT NULL DEFAULT 1.0
    CHECK (temperature >= 0 AND temperature <= 1);

ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'gemini'));

ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'gemini'));
