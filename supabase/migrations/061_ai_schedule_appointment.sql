-- ============================================================
-- 061_ai_schedule_appointment.sql
--
-- Adds `schedule_appointment` to ai_action_log's allowed actions —
-- the AI proposes a real, freebusy-checked Google Calendar slot
-- (POST /api/ai/suggest-action) and, once a human confirms via the
-- existing two-step POST /api/ai/actions flow, creates the event
-- (src/lib/google-calendar/api.ts's createEvent()). Unlike move_deal /
-- set_lead_temperature, this action is never autonomous — a real
-- calendar event and a real email to a real customer always requires
-- a human confirm.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.ai_action_log DROP CONSTRAINT IF EXISTS ai_action_log_action_check;
ALTER TABLE public.ai_action_log ADD CONSTRAINT ai_action_log_action_check
  CHECK (action IN ('close_conversation', 'mark_deal_won', 'move_deal', 'set_lead_temperature', 'create_quote', 'flag_deal_closing', 'create_deal', 'schedule_appointment'));
