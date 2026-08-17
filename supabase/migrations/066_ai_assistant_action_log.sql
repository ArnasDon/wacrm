-- ============================================================
-- 066_ai_assistant_action_log.sql
--
-- Two additive changes for the new owner-only AI assistant chat
-- (`POST /api/ai/assistant`, `src/lib/ai/assistant/*`):
--
--   1. Extend `ai_action_log.action` to allow `'create_automation_rule'`
--      — the assistant can propose a lead-handling automation, and when
--      the owner confirms it, `POST /api/automations` (source:
--      'ai_assistant') logs it here for the same audit trail every
--      other AI-originated mutation already gets
--      (close_conversation/mark_deal_won/move_deal/set_lead_temperature/
--      create_quote/flag_deal_closing/create_deal/schedule_appointment,
--      shipped across migrations 049/052/053/058/061). `target_id` for
--      this action is the new `automations.id` row. The automation
--      itself is always created with `is_active = false` (draft) — this
--      log entry records the *creation*, not activation.
--
--   2. Extend `ai_usage_log.mode` to allow `'assistant'` — this chat can
--      run several tool-calling round trips per owner turn (unlike one
--      call per `draft`/`auto_reply`), so its token spend needs its own
--      mode value to stay distinguishable in cost reporting.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.ai_action_log DROP CONSTRAINT IF EXISTS ai_action_log_action_check;
ALTER TABLE public.ai_action_log ADD CONSTRAINT ai_action_log_action_check
  CHECK (action IN (
    'close_conversation', 'mark_deal_won', 'move_deal', 'set_lead_temperature',
    'create_quote', 'flag_deal_closing', 'create_deal', 'schedule_appointment',
    'create_automation_rule'
  ));

ALTER TABLE public.ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE public.ai_usage_log ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'assistant'));
