-- ============================================================
-- 135_ai_action_send_photo.sql — allow the auto-reply bot to log
-- sending a specific catalog product's photo
-- (`ai_action_log.action = 'send_photo'`).
--
-- Same idempotent widen as migration 127 did for 'appointment_action'.
-- ============================================================

ALTER TABLE public.ai_action_log
  DROP CONSTRAINT IF EXISTS ai_action_log_action_check;

ALTER TABLE public.ai_action_log
  ADD CONSTRAINT ai_action_log_action_check CHECK (
    action = ANY (ARRAY[
      'close_conversation', 'mark_deal_won', 'move_deal', 'set_lead_temperature',
      'create_quote', 'flag_deal_closing', 'create_deal', 'schedule_appointment',
      'create_automation_rule', 'send_quick_reply', 'record_reservation',
      'appointment_action', 'send_photo'
    ]::text[])
  );
