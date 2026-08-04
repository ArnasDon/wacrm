-- ============================================================
-- 046_appointment_end_time.sql — custom feature, not part of the
-- upstream wacrm template.
--
-- Adds an end time to appointments, mirroring how Google Calendar (and
-- any real calendar) models an event: a start and an end, not just a
-- start. Nullable so existing untimed/point-in-time appointments keep
-- working unchanged; the UI is where "start required before end" is
-- enforced, not the schema (same rationale as scheduled_time itself).
-- ============================================================

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS scheduled_end_time TIME;
