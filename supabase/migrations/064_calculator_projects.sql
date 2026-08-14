-- ============================================================
-- 064_calculator_projects.sql — custom feature, not part of the
-- upstream wacrm template.
--
-- Backs the "Calculadora de Fluxo Imobiliário" module (new /calculadora
-- route, isolated from the rest of the CRM). A "calc_project" is a
-- reusable empreendimento (e.g. "Mahal") that stores only the SHAPE of
-- its payment flow — an ordered list of components (entrada, mensais,
-- intermediárias, financiamento, ...) with their kind and default
-- lock/count. It intentionally does NOT store per-unit amounts: those
-- are filled in at simulation time (unit, valor do imóvel, actual
-- values) and never persisted — the calculator computes locally and
-- only touches the DB for the reusable template, per the module's own
-- "no DB calls for real-time math" rule (see src/lib/calculator/).
--
-- `components` is JSONB (not a normalized table) on purpose: the
-- component set must stay extensible (new component kinds later)
-- without further migrations, and it's never queried/filtered by
-- Postgres — only read whole and interpreted client-side.
-- ============================================================

CREATE TABLE IF NOT EXISTS calc_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  components JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calc_projects_account ON calc_projects(account_id);

ALTER TABLE calc_projects ENABLE ROW LEVEL SECURITY;

-- Same governance shape as properties — any agent can register an
-- empreendimento template, any account member can use it to simulate.
DROP POLICY IF EXISTS calc_projects_select ON calc_projects;
DROP POLICY IF EXISTS calc_projects_insert ON calc_projects;
DROP POLICY IF EXISTS calc_projects_update ON calc_projects;
DROP POLICY IF EXISTS calc_projects_delete ON calc_projects;
CREATE POLICY calc_projects_select ON calc_projects FOR SELECT USING (is_account_member(account_id));
CREATE POLICY calc_projects_insert ON calc_projects FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY calc_projects_update ON calc_projects FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY calc_projects_delete ON calc_projects FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON calc_projects;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON calc_projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
