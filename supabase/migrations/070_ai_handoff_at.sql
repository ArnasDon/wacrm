-- ============================================================
-- 070_ai_handoff_at.sql — timestamp of the AI's handoff to a human
--
-- Neither `ai_autoreply_disabled` nor `ai_handoff_summary` (migrations
-- 029/033) record WHEN the handoff happened, only that it did — so
-- there was no way to measure how long a human takes to pick up a
-- chat the AI handed off. `ai_handoff_at` is set once, at the moment
-- `dispatchInboundToAiReply` (explicit-request handoff) or
-- `flagDealClosing` (purchase-confirmation handoff) actually hands the
-- conversation off — see src/lib/ai/auto-reply.ts. The dashboard's
-- "average human wait time" card pairs this with the first
-- `messages` row after it where `sender_type = 'agent' AND
-- ai_generated = false` (a genuine human reply, not the bot).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_handoff_at timestamptz;

-- Partial index: only handed-off conversations are ever queried by
-- this column, and only within a recent window (dashboard query).
CREATE INDEX IF NOT EXISTS idx_conversations_ai_handoff_at
  ON conversations(ai_handoff_at)
  WHERE ai_handoff_at IS NOT NULL;
