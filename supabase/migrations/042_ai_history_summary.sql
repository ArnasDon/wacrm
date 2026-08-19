-- ============================================================
-- 042_ai_history_summary.sql — configurable, summarized conversation
-- history for the AI agent
--
-- `buildConversationContext` sends the last N text messages verbatim;
-- once a conversation exceeds N, older messages are silently dropped.
-- This adds an OPT-IN alternative: summarize what falls off the window
-- instead of losing it, incrementally (each turn only summarizes the
-- NEW delta that just aged out, never the whole history again).
--
--   - `ai_configs.context_message_limit` — per-account window size,
--     replacing the env-only `AI_CONTEXT_MESSAGE_LIMIT` default. 20
--     matches today's default, so unchanged unless an admin edits it.
--   - `ai_configs.summarize_history` — the opt-in switch. FALSE by
--     default: zero added cost/latency/behaviour until a business turns
--     it on.
--   - `conversations.ai_history_summary` /
--     `ai_history_summary_covers_count` — the running summary and how
--     many of the oldest text messages it already covers, so
--     `buildContextWithHistorySummary` (src/lib/ai/context.ts) only ever
--     summarizes the delta since the last turn.
--   - `ai_usage_log.mode` widened to add `'history_summary'` so the
--     summarization LLM call gets its own visible line in Usage rather
--     than being invisible or misattributed to `'auto_reply'`.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS context_message_limit integer NOT NULL DEFAULT 20
    CHECK (context_message_limit BETWEEN 4 AND 50);

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS summarize_history boolean NOT NULL DEFAULT false;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_history_summary text;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_history_summary_covers_count integer NOT NULL DEFAULT 0;

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'history_summary'));
