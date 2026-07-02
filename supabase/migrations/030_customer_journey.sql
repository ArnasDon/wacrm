-- ============================================================
-- 030_customer_journey.sql — Sales-funnel Kanban (customer journey)
--
-- The Pipelines Kanban is deal-centric: a card only exists once
-- someone opens an opportunity. This adds a second, contact-centric
-- board — every contact enters automatically the moment they send
-- their first inbound message, and moves through qualification
-- stages before (optionally) becoming a Deal in a Pipeline.
--
-- Design notes
--   - `funnel_stages` mirrors `pipeline_stages` (account-scoped,
--     name/color/position) but has no settings UI yet — stages are
--     seeded once per account from a fixed list in the app
--     (SPEC_DEFAULT_FUNNEL_STAGES), the same client-side
--     seed-if-empty pattern `pipelines/page.tsx` uses for
--     `pipeline_stages`. `key` is a stable machine name (e.g.
--     'new_lead') so app code can find "the first stage" or
--     "the negotiation stage" without depending on display order.
--   - `contact_journey` is the mutable current state: exactly one row
--     per (account, contact). `entered_stage_at` resets on every
--     stage change and drives the "stalled lead" aging badge in the
--     UI.
--   - `contact_journey_transitions` is an append-only log — the
--     reason this is a dedicated table instead of a column on
--     `contacts` is to measure time-in-stage and stage-to-stage
--     conversion later. `from_stage_id` is NULL for the initial
--     entry; `changed_by` is NULL when the automatic webhook hook
--     created the row (no human in the loop), same convention as
--     `contact_journey`'s own audit-less inserts.
--
-- RLS
--   Same shape as `deals`: any account member may read; agent+ may
--   write (create/move cards). The inbound webhooks use
--   supabaseAdmin() and already bypass RLS, same as the rest of the
--   inbound message path.
-- ============================================================

CREATE TABLE IF NOT EXISTS funnel_stages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, key)
);

CREATE INDEX IF NOT EXISTS idx_funnel_stages_account ON funnel_stages(account_id);

ALTER TABLE funnel_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS funnel_stages_select ON funnel_stages;
DROP POLICY IF EXISTS funnel_stages_insert ON funnel_stages;
DROP POLICY IF EXISTS funnel_stages_update ON funnel_stages;
DROP POLICY IF EXISTS funnel_stages_delete ON funnel_stages;
CREATE POLICY funnel_stages_select ON funnel_stages FOR SELECT USING (is_account_member(account_id));
CREATE POLICY funnel_stages_insert ON funnel_stages FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY funnel_stages_update ON funnel_stages FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY funnel_stages_delete ON funnel_stages FOR DELETE USING (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS contact_journey (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES funnel_stages(id),
  entered_stage_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_journey_account ON contact_journey(account_id);
CREATE INDEX IF NOT EXISTS idx_contact_journey_stage ON contact_journey(stage_id);

ALTER TABLE contact_journey ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_journey_select ON contact_journey;
DROP POLICY IF EXISTS contact_journey_insert ON contact_journey;
DROP POLICY IF EXISTS contact_journey_update ON contact_journey;
DROP POLICY IF EXISTS contact_journey_delete ON contact_journey;
CREATE POLICY contact_journey_select ON contact_journey FOR SELECT USING (is_account_member(account_id));
CREATE POLICY contact_journey_insert ON contact_journey FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY contact_journey_update ON contact_journey FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY contact_journey_delete ON contact_journey FOR DELETE USING (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS contact_journey_transitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_journey_id UUID NOT NULL REFERENCES contact_journey(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES funnel_stages(id),
  to_stage_id UUID NOT NULL REFERENCES funnel_stages(id),
  changed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_journey_transitions_journey ON contact_journey_transitions(contact_journey_id);
CREATE INDEX IF NOT EXISTS idx_contact_journey_transitions_account ON contact_journey_transitions(account_id);

ALTER TABLE contact_journey_transitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_journey_transitions_select ON contact_journey_transitions;
DROP POLICY IF EXISTS contact_journey_transitions_insert ON contact_journey_transitions;
CREATE POLICY contact_journey_transitions_select ON contact_journey_transitions FOR SELECT USING (is_account_member(account_id));
CREATE POLICY contact_journey_transitions_insert ON contact_journey_transitions FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
-- Append-only: no UPDATE/DELETE policy, mirroring automation_logs.
