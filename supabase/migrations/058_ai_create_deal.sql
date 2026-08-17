-- ============================================================
-- 058_ai_create_deal.sql
--
-- The AI's autonomous move_deal action can now also CREATE a deal (not
-- just advance an existing one) when a contact has no open deal yet —
-- see src/lib/ai/auto-reply.ts's autoMoveDealStage(). Logged as its own
-- `create_deal` action (distinct from `move_deal`) so the audit trail
-- and the AI results dashboard can tell "advanced an existing deal"
-- apart from "brought a new chat into the pipeline."
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.ai_action_log DROP CONSTRAINT IF EXISTS ai_action_log_action_check;
ALTER TABLE public.ai_action_log ADD CONSTRAINT ai_action_log_action_check
  CHECK (action IN ('close_conversation', 'mark_deal_won', 'move_deal', 'set_lead_temperature', 'create_quote', 'flag_deal_closing', 'create_deal'));
