-- ============================================================
-- whatsapp_config: add a third provider (Z-API, self-service)
--
-- Unlike uazapi's reseller model (migration 037 — one admin
-- subscription creates an instance per account via API), Z-API is
-- bring-your-own-instance: each customer creates their own instance
-- directly in Z-API's dashboard (app.z-api.io) and pastes Instance
-- ID + Token (+ optional account-level Client-Token) into this CRM.
-- There is no admin token and no instance-creation API call — Settings
-- only ever stores credentials the user typed in, then registers our
-- webhook URL against that instance.
--
-- zapi_client_token is optional per Z-API's own security model (it's
-- disabled by default per-account until the user turns it on in their
-- Z-API dashboard — see developer.z-api.io/security/client-token) —
-- when set, it's sent as the `Client-Token` header on every request.
--
-- zapi_webhook_secret plays the same role as uazapi_webhook_secret:
-- Z-API webhooks aren't HMAC-signed, so a random per-account secret
-- embedded in the webhook URL path is the stand-in authentication.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Widen the provider discriminator to include 'zapi'.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_provider_check;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_provider_check CHECK (provider IN ('meta', 'uazapi', 'zapi'));

-- 2. Z-API-only columns, all nullable.
--    zapi_status mirrors uazapi_status's shape, but Z-API's own
--    /status endpoint only ever reports connected/disconnected (no
--    "connecting"/"hibernated" states of its own) — pairing state is
--    tracked client-side while a QR code is being polled, same as the
--    uazapi UI does before the first successful status check.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS zapi_instance_id TEXT,
  ADD COLUMN IF NOT EXISTS zapi_token TEXT,
  ADD COLUMN IF NOT EXISTS zapi_client_token TEXT,
  ADD COLUMN IF NOT EXISTS zapi_status TEXT
    CHECK (zapi_status IN ('disconnected', 'connecting', 'connected')),
  ADD COLUMN IF NOT EXISTS zapi_paired_phone TEXT,
  ADD COLUMN IF NOT EXISTS zapi_connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS zapi_webhook_secret TEXT;

-- 3. One Z-API instance maps to exactly one account, mirroring the
--    uazapi_instance_id UNIQUE constraint from migration 037.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_zapi_instance_id_key'
      AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_zapi_instance_id_key
      UNIQUE (zapi_instance_id);
  END IF;
END $$;

-- 4. Widen the mutual-exclusivity CHECK from migration 037 to a
--    three-way split. Replaces (rather than ADD-if-not-exists) the
--    prior two-way constraint, since its shape must change to add the
--    zapi branch and to fold `uazapi_instance_id IS NULL` in for the
--    'zapi' branch and `zapi_instance_id IS NULL` in for the other
--    two — every existing row is 'meta' or 'uazapi' with all zapi_*
--    columns still NULL (just added in step 2), so this is satisfied
--    by all current data with no backfill.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_provider_columns_check;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_provider_columns_check
  CHECK (
    (
      provider = 'meta'
      AND phone_number_id IS NOT NULL
      AND access_token IS NOT NULL
      AND uazapi_instance_id IS NULL
      AND uazapi_token IS NULL
      AND zapi_instance_id IS NULL
      AND zapi_token IS NULL
    )
    OR (
      provider = 'uazapi'
      AND uazapi_instance_id IS NOT NULL
      AND uazapi_token IS NOT NULL
      AND phone_number_id IS NULL
      AND access_token IS NULL
      AND zapi_instance_id IS NULL
      AND zapi_token IS NULL
    )
    OR (
      provider = 'zapi'
      AND zapi_instance_id IS NOT NULL
      AND zapi_token IS NOT NULL
      AND phone_number_id IS NULL
      AND access_token IS NULL
      AND uazapi_instance_id IS NULL
      AND uazapi_token IS NULL
    )
  );

-- No RLS changes needed — whatsapp_config_select/insert/update/delete
-- (migration 017) already gate on is_account_member(account_id[, 'admin']),
-- which covers these new columns for free.
