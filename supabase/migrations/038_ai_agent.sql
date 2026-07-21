-- ============================================================
-- 038_ai_agent.sql — WhatsApp AI agent + automation copilot
--
-- Adds the account-level BYOK AI config, an audit table for
-- AI-initiated pipeline stage moves, and restores the three
-- conversation columns + one message column dropped by
-- 037_drop_ai.sql (this time driven by the new agent, not the
-- removed auto-reply.ts module).
--
-- Idempotent — safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_configs (
  account_id                        uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  provider                          text NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  model                             text NOT NULL,
  api_key_encrypted                 text NOT NULL,
  agent_enabled                     boolean NOT NULL DEFAULT false,
  pipeline_move_enabled             boolean NOT NULL DEFAULT false,
  auto_reply_max_per_conversation   integer NOT NULL DEFAULT 3,
  handoff_agent_id                  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_configs_select ON ai_configs;
CREATE POLICY ai_configs_select ON ai_configs FOR SELECT
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS ai_configs_write ON ai_configs;
CREATE POLICY ai_configs_write ON ai_configs FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_configs_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_configs_updated_at ON ai_configs;
CREATE TRIGGER trg_ai_configs_updated_at
  BEFORE UPDATE ON ai_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_ai_configs_updated_at();

CREATE TABLE IF NOT EXISTS ai_pipeline_moves (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id           uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  conversation_id   uuid REFERENCES conversations(id) ON DELETE SET NULL,
  from_stage_id     uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id       uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_pipeline_moves_account ON ai_pipeline_moves(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_pipeline_moves_deal ON ai_pipeline_moves(deal_id);

ALTER TABLE ai_pipeline_moves ENABLE ROW LEVEL SECURITY;

-- Admin+ read (audit/ops-adjacent). Writes come from the service-role
-- client (webhook path), which bypasses RLS, so there is no INSERT
-- policy for `authenticated`.
DROP POLICY IF EXISTS ai_pipeline_moves_select ON ai_pipeline_moves;
CREATE POLICY ai_pipeline_moves_select ON ai_pipeline_moves FOR SELECT
  USING (is_account_member(account_id, 'admin'));

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_autoreply_disabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_reply_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_handoff_summary text;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS ai_generated boolean NOT NULL DEFAULT false;
