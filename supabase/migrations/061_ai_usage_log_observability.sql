-- ============================================================
-- 061_ai_usage_log_observability.sql — Punto 8 audit, hallazgos
-- H8-1 (finish_reason/stop_reason), H8-2 (registro de fallos de
-- generateReply), F-2 (cached_tokens de OpenAI/OpenRouter).
--
-- H8-1 / F-2: purely additive, nullable columns — no existing row is
-- affected, every row logged before this migration reads back as
-- "not computed" (NULL), never a misleading zero/false. F-2 reuses the
-- EXISTING cache_read_input_tokens column (migration 051) rather than
-- adding a parallel one: conceptually it is the same thing (tokens
-- served from a previously-cached prefix, billed at a discount) for
-- whichever provider reports it — `provider` (already on every row)
-- disambiguates Anthropic's mechanism from OpenAI/OpenRouter's.
--
-- H8-2: today, `ai_usage_log` only ever gets a row on a SUCCESSFUL
-- generateReply() call (src/lib/ai/usage.ts's own `if (!args.usage)
-- return` guard) — a failed attempt (timeout, invalid key, rate limit,
-- network error, malformed provider response) leaves no trace beyond
-- an ephemeral console.error. To let a failed attempt still write a
-- row with NULL tokens (never 0 — a real distinction: "we don't know"
-- vs. "we measured zero"), the three original token columns
-- (029_ai_reply.sql: prompt_tokens/completion_tokens/total_tokens,
-- NOT NULL DEFAULT 0) must first become nullable. This is a strict
-- widening — every existing row already holds a real, valid integer,
-- so relaxing the constraint changes nothing about data already
-- written, and every application code path that reads these columns
-- already handles other nullable numeric columns on this same table
-- (e.g. latency_ms) the same way.
--
-- Never touches RLS: same table, same existing SELECT (admin+) / no
-- `authenticated` write policy from migration 033 — a new nullable
-- column needs no new policy.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_usage_log
  ALTER COLUMN prompt_tokens DROP NOT NULL,
  ALTER COLUMN prompt_tokens DROP DEFAULT,
  ALTER COLUMN completion_tokens DROP NOT NULL,
  ALTER COLUMN completion_tokens DROP DEFAULT,
  ALTER COLUMN total_tokens DROP NOT NULL,
  ALTER COLUMN total_tokens DROP DEFAULT;

ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS finish_reason text,
  ADD COLUMN IF NOT EXISTS tool_turns_exhausted boolean,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text;

COMMENT ON COLUMN ai_usage_log.finish_reason IS
  'Raw finish_reason (OpenAI/OpenRouter) or stop_reason (Anthropic) reported by the provider for the last turn of this call. Deliberately NOT normalized across providers — see ProviderResult.finishReason (src/lib/ai/types.ts). NULL when the provider did not report one, or the row predates this column.';

COMMENT ON COLUMN ai_usage_log.tool_turns_exhausted IS
  'True only when MAX_TOOL_TURNS cut the tool-calling loop off while the model still wanted to call another tool (as opposed to the model naturally deciding to answer in text). Purely diagnostic — never changes the existing fallback behavior. NULL when not computed (no tools attached this call, or the row predates this column).';

COMMENT ON COLUMN ai_usage_log.error_code IS
  'Set only on a FAILED generateReply() attempt (H8-2) — one of the existing AiError.code values (invalid_key/rate_limited/provider_error/timeout/network_error/empty_response/unsupported_provider) or unknown_error for a non-AiError exception. NULL for every successful generation.';

COMMENT ON COLUMN ai_usage_log.error_message IS
  'Short (<=500 char), length-capped description of a failed attempt — never a raw provider response body, never headers, never the API key, never a prompt. NULL for every successful generation.';
