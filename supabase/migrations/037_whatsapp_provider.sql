-- ============================================================
-- whatsapp_config: multi-provider support (Meta Cloud API + Evolution Go)
--
-- Why this exists:
--   Every whatsapp_config row (one per account, see migration 017) only
--   ever meant "the Meta Cloud API credentials for this account's
--   number." This adds an alternative transport — Evolution Go, an
--   unofficial WhatsApp API (baileys/whatsmeow-based, self-hosted) —
--   so an account can connect its number through either provider.
--
--   `provider` picks which transport send-message.ts and the inbound
--   webhook route use for this account. Existing rows default to
--   'meta' so nothing changes for accounts that don't touch this.
--
--   The evolution_* columns mirror how Meta credentials are already
--   stored: `evolution_instance_token` and `evolution_admin_token` are
--   AES-256-GCM encrypted with the same ENCRYPTION_KEY / encrypt()
--   helper used for `access_token` (src/lib/whatsapp/encryption.ts) —
--   never store them in plaintext.
--
--   - evolution_api_url: base URL of the Evolution Go instance the
--     account points at (self-hosted, so this varies per account).
--   - evolution_instance_name / evolution_instance_uuid: identify the
--     WhatsApp session ("instance") created on that Evolution Go
--     server via POST /instance/create.
--   - evolution_instance_token: per-instance apikey, used to send
--     messages and to authenticate inbound webhook deliveries (the
--     Evolution Go webhook has no Meta-style HMAC signature — the
--     inbound route instead checks the instanceToken in the payload
--     against this column before trusting it).
--   - evolution_admin_token: the Evolution Go server's admin apikey,
--     needed for instance lifecycle calls (create/logout/delete).
--
-- All evolution_* columns are nullable — a 'meta' row never populates
-- them. Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta', 'evolution')),
  ADD COLUMN IF NOT EXISTS evolution_api_url TEXT,
  ADD COLUMN IF NOT EXISTS evolution_instance_name TEXT,
  ADD COLUMN IF NOT EXISTS evolution_instance_uuid TEXT,
  ADD COLUMN IF NOT EXISTS evolution_instance_token TEXT,
  ADD COLUMN IF NOT EXISTS evolution_admin_token TEXT;

-- Webhook routing for Evolution Go looks up the owning account by
-- instance_uuid (there's no phone_number_id equivalent until the
-- number registers) — same "must resolve to exactly one row" need
-- that motivated the phone_number_id UNIQUE constraint in migration
-- 013.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_evolution_instance_uuid
  ON whatsapp_config (evolution_instance_uuid)
  WHERE evolution_instance_uuid IS NOT NULL;

-- ─── Relax Meta-only NOT NULL constraints ──────────────────────────
-- phone_number_id and access_token were NOT NULL from day one (every
-- row used to mean "a Meta config"). An evolution-provider row has
-- neither — it has evolution_instance_token instead. Drop the
-- blanket NOT NULL and replace it with a per-provider CHECK so a
-- 'meta' row still can't be saved without its credentials, and an
-- 'evolution' row can't be saved without its own.
ALTER TABLE whatsapp_config
  ALTER COLUMN phone_number_id DROP NOT NULL,
  ALTER COLUMN access_token DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_meta_fields_required'
      AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_meta_fields_required
      CHECK (
        provider <> 'meta'
        OR (phone_number_id IS NOT NULL AND access_token IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_evolution_fields_required'
      AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_evolution_fields_required
      CHECK (
        provider <> 'evolution'
        OR (evolution_api_url IS NOT NULL AND evolution_instance_token IS NOT NULL)
      );
  END IF;
END $$;
