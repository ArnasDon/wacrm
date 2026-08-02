-- ============================================================
-- 033_ai_reply_polish.sql — AI reply assistant polish
--
-- Follow-ups to 029_ai_reply / 030_ai_knowledge that make the
-- auto-reply bot visible and controllable from the inbox, complete the
-- handoff, and record token spend:
--
--   1. messages.ai_generated       — marks a reply the bot sent (vs a
--                                     deterministic Flow/bot send), so
--                                     the inbox can badge it "AI".
--   2. ai_configs.handoff_agent_id — where a handed-off conversation is
--                                     routed. NULL = leave unassigned
--                                     (drop into the shared queue).
--   3. conversations.ai_handoff_summary
--                                  — a short internal note the bot writes
--                                    when it hands off, surfaced to the
--                                    agent who takes over.
--   4. ai_usage_log                — per-run provider token usage, for
--                                    cost visibility on the account's BYO
--                                    key. Written by the service role from
--                                    the draft route + auto-reply bot.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. Mark AI-generated messages.
--
-- Auto-replies are inserted as sender_type='bot' (same as Flow sends);
-- this column is the only thing that distinguishes an LLM reply from a
-- deterministic one, so the inbox can show the "AI" badge on the right
-- bubbles only.
-- ============================================================
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS ai_generated boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2. Handoff routing target + 3. handoff summary.
-- ============================================================
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS handoff_agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_handoff_summary text;

-- ============================================================
-- 4. Per-run token-usage log.
--
-- One row per LLM call (draft or auto-reply). Best-effort: the writer
-- never blocks a reply on a failed insert. Kept append-only; prune with
-- a scheduled job if it grows (an active account writes a handful of
-- rows per conversation).
--
-- RLS: admin+ read (spend is billing-class, not something a viewer/agent
-- needs). Writes come from the service-role client (webhook + route),
-- which bypasses RLS, so there is no INSERT policy for `authenticated`.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id   uuid REFERENCES conversations(id) ON DELETE SET NULL,
  -- 'auto_reply' | 'draft' — which surface spent the tokens.
  mode              text NOT NULL CHECK (mode IN ('auto_reply', 'draft')),
  provider          text NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  model             text NOT NULL,
  prompt_tokens     integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens      integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Account-scoped, newest-first reads (usage dashboards, "spend this
-- month") — the only access pattern.
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_account_created
  ON ai_usage_log(account_id, created_at DESC);

ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;

-- SELECT: admin+ only (spend visibility is settings/billing-class).
DROP POLICY IF EXISTS ai_usage_log_select ON ai_usage_log;
CREATE POLICY ai_usage_log_select ON ai_usage_log FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- No INSERT/UPDATE/DELETE policies for `authenticated`: the log is
-- written exclusively by the service role (webhook + draft route) and
-- is never mutated from the client.
