-- ============================================================
-- 077_ai_send_quick_reply.sql
--
-- Extends `ai_action_log.action` to allow `'send_quick_reply'` — the
-- auto-reply bot can now answer a routine question with one of the
-- account's saved 'text'-kind quick replies verbatim instead of
-- writing its own paraphrase (see QUICK_REPLY_SENTINEL_PREFIX,
-- src/lib/ai/defaults.ts, and the resolution logic in
-- src/lib/ai/auto-reply.ts). `target_id` for this action is the
-- `quick_replies.id` row that was sent, same convention as every
-- other autonomous action logged here (migrations 049/052/053/058/
-- 061/066).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.ai_action_log DROP CONSTRAINT IF EXISTS ai_action_log_action_check;
ALTER TABLE public.ai_action_log ADD CONSTRAINT ai_action_log_action_check
  CHECK (action IN (
    'close_conversation', 'mark_deal_won', 'move_deal', 'set_lead_temperature',
    'create_quote', 'flag_deal_closing', 'create_deal', 'schedule_appointment',
    'create_automation_rule', 'send_quick_reply'
  ));
