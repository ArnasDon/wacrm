-- ============================================================
-- 066_action_items.sql — Central de Ações
--
-- Replaces the old "Notificações" tab's purpose. Two independent
-- groups, one table:
--
--   INTERESSES — a manual queue. Created explicitly by an agent from
--   the Inbox or the Pipeline when a lead needs a specific action
--   from Ronaldo/Thatianna. Never auto-populated from the lead's
--   current pipeline stage (a lead sitting in the "Interesse" stage
--   does NOT automatically show up here — see AGENTS.md spec §2).
--
--   FOLLOW-UPS — the Pipeline stays the source of truth for "this
--   lead is in Follow-up"; this table only adds the one thing that
--   stage never had: a required next-contact date (+ reason). The
--   Central's weekly view is computed by joining back to `deals` at
--   read time (current stage_id, matched by stage name = 'Follow-up')
--   — not stored here — so a lead dragged out of that stage on the
--   Pipeline board stops appearing with zero extra wiring (§29).
--
-- `action_item_events` is a lightweight audit trail (created /
-- completed / rescheduled / context changed / outcome recorded) per
-- §24 — append-only, never mutated.
--
-- RLS mirrors deals/contacts (017_account_sharing): account-wide
-- read, 'agent'+ write — this is day-to-day operational data for
-- both Ronaldo and Thatianna, not an admin setting.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS action_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id            uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id               uuid REFERENCES deals(id) ON DELETE SET NULL,
  conversation_id       uuid REFERENCES conversations(id) ON DELETE SET NULL,
  type                  text NOT NULL CHECK (type IN ('interest', 'followup')),
  -- Interesse: "ação necessária". Follow-up: "motivo/contexto".
  title                 text NOT NULL,
  -- Interesse: "contexto/observação" (optional). Follow-up: "observação" (optional).
  description           text,
  -- Required for type='followup' ("próximo contato"); always null for 'interest'.
  due_date              date,
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  -- Set when this item was created from an existing AI suggestion the
  -- user accepted/edited (§6, §8) — provenance only, never read back
  -- to drive behavior.
  source_suggestion_id  uuid REFERENCES ai_suggestions(id) ON DELETE SET NULL,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT action_items_followup_requires_due_date
    CHECK (type <> 'followup' OR due_date IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS action_items_account_type_status_idx
  ON action_items (account_id, type, status);
CREATE INDEX IF NOT EXISTS action_items_contact_id_idx
  ON action_items (contact_id);
CREATE INDEX IF NOT EXISTS action_items_deal_id_idx
  ON action_items (deal_id);
CREATE INDEX IF NOT EXISTS action_items_due_date_idx
  ON action_items (due_date) WHERE type = 'followup' AND status = 'pending';

ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS action_items_select ON action_items;
CREATE POLICY action_items_select ON action_items FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS action_items_insert ON action_items;
CREATE POLICY action_items_insert ON action_items FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS action_items_update ON action_items;
CREATE POLICY action_items_update ON action_items FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS action_items_delete ON action_items;
CREATE POLICY action_items_delete ON action_items FOR DELETE
  USING (is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION public.update_action_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS action_items_updated_at ON action_items;
CREATE TRIGGER action_items_updated_at
  BEFORE UPDATE ON action_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_action_items_updated_at();

-- ---- action_item_events (history — append-only) -------------------

CREATE TABLE IF NOT EXISTS action_item_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_item_id  uuid NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN (
                    'created', 'completed', 'rescheduled',
                    'context_changed', 'outcome_recorded', 'cancelled'
                  )),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_item_events_action_item_id_idx
  ON action_item_events (action_item_id);

ALTER TABLE action_item_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS action_item_events_select ON action_item_events;
CREATE POLICY action_item_events_select ON action_item_events FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS action_item_events_insert ON action_item_events;
CREATE POLICY action_item_events_insert ON action_item_events FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

-- No update/delete policy — the history is append-only by design.

ALTER TABLE action_items REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE action_items;
