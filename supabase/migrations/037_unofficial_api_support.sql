-- ============================================================
-- 037: Unofficial API support (Evolution API)
--
-- Adds a second WhatsApp transport alongside the Meta Cloud API.
-- When `api_type = 'evolution'`, outbound sends and the inbound
-- webhook talk to a self-hosted Evolution API instance (WhatsApp
-- Web protocol) instead of graph.facebook.com. This is an
-- UNOFFICIAL transport — it violates WhatsApp's ToS and the number
-- can be banned. It exists as a zero-cost option for personal /
-- testing use, not as a replacement for the official API.
--
-- Storage model: the Evolution `apikey` reuses the existing
-- (encrypted) `access_token` column, so no new secret column is
-- introduced and the same AES-256-GCM at-rest protection applies.
-- ============================================================

-- 1. Meta-only NOT NULL columns become optional — an Evolution row
--    has no Meta phone_number_id. (access_token still holds the
--    Evolution apikey, so it stays populated in practice.)
ALTER TABLE whatsapp_config ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE whatsapp_config ALTER COLUMN access_token DROP NOT NULL;

-- 2. Transport selector. Existing rows default to 'meta' — no
--    behaviour change for anyone already connected to the Cloud API.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS api_type TEXT NOT NULL DEFAULT 'meta'
    CHECK (api_type IN ('meta', 'evolution'));

-- 3. Evolution-specific coordinates: the server base URL and the
--    instance name that identifies this connection on that server.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS api_url TEXT,
  ADD COLUMN IF NOT EXISTS instance_name TEXT;

-- 4. The inbound Evolution webhook routes by `instance_name` (the
--    Meta webhook routes by `phone_number_id`, which migration 013
--    made UNIQUE for exactly this reason: the handler does a
--    `.single()` lookup and two configs sharing the key would make it
--    error). Enforce the same one-owner-per-key guarantee for
--    Evolution instances. Partial index so it only constrains
--    Evolution rows and ignores NULLs on Meta rows.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_instance_name_unique
  ON whatsapp_config (instance_name)
  WHERE instance_name IS NOT NULL;
