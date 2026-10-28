-- ============================================================
-- 080_deepseek_provider.sql
--
-- Adds support for DeepSeek as an alternative AI provider:
-- 1. Adds `deepseek_api_key` column (AES-256-GCM encrypted) to `ai_configs`
--    so accounts can configure and toggle between OpenAI and DeepSeek
--    without overwriting or losing their OpenAI API credentials.
-- 2. Expands provider CHECK constraint on `ai_configs` to include 'deepseek'.
-- 3. Expands provider CHECK constraint on `ai_usage_log` to include 'deepseek'.
--
-- Idempotent and safe to apply.
-- ============================================================

-- 1. Add deepseek_api_key column to ai_configs
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS deepseek_api_key text;

-- 2. Expand provider constraint on ai_configs
ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'deepseek'));

-- 3. Expand provider constraint on ai_usage_log
ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'deepseek'));
