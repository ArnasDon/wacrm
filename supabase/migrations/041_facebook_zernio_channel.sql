-- ============================================================
-- 041_facebook_zernio_channel.sql — Facebook Messenger channel
-- (Zernio-only)
--
-- Adds Facebook Messenger as a third messaging channel, alongside
-- WhatsApp and Instagram. Unlike Instagram, there is no direct-Meta
-- option here — every Facebook connection goes through Zernio
-- (zernio.com), the same third-party platform 040 introduced for
-- Instagram, since Zernio already completed Meta Business
-- Verification. Mirrors 039/040's structure closely.
--
-- What this migration does
--   1. Creates `facebook_config` — one connected Facebook Page per
--      wacrm account, Zernio-only (no provider column: unlike
--      instagram_config there's only one path here).
--   2. Adds `contacts.facebook_id` (the Page-Scoped ID, PSID) +
--      `facebook_username`, with a partial UNIQUE index mirroring
--      039's instagram_id index.
--   3. Extends `conversations.channel`'s CHECK constraint to accept
--      'facebook' alongside the existing 'whatsapp' | 'instagram'.
--      `conversations.zernio_conversation_id` (040) is reused as-is —
--      a conversation belongs to exactly one channel, so no
--      Facebook-specific column is needed there.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. FACEBOOK_CONFIG
-- ============================================================
CREATE TABLE IF NOT EXISTS facebook_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- audit-only, not tenancy
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Zernio API key (sk_... — zernio.com/dashboard/api-keys), AES-256-GCM
  -- encrypted with src/lib/whatsapp/encryption.ts, same as instagram_config.
  zernio_api_key TEXT NOT NULL,
  -- The Zernio-internal `_id` of the connected Facebook Page
  -- (zernio.com/dashboard/connections), a 24-char Mongo-style id.
  zernio_account_id TEXT NOT NULL,
  -- Secret wacrm generates and the user pastes into Zernio's "Add
  -- Webhook" form, used to verify X-Zernio-Signature. AES-256-GCM
  -- encrypted, same as above.
  zernio_webhook_secret TEXT,
  fb_page_name TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  last_connection_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_facebook_config_account ON facebook_config(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_facebook_config_zernio_account ON facebook_config(zernio_account_id);

ALTER TABLE facebook_config ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON facebook_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON facebook_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS facebook_config_select ON facebook_config;
DROP POLICY IF EXISTS facebook_config_insert ON facebook_config;
DROP POLICY IF EXISTS facebook_config_update ON facebook_config;
DROP POLICY IF EXISTS facebook_config_delete ON facebook_config;
CREATE POLICY facebook_config_select ON facebook_config FOR SELECT USING (is_account_member(account_id));
CREATE POLICY facebook_config_insert ON facebook_config FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY facebook_config_update ON facebook_config FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY facebook_config_delete ON facebook_config FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- 2. CONTACTS — Facebook identity
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS facebook_id TEXT,
  ADD COLUMN IF NOT EXISTS facebook_username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_facebook
  ON contacts(account_id, facebook_id)
  WHERE facebook_id IS NOT NULL;

-- ============================================================
-- 3. CONVERSATIONS — channel
-- ============================================================
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_channel_check CHECK (channel IN ('whatsapp', 'instagram', 'facebook'));
