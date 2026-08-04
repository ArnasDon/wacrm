-- ============================================================
-- 045_properties_and_weekly_agenda.sql — custom feature, not part
-- of the upstream wacrm template.
--
-- Backs the "Agenda da Semana" weekly calendar: a minimal `properties`
-- (imóveis) table so an appointment can reference which listing it's
-- about, plus columns on `appointments` for a free-text `notes` field
-- (separate from `description`) and for a *future* Google Calendar
-- sync (migration adds the columns now; src/lib/calendar/ adds the
-- provider/mapper/service scaffolding — no OAuth, no external API
-- calls yet, see that module's own comments).
-- ============================================================

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_account ON properties(account_id);

ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

-- Same governance as appointments/deals — any agent can add a
-- listing while scheduling a visit, any member can see it.
DROP POLICY IF EXISTS properties_select ON properties;
DROP POLICY IF EXISTS properties_insert ON properties;
DROP POLICY IF EXISTS properties_update ON properties;
DROP POLICY IF EXISTS properties_delete ON properties;
CREATE POLICY properties_select ON properties FOR SELECT USING (is_account_member(account_id));
CREATE POLICY properties_insert ON properties FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY properties_update ON properties FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY properties_delete ON properties FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON properties;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- appointments — property link, notes, and Google Calendar sync
-- placeholders. All new columns are nullable/defaulted so this is a
-- zero-downtime, backward-compatible change; nothing here requires
-- every appointment to have a property (the UI encourages it, the
-- schema doesn't force it — see queries.ts comments).
-- ============================================================
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS external_calendar_id TEXT,
  ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'not_synced'
    CHECK (sync_status IN ('not_synced', 'synced', 'error')),
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_appointments_property ON appointments(property_id);
