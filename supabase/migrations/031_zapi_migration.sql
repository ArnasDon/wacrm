-- Migration: WAHA -> Z-API
--
-- Existing WhatsApp configuration rows must be reconfigured with a
-- pre-created Z-API instance id, instance token, and Client-Token.

BEGIN;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS zapi_instance_id     TEXT,
  ADD COLUMN IF NOT EXISTS zapi_instance_token  TEXT,
  ADD COLUMN IF NOT EXISTS zapi_client_token    TEXT,
  ADD COLUMN IF NOT EXISTS zapi_webhook_secret  TEXT,
  ADD COLUMN IF NOT EXISTS zapi_connected_phone TEXT,
  ADD COLUMN IF NOT EXISTS connection_status    TEXT DEFAULT 'DISCONNECTED'
    CHECK (connection_status IN ('DISCONNECTED','PENDING_QR','CONNECTED','FAILED'));

ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_account_session_unique;

ALTER TABLE whatsapp_config
  DROP COLUMN IF EXISTS waha_session_name,
  DROP COLUMN IF EXISTS waha_api_url,
  DROP COLUMN IF EXISTS waha_api_key,
  DROP COLUMN IF EXISTS session_status;

UPDATE whatsapp_config
SET
  status = 'disconnected',
  connection_status = 'DISCONNECTED',
  zapi_connected_phone = NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'whatsapp_config_account_zapi_instance_unique'
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_account_zapi_instance_unique
      UNIQUE (account_id, zapi_instance_id);
  END IF;
END $$;

COMMIT;
