-- ============================================================
-- 113_ai_record_reservation.sql — allow the new autonomous AI action
-- `record_reservation` in the ai_action_log CHECK (migration 049, last
-- widened in 077).
--
-- Fired by `auto-reply.ts` when the model emits
-- RECORD_RESERVATION_SENTINEL_PREFIX on a hotel account — it upserts a
-- `reservation_requests` row (migration 112) as the chat reveals guest
-- count / dates / a spa duration / an event hall. Widening a CHECK
-- never rewrites rows. Idempotent.
-- ============================================================

ALTER TABLE public.ai_action_log DROP CONSTRAINT IF EXISTS ai_action_log_action_check;
ALTER TABLE public.ai_action_log ADD CONSTRAINT ai_action_log_action_check
  CHECK (action IN (
    'close_conversation', 'mark_deal_won', 'move_deal', 'set_lead_temperature',
    'create_quote', 'flag_deal_closing', 'create_deal', 'schedule_appointment',
    'create_automation_rule', 'send_quick_reply', 'record_reservation'
  ));
