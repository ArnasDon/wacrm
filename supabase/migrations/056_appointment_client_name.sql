-- ============================================================
-- 056_appointment_client_name.sql — custom feature, not part of
-- the upstream wacrm template.
--
-- "Novo Compromisso" required picking an existing `contacts` row
-- (contact_id) to record who the appointment is with — with a large
-- lead volume, forcing a CRM lookup for every appointment isn't
-- viable. contact_id was already nullable (no schema change needed
-- there); this adds one nullable free-text column so a typed name
-- that doesn't match any contact can still be saved and displayed,
-- without creating a new contact/lead automatically.
-- ============================================================

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_name TEXT;

COMMENT ON COLUMN appointments.client_name IS
  'Free-typed client name for appointments not linked to an existing contacts row (contact_id). Set alongside contact_id when the typed text matches an existing contact by name, for a consistent display fallback either way.';
