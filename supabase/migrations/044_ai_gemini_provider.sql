-- Migration 044: Allow 'gemini' as an AI provider in ai_configs and ai_usage_log
-- Expands the provider CHECK constraints to support Google Gemini.

DO $$
BEGIN
  -- 1. Update ai_configs provider check constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_configs'
  ) THEN
    ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
    ALTER TABLE ai_configs ADD CONSTRAINT ai_configs_provider_check
      CHECK (provider IN ('openai', 'anthropic', 'gemini'));
  END IF;

  -- 2. Update ai_usage_log provider check constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_usage_log'
  ) THEN
    ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;
    ALTER TABLE ai_usage_log ADD CONSTRAINT ai_usage_log_provider_check
      CHECK (provider IN ('openai', 'anthropic', 'gemini'));
  END IF;
END $$;
