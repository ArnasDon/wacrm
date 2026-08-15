-- ============================================================
-- 042_whatsapp_zernio_provider.sql — Zernio as an alternate
-- WhatsApp provider
--
-- Same reasoning as 040 (Instagram): connecting WhatsApp directly to
-- Meta's Cloud API requires Meta Business Verification. Zernio
-- already completed that verification and exposes the full WhatsApp
-- surface (messages, templates, media) through its own API, so an
-- account can connect WhatsApp without going through Meta's
-- verification itself.
--
-- Unlike Instagram, `conversations.channel` does NOT get a new value
-- here — a Zernio-connected WhatsApp number is still channel
-- 'whatsapp'; `provider` on `whatsapp_config` decides which API the
-- send/webhook code talks to. `conversations.zernio_conversation_id`
-- (040) is reused as-is.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE whatsapp_config
  ALTER COLUMN phone_number_id DROP NOT NULL,
  ALTER COLUMN access_token DROP NOT NULL;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta', 'zernio')),
  -- Zernio API key (sk_...), AES-256-GCM encrypted with
  -- src/lib/whatsapp/encryption.ts, same as access_token above.
  ADD COLUMN IF NOT EXISTS zernio_api_key TEXT,
  -- The Zernio-internal `_id` of the connected WhatsApp number
  -- (zernio.com/dashboard/connections). Distinct from phone_number_id,
  -- which is Meta's own numeric phone number ID and doesn't apply to
  -- the Zernio path.
  ADD COLUMN IF NOT EXISTS zernio_account_id TEXT,
  -- Secret wacrm generates and the user pastes into Zernio's "Add
  -- Webhook" form. AES-256-GCM encrypted, same as above.
  ADD COLUMN IF NOT EXISTS zernio_webhook_secret TEXT;

ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_provider_fields_check;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_provider_fields_check CHECK (
    (provider = 'meta' AND phone_number_id IS NOT NULL AND access_token IS NOT NULL)
    OR
    (provider = 'zernio' AND zernio_api_key IS NOT NULL AND zernio_account_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_zernio_account
  ON whatsapp_config(zernio_account_id);
