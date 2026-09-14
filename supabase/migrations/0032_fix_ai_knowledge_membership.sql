-- ============================================================
-- 032_fix_ai_knowledge_membership.sql — stop cross-account KB
--                                        reads (GHSA-fg5p-2qc3-jmxr, H2)
--
-- The problem
--
--   `match_ai_knowledge_fts` and `match_ai_knowledge_semantic`
--   (migration 030) are SECURITY DEFINER, so they bypass RLS. They
--   filter only on the caller-supplied `p_account_id` and never
--   call `is_account_member()`, yet they are GRANTed to
--   `authenticated`. The 030 header assumed only the service-role
--   bot would call them, but any logged-in user can hit PostgREST
--   directly with a foreign `p_account_id` and read another
--   tenant's knowledge base:
--
--     POST /rest/v1/rpc/match_ai_knowledge_fts
--       { "p_account_id": "<victim>", "p_query": "price",
--         "p_match_count": 1000 }
--
-- The fix
--
--   Recreate both functions as SECURITY INVOKER — the only change
--   is the security mode; the bodies are byte-for-byte the same.
--   The existing SELECT policy
--     ai_knowledge_chunks_select = is_account_member(account_id)
--   then governs `authenticated` callers, so a foreign
--   `p_account_id` returns zero rows, while the auto-reply bot
--   (service_role) still bypasses RLS and works unchanged. This
--   mirrors the deliberate SECURITY INVOKER choice in
--   `filter_contacts_by_tags` (migration 025).
--
--   The legitimate draft path already passes the caller's *own*
--   accountId (see src/lib/ai/knowledge.ts → retrieveKnowledge),
--   so it keeps returning that account's chunks under RLS.
--
-- NOTE FOR MAINTAINER
--
--   This migration was not run against a live database. Validate
--   the two checks at the bottom in your own environment. If you
--   would rather keep these SECURITY DEFINER, the alternative is to
--   add `AND (auth.role() = 'service_role' OR
--   is_account_member(p_account_id))` to each WHERE clause instead.
-- ============================================================

-- Lexical: full-text rank. Body unchanged from migration 030 —
-- only SECURITY DEFINER → SECURITY INVOKER differs.
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
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

-- Semantic: cosine distance. Body unchanged from migration 030 —
-- only SECURITY DEFINER → SECURITY INVOKER differs.
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
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

-- Re-assert the EXECUTE grants (CREATE OR REPLACE preserves them,
-- but keep them explicit and re-runnable — mirrors migration 030).
REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) TO authenticated, service_role;

-- ============================================================
-- Manual validation (run against a live instance — no automated
-- SQL test harness exists in this repo):
--
--   1. As a non-member JWT, calling either RPC with a foreign
--      p_account_id must return zero rows:
--        POST /rest/v1/rpc/match_ai_knowledge_fts
--          { "p_account_id": "<other-account>", "p_query": "price",
--            "p_match_count": 1000 }              -> []
--   2. The draft flow (own accountId, authenticated) and the
--      auto-reply bot (service_role) must still return the
--      account's own chunks.
-- ============================================================
