-- ============================================================
-- 041_appointments.sql — custom feature, not part of the upstream
-- wacrm template.
--
-- Backs the dashboard's "Agenda do Dia" (today's schedule) and lays
-- the groundwork for the previously-analysed-but-unbuilt Follow-up /
-- Tasks module (see docs/ROADMAP.md item 4): same shape, broader UI
-- later (monthly calendar, reminders, WhatsApp / Google Calendar
-- sync). scheduled_date/scheduled_time are split (not one
-- timestamptz) so "today" filtering is a plain date comparison done
-- client-side against the account's local day — matching how
-- src/lib/dashboard/date-utils.ts already treats "today" everywhere
-- else on this dashboard — and so a future calendar view can group
-- rows by scheduled_date without timezone conversion.
-- ============================================================

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'other'
    CHECK (type IN ('call', 'visit', 'meeting', 'proposal', 'follow_up', 'other')),
  scheduled_date DATE NOT NULL,
  scheduled_time TIME,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_account_date
  ON appointments(account_id, scheduled_date, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_appointments_contact ON appointments(contact_id);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

-- Same governance level as deals — any agent can create/manage
-- appointments, any member can see the shared agenda.
DROP POLICY IF EXISTS appointments_select ON appointments;
DROP POLICY IF EXISTS appointments_insert ON appointments;
DROP POLICY IF EXISTS appointments_update ON appointments;
DROP POLICY IF EXISTS appointments_delete ON appointments;
CREATE POLICY appointments_select ON appointments FOR SELECT USING (is_account_member(account_id));
CREATE POLICY appointments_insert ON appointments FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY appointments_update ON appointments FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY appointments_delete ON appointments FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON appointments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
