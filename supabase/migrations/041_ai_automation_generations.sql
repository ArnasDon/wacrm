-- ============================================================
-- 041_ai_automation_generations.sql
--
-- Operational telemetry for the natural-language automation
-- copilot. This table intentionally stores metadata only: prompts,
-- conversation history, draft text, and other user content are not
-- persisted.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_automation_generations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  automation_id         uuid REFERENCES automations(id) ON DELETE SET NULL,
  provider               text NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  model                  text NOT NULL,
  result                 text NOT NULL CHECK (result IN ('draft', 'question', 'failed')),
  failure_code           text,
  generation_count       integer NOT NULL DEFAULT 1 CHECK (generation_count >= 0),
  repair_count           integer NOT NULL DEFAULT 0 CHECK (repair_count >= 0),
  verification_count     integer NOT NULL DEFAULT 0 CHECK (verification_count >= 0),
  prompt_tokens          integer NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens      integer NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  duration_ms            integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  issue_count            integer NOT NULL DEFAULT 0 CHECK (issue_count >= 0),
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_automation_generations_account_created
  ON ai_automation_generations(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_automation_generations_automation
  ON ai_automation_generations(automation_id)
  WHERE automation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_automation_generations_user
  ON ai_automation_generations(user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE ai_automation_generations ENABLE ROW LEVEL SECURITY;

-- Generation writes and automation linkage updates use the service-role
-- backend client, which bypasses RLS. Authenticated clients receive no
-- INSERT/UPDATE/DELETE policy. Account administrators can read aggregate
-- and operational metadata for their own account.
DROP POLICY IF EXISTS ai_automation_generations_select ON ai_automation_generations;
CREATE POLICY ai_automation_generations_select
  ON ai_automation_generations
  FOR SELECT
  USING (is_account_member(account_id, 'admin'));
