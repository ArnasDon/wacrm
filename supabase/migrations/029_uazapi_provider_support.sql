-- ============================================================
-- Multi-provider WhatsApp: add Uazapi as a second provider,
-- coexisting with Meta on the same account.
--
-- Context (see docs/uazapi-integration-plan.md):
--   whatsapp_config was UNIQUE(account_id) — one WhatsApp connection
--   per account, implicitly Meta. This migration:
--     1. Adds a `provider` column ('meta' | 'uazapi').
--     2. Relaxes phone_number_id's UNIQUE constraint to apply only to
--        Meta rows (Uazapi rows never populate it).
--     3. Swaps the account-level UNIQUE to (account_id, provider) so
--        an account can hold one Meta row AND one Uazapi row.
--     4. Adds Uazapi-specific columns (nullable — irrelevant for
--        provider='meta' rows) and an `is_default` flag used to pick
--        the provider for brand-new outbound (broadcasts, automations
--        reaching a contact with no existing conversation).
--     5. Adds `provider` to conversations/messages so an existing
--        conversation always knows which provider owns it — outbound
--        sends read this column instead of guessing.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ---- 1. provider column -------------------------------------------
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta', 'uazapi'));

-- ---- 2. phone_number_id UNIQUE becomes Meta-only -------------------
-- Uazapi rows never set phone_number_id, so a plain UNIQUE constraint
-- would let at most one Uazapi row exist globally (NULL = NULL isn't
-- true in Postgres uniqueness... except Postgres treats NULLs as
-- distinct for UNIQUE constraints already, so this is actually safe
-- as-is). We still scope it to Meta explicitly via a partial index so
-- the intent is unambiguous and future NOT NULL work on the column
-- doesn't silently break Uazapi rows.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_phone_number_id_key;
DROP INDEX IF EXISTS idx_whatsapp_config_phone_number_id_meta;
CREATE UNIQUE INDEX idx_whatsapp_config_phone_number_id_meta
  ON whatsapp_config (phone_number_id)
  WHERE provider = 'meta' AND phone_number_id IS NOT NULL;

ALTER TABLE whatsapp_config ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE whatsapp_config ALTER COLUMN access_token DROP NOT NULL;

-- ---- 3. one row per (account, provider) instead of per account -----
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_account_provider_key'
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_account_provider_key UNIQUE (account_id, provider);
  END IF;
END $$;

-- ---- 4. Uazapi-specific columns + default-provider flag ------------
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS uazapi_instance_token TEXT,       -- encrypted, AES-256-GCM (same scheme as access_token)
  ADD COLUMN IF NOT EXISTS uazapi_base_url TEXT,             -- e.g. https://api.uazapi.com
  ADD COLUMN IF NOT EXISTS uazapi_instance_name TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_connection_status TEXT
    CHECK (uazapi_connection_status IN ('disconnected', 'connecting', 'connected')),
  ADD COLUMN IF NOT EXISTS uazapi_last_qr_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS uazapi_connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS uazapi_webhook_secret TEXT,        -- random per-instance secret; validates inbound webhook requests (Uazapi has no HMAC signing)
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

-- At most one default provider per account.
DROP INDEX IF EXISTS idx_whatsapp_config_one_default_per_account;
CREATE UNIQUE INDEX idx_whatsapp_config_one_default_per_account
  ON whatsapp_config (account_id)
  WHERE is_default = true;

-- Every pre-existing row is Meta and was the only connection for its
-- account — mark it default so outbound routing has an answer without
-- requiring a manual step post-migration.
UPDATE whatsapp_config SET is_default = true WHERE is_default = false;

-- ---- 5. provider routing column on conversations/messages ----------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta', 'uazapi'));
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS provider TEXT
    CHECK (provider IN ('meta', 'uazapi'));

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_provider ON whatsapp_config(provider);
CREATE INDEX IF NOT EXISTS idx_conversations_provider ON conversations(provider);
