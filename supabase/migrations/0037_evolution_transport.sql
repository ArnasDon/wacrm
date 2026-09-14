-- ============================================================
-- 037_evolution_transport.sql — Evolution API transport support
--
-- Adds a second WhatsApp transport (self-hosted Evolution API,
-- Baileys) alongside the existing Meta Cloud API, selected per account
-- by a `provider` discriminator so the two coexist during rollout
-- (Evolution now, Meta at the production cutover).
--
-- What this migration does
--   1. Adds `provider` ('meta' | 'evolution', default 'meta') and the
--      Evolution connection columns (base_url, instance_name, api_key)
--      plus instance connection-state columns (instance_state,
--      last_connected_at, last_connection_error).
--   2. Relaxes the Meta-only NOT NULLs (phone_number_id, access_token)
--      so Evolution rows — which carry neither — are valid.
--   3. Moves inbound-routing uniqueness: Meta routes by phone_number_id
--      (013's UNIQUE), Evolution routes by instance_name. Both become
--      PARTIAL unique indexes (WHERE ... IS NOT NULL) so the many rows
--      that hold NULL for the column their provider doesn't use don't
--      collide with each other.
--   4. Adds `remote_jid` + `from_me` to messages so the Evolution path
--      can reconstruct a Baileys message key {remoteJid, fromMe, id}
--      for reactions, read receipts, and reply-quoting. Meta needs only
--      the id (wamid), so these stay NULL for Meta rows.
--
-- Existing rows default to provider='meta' and keep working unchanged.
-- No data is migrated between providers — a Meta access_token is not an
-- Evolution api_key and phone_number_id is not an instance_name; each
-- account re-onboards per provider.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- 1. Columns -------------------------------------------------
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS base_url text,
  ADD COLUMN IF NOT EXISTS instance_name text,
  ADD COLUMN IF NOT EXISTS api_key text,
  ADD COLUMN IF NOT EXISTS instance_state text,
  ADD COLUMN IF NOT EXISTS last_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_connection_error text;

-- 2. Relax Meta-only NOT NULLs -------------------------------
-- Evolution rows carry neither a phone_number_id nor a Meta access_token
-- (their credential lives in api_key). Per-provider presence is enforced
-- by the CHECK in step 3 instead of a blanket NOT NULL.
ALTER TABLE whatsapp_config ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE whatsapp_config ALTER COLUMN access_token DROP NOT NULL;

-- 3. Discriminator + state + per-provider field CHECKs -------
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_provider_check;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_provider_check
  CHECK (provider IN ('meta', 'evolution'));

ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_instance_state_check;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_instance_state_check
  CHECK (instance_state IS NULL OR instance_state IN ('open', 'connecting', 'close'));

-- A row must carry the credentials its transport actually uses, so a
-- half-configured account can't be saved. Existing Meta rows already
-- satisfy the meta branch (phone_number_id + access_token were NOT NULL).
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_provider_fields_check;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_provider_fields_check
  CHECK (
    (
      provider = 'meta'
      AND phone_number_id IS NOT NULL
      AND access_token IS NOT NULL
    )
    OR (
      provider = 'evolution'
      AND base_url IS NOT NULL
      AND instance_name IS NOT NULL
      AND api_key IS NOT NULL
    )
  );

-- 4. Routing uniqueness --------------------------------------
-- Replace 013's plain UNIQUE(phone_number_id) with a PARTIAL unique
-- index so multiple Evolution rows (phone_number_id NULL) coexist while
-- Meta rows stay collision-guarded.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_phone_number_id_key;
DROP INDEX IF EXISTS whatsapp_config_phone_number_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_phone_number_id_uidx
  ON whatsapp_config (phone_number_id)
  WHERE phone_number_id IS NOT NULL;

-- Evolution routes inbound webhook events by instance_name — the same
-- fail-loud-on-duplicate guarantee 013 gave phone_number_id.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_instance_name_uidx
  ON whatsapp_config (instance_name)
  WHERE instance_name IS NOT NULL;

-- 5. Messages: Baileys key parts -----------------------------
-- The Evolution path needs the whole message key to target reactions /
-- read receipts / reply-quotes; message_id alone (Meta's model) is not
-- enough. NULL for Meta rows.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS remote_jid text,
  ADD COLUMN IF NOT EXISTS from_me boolean;
