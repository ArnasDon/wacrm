-- ============================================================
-- 050_lead_intelligence.sql — BLOCO 2/4: inteligência de leads
--
-- Foundation for automatic conversation analysis: a persisted,
-- incrementally-updated structured summary per contact
-- (`lead_intelligence`), plus the plumbing needed to keep the AI's
-- tag writes and pipeline-move suggestions consistent and cheap to
-- run on every inbound message.
--
-- Three independent changes:
--
--   1. `tags.user_id` becomes nullable — tags created by the lead
--      analysis job have no human author (mirrors `ai_suggestions.
--      created_by` / `ai_knowledge_documents.created_by`, both
--      already nullable for exactly this "system, not a person"
--      reason). account_id (migration 017) is the real scoping
--      column; user_id was always just "who created it".
--
--   2. `ai_usage_log.mode` gets a third value, 'lead_analysis', so
--      this feature's token spend shows up in the same cost ledger
--      as auto-reply/draft instead of needing a parallel table.
--
--   3. `lead_intelligence` — one row per contact, holding the
--      current structured state extracted from the conversation
--      (see `LeadSummary` in src/lib/ai/lead-analysis-types.ts) and
--      a pointer to the newest message already folded into it. Each
--      analysis run reads only messages newer than `last_message_id`
--      plus this persisted summary — never the whole conversation
--      again — which is what keeps repeated runs cheap (section 17
--      of the block 2 spec). `claim_lead_analysis_slot` is the
--      concurrency + cooldown guard: two inbound messages landing
--      seconds apart must not both trigger a full analysis run.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- 1. tags.user_id nullable (AI/system-created tags).
-- ------------------------------------------------------------
ALTER TABLE tags ALTER COLUMN user_id DROP NOT NULL;

-- ------------------------------------------------------------
-- 2. ai_usage_log.mode widened.
-- ------------------------------------------------------------
ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'lead_analysis'));

-- ------------------------------------------------------------
-- 3. lead_intelligence.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_intelligence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id        uuid NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE CASCADE,
  -- Current-state structured summary (see LeadSummary type) —
  -- REPLACED wholesale on every run, never appended to. The model is
  -- given this as input alongside the new messages and returns the
  -- next full state, so "Bessa doesn't interest me anymore" naturally
  -- drops out instead of accumulating.
  summary           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Newest message already folded into `summary` — the next run only
  -- needs to fetch messages after this one.
  last_message_id   uuid REFERENCES messages(id) ON DELETE SET NULL,
  last_analyzed_at  timestamptz,
  -- Claim lock for claim_lead_analysis_slot: set to the claim time,
  -- read back as "last attempt started at" for the cooldown check.
  analyzing_since   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_intelligence_account
  ON lead_intelligence(account_id);

ALTER TABLE lead_intelligence ENABLE ROW LEVEL SECURITY;

-- Settings/internal-class: any member may read (a future UI surface
-- could show it), writes are system-only (service role bypasses RLS;
-- no dashboard form exists to hand-edit this).
DROP POLICY IF EXISTS lead_intelligence_select ON lead_intelligence;
CREATE POLICY lead_intelligence_select ON lead_intelligence FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS lead_intelligence_insert ON lead_intelligence;
CREATE POLICY lead_intelligence_insert ON lead_intelligence FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS lead_intelligence_update ON lead_intelligence;
CREATE POLICY lead_intelligence_update ON lead_intelligence FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS lead_intelligence_delete ON lead_intelligence;
CREATE POLICY lead_intelligence_delete ON lead_intelligence FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_lead_intelligence_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lead_intelligence_updated_at ON lead_intelligence;
CREATE TRIGGER lead_intelligence_updated_at
  BEFORE UPDATE ON lead_intelligence
  FOR EACH ROW
  EXECUTE FUNCTION public.update_lead_intelligence_updated_at();

-- ------------------------------------------------------------
-- Atomic claim: ensures a row exists, then claims it only if no
-- other run claimed it within the cooldown window. Mirrors
-- claim_ai_reply_slot's "check + write in one statement" shape
-- (029_ai_reply.sql) so two inbound webhooks racing on the same
-- contact can't both kick off a full analysis.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_lead_analysis_slot(
  p_account_id       uuid,
  p_contact_id       uuid,
  p_cooldown_seconds integer
)
RETURNS boolean AS $$
  WITH ensured AS (
    INSERT INTO lead_intelligence (account_id, contact_id)
    VALUES (p_account_id, p_contact_id)
    ON CONFLICT (contact_id) DO NOTHING
  ),
  claimed AS (
    UPDATE lead_intelligence
    SET analyzing_since = now()
    WHERE contact_id = p_contact_id
      AND (
        analyzing_since IS NULL
        OR analyzing_since < now() - make_interval(secs => p_cooldown_seconds)
      )
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- Called from the webhook under the service-role client (no
-- auth.uid()) — same reasoning + grant shape as claim_ai_reply_slot.
GRANT EXECUTE ON FUNCTION public.claim_lead_analysis_slot(uuid, uuid, integer) TO service_role;
