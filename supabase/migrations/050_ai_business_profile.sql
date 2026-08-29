-- ============================================================
-- 050_ai_business_profile.sql
--
-- AI optimization project (FASE 6) — structured business information
-- the agent can ground identity/contact/hours/delivery/payment/policy
-- answers in, plus an internal directory of departments/contacts for
-- handoff ("quiero hablar con ventas" / "quiero hablar con Carlos").
--
-- Deliberately generic — nothing here names a product category or
-- industry. The same three tables serve a phone store, a hardware
-- store, a restaurant, or a hair salon identically.
--
-- Table choice (per the audit): a dedicated `account_business_profiles`
-- row per account rather than inflating `accounts` with dozens of
-- columns — mirrors how `ai_configs`/`ai_data_sources` already live
-- outside `accounts`. Departments/contacts are relational (a contact
-- belongs to zero-or-one department, needs its own active/sort_order/
-- lookup-by-name semantics) so they get real tables, not a JSON blob —
-- exactly the "no crear JSON gigante si dificulta... referencias"
-- guidance. Hours/links/FAQ/payment-methods/coverage-areas ARE plain
-- collections with no relational needs of their own, so those stay
-- JSONB/array columns on the profile row itself, per the same guidance
-- in the other direction.
--
-- Purely additive — no existing table is altered destructively, no
-- existing column is dropped/retyped, no row is rewritten. `ai_configs`,
-- `ai_data_sources`, `ai_catalog_products`, `ai_knowledge_documents`,
-- `ai_knowledge_chunks`, and `ai_usage_log` are untouched. Every
-- account without a configured profile/department/contact keeps
-- working exactly as before this migration — every lookup this feature
-- adds tolerates "not found" as a normal, silent case, never an error.
-- Safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- account_business_profiles — one row per account (or zero).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_business_profiles (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Identidad
  business_name           text,
  description             text,

  -- Contacto general
  phone                   text,
  whatsapp                text,
  email                   text,
  website                 text,

  -- Ubicación
  address                 text,
  city                    text,
  state                   text,
  country                 text,
  google_maps_url         text,

  -- Horarios — { monday: {enabled, open, close}, ..., sunday: {...} }.
  -- Validated at the application layer (src/lib/ai/business-profile/
  -- types.ts), not with a CHECK — the exact shape is easier to evolve
  -- in code than in a constraint, and a malformed/partial value here is
  -- still safely ignorable by buildBusinessProfileContext() rather than
  -- a write-time failure.
  business_hours          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Delivery
  delivery_enabled        boolean NOT NULL DEFAULT false,
  delivery_description    text,
  delivery_coverage_areas text[] NOT NULL DEFAULT '{}',

  -- Pagos — simple list of method names/labels, same shape as
  -- catalog_integrations.scopes (migration 044).
  payment_methods         text[] NOT NULL DEFAULT '{}',

  -- Políticas — free text, one per concern so the agent (and the
  -- admin editing them) never has to disentangle unrelated policies
  -- pasted into one paragraph.
  warranty_policy         text,
  return_policy           text,
  financing_policy        text,
  delivery_policy         text,

  -- Enlaces adicionales — [{label, url, type}], type free-form
  -- ('social' | 'website' | ... ) — deliberately not an enum so a new
  -- link kind never needs a migration.
  links                   jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- FAQ — [{question, answer}].
  faq                     jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE account_business_profiles ENABLE ROW LEVEL SECURITY;

-- Settings-class RLS, identical shape to ai_configs / ai_data_sources /
-- catalog_integrations: any member may read (the agent's own reads go
-- through the service-role client and don't depend on this), only
-- admin+ may write.
DROP POLICY IF EXISTS account_business_profiles_select ON account_business_profiles;
CREATE POLICY account_business_profiles_select ON account_business_profiles FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS account_business_profiles_insert ON account_business_profiles;
CREATE POLICY account_business_profiles_insert ON account_business_profiles FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS account_business_profiles_update ON account_business_profiles;
CREATE POLICY account_business_profiles_update ON account_business_profiles FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS account_business_profiles_delete ON account_business_profiles;
CREATE POLICY account_business_profiles_delete ON account_business_profiles FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.set_business_profile_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

DROP TRIGGER IF EXISTS account_business_profiles_set_updated_at ON account_business_profiles;
CREATE TRIGGER account_business_profiles_set_updated_at
  BEFORE UPDATE ON account_business_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_business_profile_updated_at();

-- ------------------------------------------------------------
-- account_business_departments — the admin creates these freely; no
-- fixed list ("Ventas"/"Soporte"/"Créditos" are examples, not values
-- this schema knows about).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_business_departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness per account — this is also what makes
-- department name matching for handoff intent unambiguous ("Ventas"
-- and "ventas" are the same department, never two different rows to
-- confuse a match against).
CREATE UNIQUE INDEX IF NOT EXISTS account_business_departments_account_name_idx
  ON account_business_departments (account_id, lower(name));
CREATE INDEX IF NOT EXISTS account_business_departments_account_id_idx
  ON account_business_departments (account_id);

ALTER TABLE account_business_departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_business_departments_select ON account_business_departments;
CREATE POLICY account_business_departments_select ON account_business_departments FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS account_business_departments_insert ON account_business_departments;
CREATE POLICY account_business_departments_insert ON account_business_departments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS account_business_departments_update ON account_business_departments;
CREATE POLICY account_business_departments_update ON account_business_departments FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS account_business_departments_delete ON account_business_departments;
CREATE POLICY account_business_departments_delete ON account_business_departments FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS account_business_departments_set_updated_at ON account_business_departments;
CREATE TRIGGER account_business_departments_set_updated_at
  BEFORE UPDATE ON account_business_departments
  FOR EACH ROW EXECUTE FUNCTION public.set_business_profile_updated_at();

-- ------------------------------------------------------------
-- account_business_contacts — a named person within (optionally) one
-- department. `linked_user_id` is OPTIONAL and separate from
-- `assigned_agent_id`-style CRM assignment: most contacts (a
-- salesperson, a technician) will never be a signed-in CRM user at
-- all — this column only matters for the rare case where the business
-- WANTS a specific contact's handoff to auto-assign to their own real
-- CRM login, and is null otherwise (the default, safe path: handoff
-- still happens, just without an automatic assignee).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_business_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  department_id   uuid REFERENCES account_business_departments(id) ON DELETE SET NULL,
  name            text NOT NULL,
  role_title      text,
  phone           text,
  whatsapp        text,
  email           text,
  -- Internal admin annotation — never sent to the model (see
  -- buildBusinessProfileContext in src/lib/ai/business-profile/
  -- context.ts). Kept purely for the human side of Settings.
  notes           text,
  active          boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 100,
  -- Optional link to a real CRM member — see the table doc above.
  linked_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_business_contacts_account_id_idx
  ON account_business_contacts (account_id);
CREATE INDEX IF NOT EXISTS account_business_contacts_department_id_idx
  ON account_business_contacts (department_id);
-- Name-lookup for handoff intent matching ("quiero hablar con Carlos").
CREATE INDEX IF NOT EXISTS account_business_contacts_account_name_idx
  ON account_business_contacts (account_id, lower(name));

ALTER TABLE account_business_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_business_contacts_select ON account_business_contacts;
CREATE POLICY account_business_contacts_select ON account_business_contacts FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS account_business_contacts_insert ON account_business_contacts;
CREATE POLICY account_business_contacts_insert ON account_business_contacts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS account_business_contacts_update ON account_business_contacts;
CREATE POLICY account_business_contacts_update ON account_business_contacts FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS account_business_contacts_delete ON account_business_contacts;
CREATE POLICY account_business_contacts_delete ON account_business_contacts FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS account_business_contacts_set_updated_at ON account_business_contacts;
CREATE TRIGGER account_business_contacts_set_updated_at
  BEFORE UPDATE ON account_business_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_business_profile_updated_at();

-- ------------------------------------------------------------
-- Handoff enrichment — structured record of WHICH department/contact
-- an AI handoff resolved to, alongside the existing free-text
-- `ai_handoff_summary` (migration 033). Both nullable/additive; every
-- conversation that predates this feature (or every handoff with no
-- department/contact match) simply has both null, exactly as before.
-- ------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_handoff_department_id uuid REFERENCES account_business_departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_handoff_contact_id uuid REFERENCES account_business_contacts(id) ON DELETE SET NULL;
