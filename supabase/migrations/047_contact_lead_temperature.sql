-- ============================================================
-- 047_contact_lead_temperature.sql
-- Manual lead qualification for Phase 2.
--
-- Nullable is intentional: existing and newly imported contacts remain
-- unclassified until a team member evaluates them. The existing contacts
-- UPDATE policy already limits changes to account members with agent+ role.
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS lead_temperature text;

ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_lead_temperature_check;

ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_lead_temperature_check
  CHECK (lead_temperature IS NULL OR lead_temperature IN ('cold', 'warm', 'hot'));
