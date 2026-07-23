-- ============================================================
-- 041_ai_knowledge_rag.sql - RAG grounding, AI run logs, and
-- account-scoped agent definitions.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS knowledge_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS embeddings_model text NOT NULL DEFAULT 'text-embedding-3-small',
  ADD COLUMN IF NOT EXISTS embeddings_api_key_encrypted text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_id_id
  ON conversations(account_id, id);

CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  content text NOT NULL,
  source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'url', 'file', 'api')),
  source_uri text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, id)
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_documents_account
  ON ai_knowledge_documents(account_id, updated_at DESC);

ALTER TABLE ai_knowledge_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_knowledge_documents_select ON ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_select ON ai_knowledge_documents FOR SELECT
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS ai_knowledge_documents_insert ON ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_insert ON ai_knowledge_documents FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_knowledge_documents_update ON ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_update ON ai_knowledge_documents FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_knowledge_documents_delete ON ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_delete ON ai_knowledge_documents FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_knowledge_documents_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_knowledge_documents_updated_at ON ai_knowledge_documents;
CREATE TRIGGER trg_ai_knowledge_documents_updated_at
  BEFORE UPDATE ON ai_knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_ai_knowledge_documents_updated_at();

CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  token_estimate integer NOT NULL DEFAULT 0,
  fts tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  embedding vector(1536),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, id),
  UNIQUE(document_id, chunk_index),
  FOREIGN KEY (account_id, document_id)
    REFERENCES ai_knowledge_documents(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_account
  ON ai_knowledge_chunks(account_id, document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_fts
  ON ai_knowledge_chunks USING gin(fts);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_embedding
  ON ai_knowledge_chunks USING hnsw (embedding vector_cosine_ops);

ALTER TABLE ai_knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_knowledge_chunks_select ON ai_knowledge_chunks;
CREATE POLICY ai_knowledge_chunks_select ON ai_knowledge_chunks FOR SELECT
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS ai_knowledge_chunks_write ON ai_knowledge_chunks;
CREATE POLICY ai_knowledge_chunks_write ON ai_knowledge_chunks FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS ai_knowledge_ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  document_id uuid REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  FOREIGN KEY (account_id, document_id)
    REFERENCES ai_knowledge_documents(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_ingestion_jobs_account_status
  ON ai_knowledge_ingestion_jobs(account_id, status, created_at DESC);

ALTER TABLE ai_knowledge_ingestion_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_knowledge_ingestion_jobs_select ON ai_knowledge_ingestion_jobs;
CREATE POLICY ai_knowledge_ingestion_jobs_select ON ai_knowledge_ingestion_jobs FOR SELECT
  USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  surface text NOT NULL CHECK (surface IN ('whatsapp_agent', 'automation_copilot', 'knowledge_ingest', 'manual_test')),
  agent_role text NOT NULL DEFAULT 'coordinator',
  provider text,
  model text,
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'completed', 'failed', 'skipped')),
  input_tokens integer,
  output_tokens integer,
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(account_id, id),
  FOREIGN KEY (account_id, conversation_id)
    REFERENCES conversations(account_id, id)
    ON DELETE SET NULL (conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_runs_account_created
  ON ai_runs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_runs_conversation
  ON ai_runs(conversation_id, created_at DESC);

ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_runs_select ON ai_runs;
CREATE POLICY ai_runs_select ON ai_runs FOR SELECT
  USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS ai_retrieval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ai_run_id uuid REFERENCES ai_runs(id) ON DELETE CASCADE,
  query text NOT NULL,
  retrieval_mode text NOT NULL CHECK (retrieval_mode IN ('fts', 'semantic', 'hybrid')),
  chunk_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, ai_run_id)
    REFERENCES ai_runs(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_retrieval_events_run
  ON ai_retrieval_events(ai_run_id);

ALTER TABLE ai_retrieval_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_retrieval_events_select ON ai_retrieval_events;
CREATE POLICY ai_retrieval_events_select ON ai_retrieval_events FOR SELECT
  USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ai_run_id uuid REFERENCES ai_runs(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('proposed', 'executed', 'rejected', 'skipped', 'failed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, ai_run_id)
    REFERENCES ai_runs(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_run
  ON ai_tool_calls(ai_run_id);

ALTER TABLE ai_tool_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_tool_calls_select ON ai_tool_calls;
CREATE POLICY ai_tool_calls_select ON ai_tool_calls FOR SELECT
  USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS ai_agent_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role text NOT NULL,
  name text NOT NULL,
  instructions text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  allowed_actions text[] NOT NULL DEFAULT '{}'::text[],
  knowledge_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, role)
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_definitions_account
  ON ai_agent_definitions(account_id, role);

ALTER TABLE ai_agent_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_agent_definitions_select ON ai_agent_definitions;
CREATE POLICY ai_agent_definitions_select ON ai_agent_definitions FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_agent_definitions_write ON ai_agent_definitions;
CREATE POLICY ai_agent_definitions_write ON ai_agent_definitions FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id uuid,
  p_query text,
  p_match_count integer
)
RETURNS TABLE (id uuid, document_id uuid, content text, rank real) AS $$
  SELECT c.id,
         c.document_id,
         c.content,
         ts_rank(c.fts, plainto_tsquery('simple', p_query)) AS rank
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND (auth.role() = 'service_role' OR is_account_member(p_account_id, 'agent'))
    AND c.fts @@ plainto_tsquery('simple', p_query)
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_semantic(
  p_account_id uuid,
  p_query_embedding text,
  p_match_count integer
)
RETURNS TABLE (id uuid, document_id uuid, content text, distance real) AS $$
  SELECT c.id,
         c.document_id,
         c.content,
         (c.embedding <=> p_query_embedding::vector(1536)) AS distance
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND (auth.role() = 'service_role' OR is_account_member(p_account_id, 'agent'))
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) TO authenticated, service_role;
