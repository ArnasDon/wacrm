-- ============================================================
-- 040_instagram_config.sql — Instagram DM integration
-- Stores Instagram Business Account credentials for DM automation.
-- Follows the same pattern as whatsapp_config.
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS instagram_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Instagram Business Account ID (numeric, from Graph API)
  ig_user_id TEXT NOT NULL,
  -- Facebook Page ID linked to the IG Business Account
  page_id TEXT,
  -- Encrypted long-lived Page Access Token with instagram_manage_messages
  access_token TEXT NOT NULL,
  -- Custom webhook verify token
  verify_token TEXT,
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  -- Instagram Business Account username for display
  ig_username TEXT,
  -- Metadata for webhook
  subscribed_at TIMESTAMPTZ,
  last_webhook_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One config per account
  UNIQUE(account_id)
);

CREATE INDEX IF NOT EXISTS idx_instagram_config_account_id ON instagram_config(account_id);

ALTER TABLE instagram_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view instagram config" ON instagram_config;
CREATE POLICY "Members can view instagram config" ON instagram_config FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Admins can manage instagram config" ON instagram_config
  USING (is_account_member(account_id, 'agent'));

-- Allow admin/owner to insert/update/delete
DROP POLICY IF EXISTS "Admins can insert instagram config" ON instagram_config;
CREATE POLICY "Admins can insert instagram config" ON instagram_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Admins can update instagram config" ON instagram_config;
CREATE POLICY "Admins can update instagram config" ON instagram_config FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Admins can delete instagram config" ON instagram_config;
CREATE POLICY "Admins can delete instagram config" ON instagram_config FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_instagram_config_updated_at ON instagram_config;
CREATE TRIGGER set_instagram_config_updated_at BEFORE UPDATE ON instagram_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

