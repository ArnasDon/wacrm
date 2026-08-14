-- ============================================================
-- 039_instagram_config.sql — Instagram DM channel (foundation)
--
-- Adds Instagram Direct Messages as a second messaging channel
-- alongside WhatsApp. Mirrors the account-scoped + is_account_member()
-- RLS pattern established in 017_account_sharing.sql and the
-- generated-column dedup pattern from 022_contact_phone_dedup.sql.
-- Does NOT touch whatsapp_config or change any existing WhatsApp
-- row/behavior.
--
-- What this migration does
--   1. Creates `instagram_config` — one connected Instagram
--      professional account per wacrm account (UNIQUE(account_id),
--      same "one per account for now" design as whatsapp_config; see
--      017's comment for the future multi-account escape hatch,
--      which applies here too).
--   2. Relaxes `contacts.phone` to nullable — an Instagram-only
--      contact has no phone — and adds `instagram_id` (the Meta
--      Instagram-Scoped ID, IGSID) + `instagram_username`, with a
--      partial UNIQUE index mirroring 022's phone_normalized index.
--      Application-level invariant (not a DB CHECK, kept additive):
--      every contact has exactly one of {phone, instagram_id} set,
--      never neither, never both.
--   3. Adds `conversations.channel` ('whatsapp' | 'instagram',
--      DEFAULT 'whatsapp' so every existing row backfills for free
--      with no data migration needed). `messages` needs no channel
--      column — it inherits channel via conversation_id, and its RLS
--      already derives through conversations.account_id.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. INSTAGRAM_CONFIG
-- ============================================================
CREATE TABLE IF NOT EXISTS instagram_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- audit-only, not tenancy (see 017's whatsapp_config.user_id)
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The Instagram-scoped Business Account ID — the Graph API node
  -- used both to send (/{ig_account_id}/messages) and to route
  -- inbound webhooks (matched against the inbound event's
  -- `recipient.id`). Globally unique, mirroring
  -- whatsapp_config.phone_number_id (013/017): the same IG account
  -- can't be claimed by two wacrm accounts.
  ig_account_id TEXT NOT NULL,
  -- The connected Facebook Page ID backing this IG professional
  -- account. Not used for sending/routing; kept for diagnostics since
  -- Meta's setup flow surfaces it.
  page_id TEXT,
  ig_username TEXT,
  access_token TEXT NOT NULL, -- AES-256-GCM encrypted — reuses src/lib/whatsapp/encryption.ts as-is
  verify_token TEXT,          -- AES-256-GCM encrypted — same brute-force GET-verification match as whatsapp_config
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  last_connection_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_instagram_config_account ON instagram_config(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_instagram_config_ig_account ON instagram_config(ig_account_id);

ALTER TABLE instagram_config ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON instagram_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON instagram_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS instagram_config_select ON instagram_config;
DROP POLICY IF EXISTS instagram_config_insert ON instagram_config;
DROP POLICY IF EXISTS instagram_config_update ON instagram_config;
DROP POLICY IF EXISTS instagram_config_delete ON instagram_config;
CREATE POLICY instagram_config_select ON instagram_config FOR SELECT USING (is_account_member(account_id));
CREATE POLICY instagram_config_insert ON instagram_config FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY instagram_config_update ON instagram_config FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY instagram_config_delete ON instagram_config FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- 2. CONTACTS — Instagram identity
--
-- contacts.phone was NOT NULL (migration 001). An Instagram-only
-- contact has no phone, so it must accept NULL. This does not weaken
-- 022's phone_normalized dedup guarantee: regexp_replace(NULL, ...)
-- is NULL, and 022's partial index condition (phone_normalized <> '')
-- already excludes NULL rows (NULL <> '' evaluates to NULL, not
-- TRUE) — no follow-up change needed to migration 022.
-- ============================================================
ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS instagram_id TEXT,
  ADD COLUMN IF NOT EXISTS instagram_username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_instagram
  ON contacts(account_id, instagram_id)
  WHERE instagram_id IS NOT NULL;

-- ============================================================
-- 3. CONVERSATIONS — channel
--
-- Not changing idx_conversations_account_contact (036, UNIQUE on
-- (account_id, contact_id)): contacts are channel-exclusive by
-- construction (a row has either `phone` or `instagram_id`, never
-- both), so (account_id, contact_id) already implies a single
-- channel per conversation. Revisit only if a later phase merges a
-- WhatsApp and an Instagram contact into one unified contact row —
-- that would need (account_id, contact_id, channel) instead.
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp', 'instagram'));

CREATE INDEX IF NOT EXISTS idx_conversations_account_channel
  ON conversations(account_id, channel);
