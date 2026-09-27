-- Allow multiple WhatsApp Business Accounts per CRM account.
-- Existing rows remain the default configuration for their account.

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

UPDATE whatsapp_config AS target
SET is_default = TRUE
WHERE target.id IN (
  SELECT DISTINCT ON (account_id) id
  FROM whatsapp_config
  ORDER BY account_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_one_default
  ON whatsapp_config (account_id)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_account
  ON whatsapp_config (account_id);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL;

UPDATE conversations AS conversation
SET whatsapp_config_id = config.id
FROM whatsapp_config AS config
WHERE conversation.account_id = config.account_id
  AND config.is_default
  AND conversation.whatsapp_config_id IS NULL;

DROP INDEX IF EXISTS idx_conversations_account_contact;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_config
  ON conversations (account_id, contact_id, whatsapp_config_id)
  WHERE whatsapp_config_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_legacy
  ON conversations (account_id, contact_id)
  WHERE whatsapp_config_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON conversations (whatsapp_config_id);
