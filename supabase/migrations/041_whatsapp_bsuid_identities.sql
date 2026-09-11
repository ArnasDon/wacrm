-- WhatsApp usernames can hide a customer's phone number. Keep the phone
-- identity for legacy contacts while storing Meta's stable per-portfolio ID.
ALTER TABLE contacts
  ALTER COLUMN phone DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_user_id TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_username TEXT;

-- Empty strings are not valid identities and must not consume the unique key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_whatsapp_user_id
  ON contacts (account_id, whatsapp_user_id)
  WHERE whatsapp_user_id IS NOT NULL AND whatsapp_user_id <> '';

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_recipient_id TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_recipient_type TEXT
    CHECK (whatsapp_recipient_type IN ('phone', 'bsuid'));

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_recipient
  ON conversations (account_id, whatsapp_recipient_type, whatsapp_recipient_id)
  WHERE whatsapp_recipient_id IS NOT NULL;
