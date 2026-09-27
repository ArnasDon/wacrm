-- ============================================================
-- 044: WhatsApp channel details
-- ============================================================
--
-- 043 turned whatsapp_config into "channels" — several numbers per
-- account, a per-account default, and one conversation per
-- (contact, channel). This adds what the WhatsApp channels page shows
-- for each channel:
--
--   * color — the swatch the team picks to tell numbers apart;
--   * a snapshot of what Meta says about the number (display number,
--     verified name, WABA name, quality rating, messaging-limit tier),
--     refreshed on connect and on "Refresh from Meta", so the list
--     renders without a Meta round-trip per row.
--
-- Idempotent: safe to re-run.

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#25D366',
  ADD COLUMN IF NOT EXISTS display_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS verified_name TEXT,
  ADD COLUMN IF NOT EXISTS waba_name TEXT,
  ADD COLUMN IF NOT EXISTS quality_rating TEXT,
  ADD COLUMN IF NOT EXISTS messaging_limit_tier TEXT,
  ADD COLUMN IF NOT EXISTS meta_synced_at TIMESTAMPTZ;
