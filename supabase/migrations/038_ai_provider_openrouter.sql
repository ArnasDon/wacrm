-- ============================================================
-- 037_ai_provider_openrouter
--
-- Allow 'openrouter' as an AI provider.
--
-- OpenRouter is a gateway rather than a first-party lab: one key
-- reaches its whole catalogue, and the existing free-text `model`
-- column selects which one (`vendor/model-id`, e.g.
-- `anthropic/claude-sonnet-4.5`). So nothing about the schema changes
-- beyond widening the two provider CHECK constraints — migration 029
-- (`ai_configs`) and migration 033 (`ai_usage_log`) both pinned the
-- allowed set to ('openai', 'anthropic').
--
-- Both constraints carry Postgres' default name for an inline CHECK on
-- a TEXT column (`<table>_provider_check`), so they can be dropped by
-- name and re-added widened — the same DROP IF EXISTS / ADD pattern
-- migration 010 used to widen `messages_content_type_check`.
--
-- Idempotent — safe to run multiple times. Widening a CHECK never
-- invalidates existing rows, so no data is touched or lost.
-- ============================================================

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'openrouter'));

-- The usage log records the provider each call was billed against, so
-- it has to accept the same set or every OpenRouter reply would fail
-- its (best-effort, swallowed) usage insert and spend would silently
-- stop being recorded.
ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'openrouter'));
