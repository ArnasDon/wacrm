-- ============================================================
-- 049_ai_suggestions.sql — foundation for the "Central de IA"
--
-- The Central de IA (sidebar, replaces the old top-level "AI Agents"
-- entry — that page's Setup/Playground/Usage tabs move into
-- Settings > AI Agents, see the app-layer change alongside this
-- migration) is the operational home for everything the AI
-- recommends: pipeline-move suggestions, suggested actions,
-- follow-up nudges, pending learnings, inconsistencies worth a
-- human's attention, and anything else. This table is the single
-- place all of those land, so the Inbox stays free of AI clutter —
-- it will only ever show a discreet "N sugestões pendentes" hint
-- pointing here (not built in this migration).
--
-- Nothing writes to this table yet — no generation job exists. This
-- migration only lays the foundation: schema + RLS. The `payload`
-- jsonb column is deliberately loose (not typed per category) since
-- the shape of e.g. a "move this deal to stage X" suggestion and a
-- "these two contacts look duplicated" suggestion have nothing in
-- common — callers interpret it by `category`.
--
-- RLS mirrors ai_knowledge_documents (030): any account member can
-- read, and — since resolving a suggestion (approve/reject/ignore/
-- done) is a day-to-day operational action, not an admin setting —
-- any member can update status. Creating/deleting suggestions stays
-- admin+ for now; the future generation job runs as service_role
-- (bypasses RLS) so this only gates manual/dashboard writes.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_suggestions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  category        text NOT NULL CHECK (category IN (
                    'pipeline_move', 'action', 'followup',
                    'learning', 'inconsistency', 'other'
                  )),
  title           text NOT NULL,
  description     text,
  -- Category-specific detail (e.g. proposed stage_id for a
  -- pipeline_move, or the two contact_ids flagged as duplicates for
  -- an inconsistency). Interpreted by category, not enforced here.
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN (
                    'pending', 'approved', 'rejected', 'ignored', 'done'
                  )),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_suggestions_account_status_idx
  ON ai_suggestions (account_id, status);
CREATE INDEX IF NOT EXISTS ai_suggestions_account_category_idx
  ON ai_suggestions (account_id, category);
CREATE INDEX IF NOT EXISTS ai_suggestions_contact_id_idx
  ON ai_suggestions (contact_id);
CREATE INDEX IF NOT EXISTS ai_suggestions_conversation_id_idx
  ON ai_suggestions (conversation_id);

ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_suggestions_select ON ai_suggestions;
CREATE POLICY ai_suggestions_select ON ai_suggestions FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_suggestions_insert ON ai_suggestions;
CREATE POLICY ai_suggestions_insert ON ai_suggestions FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

-- Any member (not just admin+) may transition status — approving,
-- rejecting, ignoring, or completing a suggestion is normal agent
-- work, not an account setting.
DROP POLICY IF EXISTS ai_suggestions_update ON ai_suggestions;
CREATE POLICY ai_suggestions_update ON ai_suggestions FOR UPDATE
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_suggestions_delete ON ai_suggestions;
CREATE POLICY ai_suggestions_delete ON ai_suggestions FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_suggestions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_suggestions_updated_at ON ai_suggestions;
CREATE TRIGGER ai_suggestions_updated_at
  BEFORE UPDATE ON ai_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_suggestions_updated_at();
