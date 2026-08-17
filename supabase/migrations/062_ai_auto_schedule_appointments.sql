-- ============================================================
-- 062_ai_auto_schedule_appointments.sql
--
-- Adds the master toggle for AUTONOMOUS appointment scheduling —
-- Angel's explicit product decision, 2026-08-16: schedule_appointment
-- started as always-confirm-first (Bloque B, migration 061), but he
-- wants the bot able to book a real Google Calendar event with no
-- human confirmation, governed by whatever guidance he leaves in
-- `ai_configs.system_prompt` ("Business context & instructions"),
-- with a per-account switch to turn that autonomy on/off.
--
-- Defaults to false — off until an admin explicitly opts in — and even
-- then src/lib/ai/auto-reply.ts only offers the capability to the
-- model when the account's Google Calendar is actually connected
-- (see google_calendar_config.status). Turning this on with no
-- calendar connected is a safe no-op.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS auto_schedule_appointments_enabled boolean NOT NULL DEFAULT false;
