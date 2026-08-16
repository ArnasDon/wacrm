-- ============================================================
-- 052_ai_action_temperature_and_conversation_sla.sql
--
-- Three additive, unrelated-but-shipped-together changes for Chat
-- Sandía Bloque 3 (acciones de IA en la interfaz conversacional):
--
--   1. Extend `ai_action_log.action` to allow `'set_lead_temperature'`
--      — the fourth business action (src/lib/ai/business-actions.ts),
--      alongside close_conversation/mark_deal_won/move_deal already
--      shipped in migration 049.
--
--   2. `ai_configs.unclaimed_conversation_timeout_minutes` — how long a
--      conversation can sit open with no assigned agent before the new
--      `/api/conversations/cron` sweep auto-assigns it to an available
--      (online) advisor. Same clamp pattern as the existing
--      `auto_reply_max_per_conversation` column (migration 029).
--
--   3. A partial index on `conversations` so that sweep's query
--      (unassigned, open, stale) doesn't sequentially scan the table.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. ai_action_log.action — extend the inline CHECK. Postgres
--    auto-names an unnamed inline CHECK as <table>_<column>_check —
--    confirmed against the exact constraint created by 049.
ALTER TABLE public.ai_action_log DROP CONSTRAINT IF EXISTS ai_action_log_action_check;
ALTER TABLE public.ai_action_log ADD CONSTRAINT ai_action_log_action_check
  CHECK (action IN ('close_conversation', 'mark_deal_won', 'move_deal', 'set_lead_temperature'));

-- 2. ai_configs.unclaimed_conversation_timeout_minutes
ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS unclaimed_conversation_timeout_minutes INTEGER NOT NULL DEFAULT 10;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_configs_unclaimed_timeout_range'
      AND conrelid = 'public.ai_configs'::regclass
  ) THEN
    ALTER TABLE public.ai_configs
      ADD CONSTRAINT ai_configs_unclaimed_timeout_range
      CHECK (unclaimed_conversation_timeout_minutes BETWEEN 1 AND 1440);
  END IF;
END $$;

COMMENT ON COLUMN public.ai_configs.unclaimed_conversation_timeout_minutes IS
  'Minutes an open conversation can sit with no assigned agent before /api/conversations/cron auto-assigns it to an available (online) advisor.';

-- 3. Sweep index — only unassigned open conversations matter to the cron.
CREATE INDEX IF NOT EXISTS idx_conversations_unassigned_open
  ON public.conversations (account_id, updated_at)
  WHERE assigned_agent_id IS NULL AND status = 'open';
