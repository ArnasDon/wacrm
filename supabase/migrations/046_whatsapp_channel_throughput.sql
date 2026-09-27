-- ============================================================
-- 046: Channel throughput level
-- ============================================================
--
-- Meta's `throughput.level` for the number (STANDARD, HIGH, ...) — how
-- many messages per second Cloud API accepts from it. Read by the same
-- channel details call as 045 and cached for the WhatsApp channels page.
--
-- Idempotent: safe to re-run.

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS throughput_level TEXT;
