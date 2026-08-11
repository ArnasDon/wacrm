-- ============================================================
-- 053_calendar_connections.sql — custom feature, not part of the
-- upstream wacrm template.
--
-- Backs the real Google Calendar integration: one row per *user*
-- (not per account, unlike whatsapp_config) since each agent
-- connects their own personal Google account, not a shared one.
-- src/lib/calendar/google-calendar-provider.ts reads/writes this
-- table; see that module for the OAuth + sync implementation.
-- ============================================================

CREATE TABLE IF NOT EXISTS calendar_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  provider TEXT NOT NULL DEFAULT 'google_calendar',
  google_email TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_connections_account ON calendar_connections(account_id);

ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;

-- Own-row-only, all four verbs. This holds a personal OAuth
-- credential, not team-shared data like whatsapp_config — a
-- teammate should never be able to see or delete another agent's
-- Google Calendar connection.
DROP POLICY IF EXISTS calendar_connections_own ON calendar_connections;
CREATE POLICY calendar_connections_own ON calendar_connections
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS set_updated_at ON calendar_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON calendar_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
