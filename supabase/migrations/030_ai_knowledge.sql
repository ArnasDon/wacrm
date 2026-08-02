-- ============================================================
-- 030_ai_knowledge.sql — AI knowledge base (RAG grounding)
--
-- Gives the AI assistant (migration 029) an account-owned knowledge
-- base — FAQ / policy / product text — that it retrieves into every
-- draft and auto-reply, so it can answer business-specific questions
-- instead of handing off.
--
-- Hybrid retrieval:
--   - Lexical: a generated `fts` tsvector on each chunk, ranked with
--     ts_rank. Works for every account with no extra credentials.
--   - Semantic: an optional pgvector `embedding` per chunk (OpenAI
--     text-embedding-3-small, 1536 dims), populated only when the
--     account configures an embeddings key. Anthropic-only accounts
--     (Anthropic has no embeddings API) keep the lexical path with
--     zero extra setup.
--
-- pgvector: `CREATE EXTENSION IF NOT EXISTS vector` works on a stock
-- Postgres. On hosted Supabase the extension usually lives in the
-- `extensions` schema — if your project pins that, run
-- `create extension if not exists vector with schema extensions;`
-- once, then this file is a no-op for the extension.
--
-- RLS: settings-class, mirroring `ai_configs` / `whatsapp_config` —
-- any member may read the knowledge base; only admin+ may change it.
-- The retrieval RPCs and the ingest path run under the service-role
-- client (the auto-reply bot has no auth.uid()), so RLS guards
-- dashboard reads.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- Optional embeddings key (OpenAI-compatible). When set, the KB is
-- embedded and semantic search turns on. Stored AES-256-GCM-encrypted,
-- same as ai_configs.api_key.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS embeddings_api_key text;

-- ============================================================
-- Documents — one row per KB entry the user pastes (title + body).
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title       text NOT NULL,
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_knowledge_documents_account_id_idx
  ON ai_knowledge_documents (account_id);

ALTER TABLE ai_knowledge_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_knowledge_documents_select ON ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_select ON ai_knowledge_documents FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_knowledge_documents_insert ON ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_insert ON ai_knowledge_documents FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_knowledge_documents_update ON ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_update ON ai_knowledge_documents FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_knowledge_documents_delete ON ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_delete ON ai_knowledge_documents FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_knowledge_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_knowledge_documents_updated_at ON ai_knowledge_documents;
CREATE TRIGGER ai_knowledge_documents_updated_at
  BEFORE UPDATE ON ai_knowledge_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_knowledge_documents_updated_at();

-- ============================================================
-- Chunks — retrieval units. `account_id` is denormalized off the
-- document so the match RPCs and RLS filter without a join.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  chunk_index  integer NOT NULL DEFAULT 0,
  content      text NOT NULL,
  -- Language-neutral FTS config: wacrm is used in many languages
  -- (its markets include BR / LATAM / IN), and this lexical path is the
  -- fallback for accounts without an embeddings key. `'simple'` tokenizes
  -- + lowercases without English-only stemming/stopwords, so it degrades
  -- gracefully in any language. (Per-account language config is a
  -- follow-up; accounts wanting paraphrase/morphology matching add an
  -- embeddings key for the semantic path.)
  fts          tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  embedding    vector(1536),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_account_id_idx
  ON ai_knowledge_chunks (account_id);
CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_document_id_idx
  ON ai_knowledge_chunks (document_id);
CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_fts_idx
  ON ai_knowledge_chunks USING gin (fts);
-- Cosine-distance ANN index for the semantic path. Rows with a NULL
-- embedding (lexical-only accounts) are simply absent from it.
--
-- HNSW (not IVFFlat): per-account knowledge bases start empty and grow
-- incrementally, and IVFFlat must be trained on existing rows — built
-- against an empty/tiny table its centroids are meaningless and recall
-- is poor until it's large and REINDEXed. HNSW needs no training and is
-- accurate from the first row.
CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_embedding_idx
  ON ai_knowledge_chunks USING hnsw (embedding vector_cosine_ops);

ALTER TABLE ai_knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_knowledge_chunks_select ON ai_knowledge_chunks;
CREATE POLICY ai_knowledge_chunks_select ON ai_knowledge_chunks FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_knowledge_chunks_insert ON ai_knowledge_chunks;
CREATE POLICY ai_knowledge_chunks_insert ON ai_knowledge_chunks FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_knowledge_chunks_update ON ai_knowledge_chunks;
CREATE POLICY ai_knowledge_chunks_update ON ai_knowledge_chunks FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_knowledge_chunks_delete ON ai_knowledge_chunks;
CREATE POLICY ai_knowledge_chunks_delete ON ai_knowledge_chunks FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- Retrieval RPCs. Both SECURITY DEFINER and hard-scoped to the passed
-- account_id so the service-role caller can only ever read one
-- account's chunks.
-- ============================================================

-- Lexical: full-text rank. `plainto_tsquery` turns a raw customer
-- message into a query safely (no operator injection). Uses the same
-- language-neutral `'simple'` config as the stored `fts` column.
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, rank real) AS $$
  SELECT c.id,
         c.content,
         ts_rank(c.fts, plainto_tsquery('simple', p_query)) AS rank
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.fts @@ plainto_tsquery('simple', p_query)
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Semantic: cosine distance against the query embedding. Only rows
-- that actually have an embedding participate.
--
-- `p_query_embedding` is declared `text` (not `vector`) and cast inside:
-- the caller sends the canonical pgvector literal `[0.1,0.2,...]` as a
-- plain string, so there's no ambiguity in how PostgREST binds a JSON
-- value to a `vector` parameter. Casting a literal to a constant vector
-- still lets the HNSW index serve the `<=>` order-by.
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_semantic(
  p_account_id      uuid,
  p_query_embedding text,
  p_match_count     integer
)
RETURNS TABLE (id uuid, content text, distance real) AS $$
  SELECT c.id,
         c.content,
         (c.embedding <=> p_query_embedding::vector(1536)) AS distance
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Lock down EXECUTE (mirrors migrations 018 / 025). These are
-- SECURITY DEFINER and would otherwise default to PUBLIC — i.e. the
-- anon role — which, since the function bypasses RLS and only gates on
-- the passed account_id, would let an unauthenticated caller read any
-- account's knowledge base. The draft path calls them as `authenticated`
-- and the auto-reply bot as `service_role`.
REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) TO authenticated, service_role;
