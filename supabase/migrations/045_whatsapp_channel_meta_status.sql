-- ============================================================
-- 045: More of Meta's phone-number state on each channel
-- ============================================================
--
-- The channel details call (GET /{phone_number_id} on Graph v23.0)
-- also reports the number's Meta-side status, verification and
-- display-name review, account mode, Official Business Account badge
-- and country. Cached here, like the 044 snapshot, so the WhatsApp
-- channels page can show Restricted / Flagged / Sandbox numbers without
-- a Meta round-trip per row. `messaging_limit_tier` (044) now holds
-- the portfolio-level `whatsapp_business_manager_messaging_limit`.
--
-- Idempotent: safe to re-run.

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS meta_status TEXT,
  ADD COLUMN IF NOT EXISTS code_verification_status TEXT,
  ADD COLUMN IF NOT EXISTS name_status TEXT,
  ADD COLUMN IF NOT EXISTS account_mode TEXT,
  ADD COLUMN IF NOT EXISTS is_official_business_account BOOLEAN,
  ADD COLUMN IF NOT EXISTS country_code TEXT,
  ADD COLUMN IF NOT EXISTS country_dial_code TEXT;
