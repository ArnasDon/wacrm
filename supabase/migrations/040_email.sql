-- ============================================================
-- 040_email.sql — Email via Resend: config + HTML templates
--
-- Two tables backing transactional email (closes the GHL gap):
--
--   1. `email_config` (1:1 with `accounts`) — Resend API key
--      ENCRYPTED at rest (AES-256-GCM, same encryption as
--      whatsapp_config / ai_configs) + sender address.
--   2. `email_templates` — full-HTML templates (copy/paste), stored
--      by `name`, used by the `send_email` automation step. Same
--      pattern as `message_templates` (014/017).
--
-- RLS
--   email_config: owner-only (contains an encrypted secret).
--   email_templates: agent+ read, owner+ write (mirrors
--   message_templates / tags in 017).
--
-- `updated_at` via the repo-standard trigger `update_updated_at_column()`.
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. email_config — 1:1 con accounts
-- ============================================================
CREATE TABLE IF NOT EXISTS email_config (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  resend_api_key_encrypted  text NOT NULL,   -- encrypt(api_key) via src/lib/whatsapp/encryption.ts
  from_email                text NOT NULL,   -- "Mi Pyme <hola@midominio.com>"
  reply_to                  text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_config_select ON email_config;
CREATE POLICY email_config_select ON email_config FOR SELECT
  USING (is_account_member(account_id, 'owner'));

DROP POLICY IF EXISTS email_config_insert ON email_config;
CREATE POLICY email_config_insert ON email_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'owner'));

DROP POLICY IF EXISTS email_config_update ON email_config;
CREATE POLICY email_config_update ON email_config FOR UPDATE
  USING (is_account_member(account_id, 'owner'))
  WITH CHECK (is_account_member(account_id, 'owner'));

-- delete: none — config is revoked in place, never hard-deleted.

DROP TRIGGER IF EXISTS set_updated_at ON email_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON email_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. email_templates — HTML full, lista de nombres
-- ============================================================
CREATE TABLE IF NOT EXISTS email_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        text NOT NULL,                -- nombre único por account
  subject     text NOT NULL,                -- asunto
  body_html   text NOT NULL,                -- HTML completo copiado del template del usuario
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_email_templates_account ON email_templates (account_id);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_templates_select ON email_templates;
CREATE POLICY email_templates_select ON email_templates FOR SELECT
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS email_templates_insert ON email_templates;
CREATE POLICY email_templates_insert ON email_templates FOR INSERT
  WITH CHECK (is_account_member(account_id, 'owner'));

DROP POLICY IF EXISTS email_templates_update ON email_templates;
CREATE POLICY email_templates_update ON email_templates FOR UPDATE
  USING (is_account_member(account_id, 'owner'))
  WITH CHECK (is_account_member(account_id, 'owner'));

DROP TRIGGER IF EXISTS set_updated_at ON email_templates;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();