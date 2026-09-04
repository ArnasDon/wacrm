-- ============================================================
-- 051_ai_usage_log_cache_tokens
--
-- AI optimization project — Usage + OpenRouter integration phase.
--
-- Anthropic prompt caching (FASE 8, migration-free at the time — it
-- only changed the outbound request shape) can make the Messages API
-- report two EXTRA usage fields the current schema has nowhere to put:
-- `cache_creation_input_tokens` (tokens spent writing a new cache
-- entry) and `cache_read_input_tokens` (tokens served from an existing
-- one, billed at a steep discount). Both are strictly separate from
-- `input_tokens`/`prompt_tokens` — Anthropic already reports that field
-- net of both — so folding them into prompt_tokens would silently
-- under-count total context processed on a cache-write turn, and
-- leaving them uncaptured entirely would make Usage quietly wrong the
-- moment caching is actually exercised in production.
--
-- Purely additive: two new NULLABLE integer columns, no default. NULL
-- (never 0) whenever a call didn't report them — every OpenAI/
-- OpenRouter row, and any Anthropic row from before this migration or
-- from a call that didn't trigger caching. Existing rows and the three
-- pre-existing token columns are completely untouched.
-- ============================================================

ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS cache_creation_input_tokens integer,
  ADD COLUMN IF NOT EXISTS cache_read_input_tokens integer;

COMMENT ON COLUMN ai_usage_log.cache_creation_input_tokens IS
  'Anthropic prompt caching only (FASE 8) — tokens spent writing a new cache entry this call. NULL when not reported (every non-Anthropic call, and an Anthropic call with no active cache breakpoint).';

COMMENT ON COLUMN ai_usage_log.cache_read_input_tokens IS
  'Anthropic prompt caching only (FASE 8) — tokens served from an existing cache entry this call, billed at a discount. NULL when not reported.';
