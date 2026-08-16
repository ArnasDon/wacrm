-- ============================================================
-- 054_ai_deal_closing_flag.sql
--
-- Extends `ai_action_log.action` with `flag_deal_closing` — logged when
-- the auto-reply bot detects the customer explicitly confirmed a
-- purchase and hands the conversation off to a human teammate to close
-- it, instead of closing the deal itself (product decision: the bot
-- advances deals through intermediate pipeline stages autonomously via
-- the existing `move_deal` action, but never marks one won without a
-- person's own action). Purely additive — no existing rows change
-- shape, `target_id` is already a generic UUID (the conversation id for
-- this action, same column every other action already reuses for its
-- own target type).
-- ============================================================

ALTER TABLE public.ai_action_log DROP CONSTRAINT IF EXISTS ai_action_log_action_check;
ALTER TABLE public.ai_action_log ADD CONSTRAINT ai_action_log_action_check
  CHECK (action IN ('close_conversation', 'mark_deal_won', 'move_deal', 'set_lead_temperature', 'create_quote', 'flag_deal_closing'));
