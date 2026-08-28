-- ============================================================
-- 090_google_sheets_config.sql — Google Sheets connection (per account)
--
-- Same shape and lifecycle as google_calendar_config (migration 060):
-- one connected Google account per wacrm account, OAuth Authorization
-- Code flow with `access_type=offline`, access_token expires ~1h so a
-- token_expiry column + refresh-before-use (src/lib/google-sheets/
-- oauth.ts's getValidAccessToken). refresh_token / access_token are
-- AES-256-GCM encrypted with src/lib/whatsapp/encryption.ts
-- (ENCRYPTION_KEY), like every other secret-at-rest here.
--
-- Feature-specific columns:
--   spreadsheet_id  — the target Google Sheet
--   sheet_tab       — base worksheet name; the row builder routes each
--                     event category to `sheet_tab` or a suffixed tab
--                     ("<sheet_tab> - Cotizaciones", "... - Leads", ...)
--                     so mixed event types never share a column layout
--   events          — which CRM events append a row (free text[], same
--                     model as webhook_endpoints.events; no migration to
--                     add a new event, just an entry in
--                     src/lib/webhooks/events.ts + a row-builder case)
--   headers_written — jsonb { "<tab name>": true } — which tabs already
--                     have their header row
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS google_sheets_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- audit-only, not tenancy
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,      -- AES-256-GCM encrypted, long-lived
  access_token TEXT,                -- AES-256-GCM encrypted, ~1h lifetime
  token_expiry TIMESTAMPTZ,
  google_email TEXT,                -- the connected Google account, shown in Settings
  spreadsheet_id TEXT,             -- null until the operator picks a target sheet
  spreadsheet_name TEXT,           -- display-only, fetched once at pick time
  sheet_tab TEXT NOT NULL DEFAULT 'Ventas',
  events TEXT[] NOT NULL DEFAULT ARRAY['deal.won']::text[],
  headers_written JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  last_write_at TIMESTAMPTZ,
  last_connection_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_google_sheets_config_account ON google_sheets_config(account_id);

ALTER TABLE google_sheets_config ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON google_sheets_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON google_sheets_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS google_sheets_config_select ON google_sheets_config;
DROP POLICY IF EXISTS google_sheets_config_insert ON google_sheets_config;
DROP POLICY IF EXISTS google_sheets_config_update ON google_sheets_config;
DROP POLICY IF EXISTS google_sheets_config_delete ON google_sheets_config;
CREATE POLICY google_sheets_config_select ON google_sheets_config FOR SELECT USING (is_account_member(account_id));
CREATE POLICY google_sheets_config_insert ON google_sheets_config FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY google_sheets_config_update ON google_sheets_config FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY google_sheets_config_delete ON google_sheets_config FOR DELETE USING (is_account_member(account_id, 'admin'));
