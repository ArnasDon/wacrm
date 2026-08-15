-- ============================================================
-- 040_instagram_zernio_provider.sql — Zernio as an alternate
-- Instagram provider
--
-- Context: connecting Instagram directly to Meta's Graph API
-- (039_instagram_config.sql) requires Meta Business Verification,
-- which isn't available to every account holder (e.g. accounts not
-- yet registered as a formal business). Zernio (zernio.com) is a
-- third-party platform that already completed that verification
-- and exposes Instagram DMs through its own API + webhooks, so an
-- account can connect Instagram without going through Meta's
-- verification itself.
--
-- This migration turns `instagram_config` into a provider-aware
-- table: the existing Meta-direct columns become optional, and a
-- parallel set of Zernio-specific columns is added. Exactly one set
-- must be populated, enforced by a CHECK constraint keyed on the new
-- `provider` column. No existing row changes shape or behavior —
-- every row that predates this migration is `provider = 'meta'` with
-- its existing `ig_account_id`/`access_token` intact.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE instagram_config
  ALTER COLUMN ig_account_id DROP NOT NULL,
  ALTER COLUMN access_token DROP NOT NULL;

ALTER TABLE instagram_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta', 'zernio')),
  -- Zernio API key (sk_... — see zernio.com/dashboard/api-keys), AES-256-GCM
  -- encrypted with the same src/lib/whatsapp/encryption.ts used for
  -- access_token/verify_token above.
  ADD COLUMN IF NOT EXISTS zernio_api_key TEXT,
  -- The Zernio-internal `_id` of the connected Instagram account
  -- (zernio.com/dashboard/connections), a 24-char Mongo-style id.
  -- Distinct from ig_account_id, which is Meta's own numeric IG
  -- Business Account ID and doesn't apply to the Zernio path.
  ADD COLUMN IF NOT EXISTS zernio_account_id TEXT,
  -- Secret wacrm generates and the user pastes into Zernio's "Add
  -- Webhook" form, used to verify X-Zernio-Signature on inbound
  -- webhook deliveries. AES-256-GCM encrypted, same as above.
  ADD COLUMN IF NOT EXISTS zernio_webhook_secret TEXT;

-- Exactly one credential set populated per provider. Kept as a table
-- CHECK (not a per-column NOT NULL) because the requirement is
-- conditional on `provider`.
ALTER TABLE instagram_config
  DROP CONSTRAINT IF EXISTS instagram_config_provider_fields_check;
ALTER TABLE instagram_config
  ADD CONSTRAINT instagram_config_provider_fields_check CHECK (
    (provider = 'meta' AND ig_account_id IS NOT NULL AND access_token IS NOT NULL)
    OR
    (provider = 'zernio' AND zernio_api_key IS NOT NULL AND zernio_account_id IS NOT NULL)
  );

-- Same "one wacrm account can't share a connected account with
-- another" guarantee idx_instagram_config_ig_account gives the Meta
-- path (039). Postgres unique indexes already treat NULL as
-- distinct-from-everything, so this coexists with Meta-only rows
-- (zernio_account_id NULL) with no partial-index qualifier needed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_instagram_config_zernio_account
  ON instagram_config(zernio_account_id);

-- ============================================================
-- CONVERSATIONS — Zernio's own conversation id
--
-- Zernio's send-message endpoint (POST /v1/inbox/conversations/
-- {conversationId}/messages) addresses a conversation by Zernio's own
-- opaque conversation id, not by the customer's IGSID the way Meta's
-- direct Send API does. Captured from the first inbound
-- `message.received` webhook and reused for every outbound send on
-- that conversation (agent replies, automations, flows) — mirrors how
-- `contacts.instagram_id` anchors the Meta-direct send path.
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS zernio_conversation_id TEXT;
