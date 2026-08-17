-- ============================================================
-- 060_google_calendar_config.sql — Google Calendar connection
--
-- One connected Google Calendar per wacrm account (UNIQUE(account_id),
-- same "one per account for now" design as whatsapp_config/
-- instagram_config/facebook_config — see 017's comment for the future
-- multi-account escape hatch). Unlike every prior external-service
-- config table, Google's access_token expires in ~1h, so this is the
-- first one that needs a token_expiry column and refresh-before-use
-- handling (src/lib/google-calendar/oauth.ts's getValidAccessToken()).
--
-- refresh_token / access_token are AES-256-GCM encrypted with the same
-- src/lib/whatsapp/encryption.ts helper (ENCRYPTION_KEY) every other
-- secret-at-rest in this project already uses.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS google_calendar_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- audit-only, not tenancy
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,      -- AES-256-GCM encrypted, long-lived
  access_token TEXT,                -- AES-256-GCM encrypted, ~1h lifetime
  token_expiry TIMESTAMPTZ,         -- when access_token stops being valid — no prior config table has needed this
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  calendar_email TEXT,              -- the connected Google account's email, shown in Settings so it's clear which calendar is wired up
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  last_connection_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_google_calendar_config_account ON google_calendar_config(account_id);

ALTER TABLE google_calendar_config ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON google_calendar_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON google_calendar_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS google_calendar_config_select ON google_calendar_config;
DROP POLICY IF EXISTS google_calendar_config_insert ON google_calendar_config;
DROP POLICY IF EXISTS google_calendar_config_update ON google_calendar_config;
DROP POLICY IF EXISTS google_calendar_config_delete ON google_calendar_config;
CREATE POLICY google_calendar_config_select ON google_calendar_config FOR SELECT USING (is_account_member(account_id));
CREATE POLICY google_calendar_config_insert ON google_calendar_config FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY google_calendar_config_update ON google_calendar_config FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY google_calendar_config_delete ON google_calendar_config FOR DELETE USING (is_account_member(account_id, 'admin'));
