-- ============================================================
-- 042_ai_tools — connected Google Sheets the AI agent can query
--
-- Real tool-calling (as opposed to the knowledge base's semantic
-- retrieval, migration 030/041): each row becomes one function the
-- model can decide to call mid-reply when it needs a structured
-- lookup (price, stock, order status) rather than a text excerpt.
-- Execution lives in src/lib/ai/tools/google-sheet.ts — no OAuth,
-- fetches the sheet's public CSV export.
--
-- Same RLS pattern as ai_knowledge_documents (migration 030): any
-- member may read (needed so the account's tools list can be loaded
-- for generation), only admin+ may create/edit/delete.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_tools (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Technical name exposed to the model as the function name — e.g.
  -- "consultar_precios". Unique per account so the model never sees
  -- two tools with the same name.
  name         text NOT NULL,
  -- Tells the model WHEN to use this tool and what it contains —
  -- critical wording when an account has more than one sheet connected.
  description  text NOT NULL,
  sheet_url    text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS ai_tools_account_id_idx ON ai_tools (account_id);

ALTER TABLE ai_tools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_tools_select ON ai_tools;
CREATE POLICY ai_tools_select ON ai_tools FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_tools_insert ON ai_tools;
CREATE POLICY ai_tools_insert ON ai_tools FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_tools_update ON ai_tools;
CREATE POLICY ai_tools_update ON ai_tools FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_tools_delete ON ai_tools;
CREATE POLICY ai_tools_delete ON ai_tools FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_tools_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_tools_updated_at ON ai_tools;
CREATE TRIGGER ai_tools_updated_at
  BEFORE UPDATE ON ai_tools
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_tools_updated_at();
