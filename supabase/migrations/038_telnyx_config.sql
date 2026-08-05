-- ============================================================
-- 038_telnyx_config.sql — Telnyx configuration (voice/SMS)
--
-- Adds the `telnyx_config` table, 1:1 with `accounts`, holding the
-- Telnyx API key ENCRYPTED at rest (AES-256-GCM via
-- src/lib/whatsapp/encryption.ts, same as whatsapp_config /
-- ai_configs), plus the Call Control App id and the default
-- outbound number.
--
-- RLS
--   owner-only table: only `owner` reads/edits the API key. The
--   server-side routes use the service-role (admin-client) client,
--   which bypasses RLS; the browser never reads the key row.
--
-- `updated_at` is maintained by the repo-standard trigger
-- `update_updated_at_column()` (001:344).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS telnyx_config (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  api_key_encrypted   text NOT NULL,              -- encrypt(api_key) via src/lib/whatsapp/encryption.ts
  call_control_app_id text,                       -- Call Control App id (Telnyx)
  default_from_number text,                       -- E.164
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE telnyx_config ENABLE ROW LEVEL SECURITY;

-- Only `owner` can read/insert/update the API key. The webhook and
-- server routes use service-role (admin-client) which bypasses RLS.
DROP POLICY IF EXISTS telnyx_config_select ON telnyx_config;
CREATE POLICY telnyx_config_select ON telnyx_config FOR SELECT
  USING (is_account_member(account_id, 'owner'));

DROP POLICY IF EXISTS telnyx_config_insert ON telnyx_config;
CREATE POLICY telnyx_config_insert ON telnyx_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'owner'));

DROP POLICY IF EXISTS telnyx_config_update ON telnyx_config;
CREATE POLICY telnyx_config_update ON telnyx_config FOR UPDATE
  USING (is_account_member(account_id, 'owner'))
  WITH CHECK (is_account_member(account_id, 'owner'));

-- delete: intentionally no policy — config is revoked in place, never
-- hard-deleted through the client.

DROP TRIGGER IF EXISTS set_updated_at ON telnyx_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON telnyx_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();