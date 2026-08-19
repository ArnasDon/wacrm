-- ============================================================
-- 043_ai_deepseek_provider.sql — add DeepSeek as an AI provider option
--
-- DeepSeek's Chat Completions API is OpenAI-compatible (see
-- src/lib/ai/providers/deepseek.ts — it's `generateOpenAi` pointed at a
-- different base URL, not a new adapter), so the only schema change
-- needed is widening the two `provider` CHECK constraints that
-- previously only allowed 'openai'/'anthropic'.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'deepseek'));

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'deepseek'));
