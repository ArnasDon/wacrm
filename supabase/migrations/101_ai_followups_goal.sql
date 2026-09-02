-- ============================================================
-- 101_ai_followups_goal.sql — per-account objective for follow-ups
--
-- The follow-up sweep (migration 099) stops nudging a conversation once
-- its objective is met. That objective differs per company: Chat Sandía
-- wants an appointment booked; another company wants the sale closed, or
-- a quote sent, or just any reply. `followups_goal` makes it a setting.
--
--   'reply'       — no extra check; a fresh inbound already resets the
--                   streak, so the steps just run until the customer
--                   answers or the sequence is exhausted. (Default —
--                   safe for a company that hasn't thought about it.)
--   'appointment' — an `ai_action_log` schedule_appointment row exists
--                   for the contact (the pre-101 hard-coded behaviour).
--   'deal_won'    — the contact has a deal marked won (`deals.won_at`
--                   set, or status 'won').
--   'quote_sent'  — a `quotes` row exists for the contact.
--
-- A conversation that gets assigned to a person / handed off / driven by
-- a live Flow already stops the sweep regardless of goal — those gates
-- are unchanged.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS followups_goal text NOT NULL DEFAULT 'reply';

ALTER TABLE public.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_followups_goal_chk;
ALTER TABLE public.ai_configs
  ADD CONSTRAINT ai_configs_followups_goal_chk
  CHECK (followups_goal IN ('reply', 'appointment', 'deal_won', 'quote_sent'));
