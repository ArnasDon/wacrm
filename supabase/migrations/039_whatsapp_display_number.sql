-- ============================================================
-- 039_whatsapp_display_number.sql
-- Stores the actual WhatsApp phone number (e.g. "919694272727")
-- so wa.me deep links can be generated without an extra Graph API
-- call at send time. Idempotent.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS display_phone_number TEXT;