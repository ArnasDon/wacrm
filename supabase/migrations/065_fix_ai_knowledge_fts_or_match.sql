-- ============================================================
-- 065_fix_ai_knowledge_fts_or_match.sql — stop the lexical KB search
--                                          from requiring every query
--                                          word to match (AND-only)
--
-- The problem
--
--   `match_ai_knowledge_fts` (030, carried unchanged into 032) ranks
--   with `plainto_tsquery('simple', p_query)`. `plainto_tsquery` joins
--   every word of the input with `&` (AND), so `c.fts @@
--   plainto_tsquery(...)` only matches a chunk that contains ALL of
--   the customer's words. A real customer message is a full sentence
--   ("vocês entregam pra minha região?"), and no knowledge-base chunk
--   is going to contain every one of those words verbatim — so the
--   lexical path returns zero rows almost always, and the assistant
--   reports it doesn't know, even when the answer is in the KB.
--
--   This is invisible whenever an embeddings key is configured
--   (semantic search runs first and usually fills the result set
--   before lexical is even consulted), which is exactly why it went
--   unnoticed — but it's the *only* retrieval path for Anthropic-only
--   accounts, since Anthropic has no embeddings API.
--
-- The fix
--
--   Build an OR query instead: tokenize the input the same way the
--   stored `fts` column was built (`to_tsvector('simple', ...)`), then
--   join the resulting lexemes with `|` before handing them to
--   `to_tsquery`. A chunk now matches if it contains ANY query word,
--   and `ts_rank` still orders chunks that share more words higher —
--   so this both restores recall and keeps relevance ranking.
--
--   Guards against `p_query` tokenizing to zero lexemes (whitespace/
--   punctuation-only input) by short-circuiting to no rows, instead of
--   calling `to_tsquery` on an empty string.
--
-- Only `match_ai_knowledge_fts` changes here. `match_ai_knowledge_semantic`
-- (cosine distance) isn't affected by this bug — it's untouched.
-- ============================================================

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, rank real) AS $$
  WITH terms AS (
    SELECT array_agg(DISTINCT lexeme) AS words
    FROM unnest(tsvector_to_array(to_tsvector('simple', p_query))) AS lexeme
  ),
  query AS (
    SELECT CASE
             WHEN words IS NULL OR array_length(words, 1) IS NULL THEN NULL
             ELSE to_tsquery('simple', array_to_string(words, ' | '))
           END AS tsq
    FROM terms
  )
  SELECT c.id,
         c.content,
         ts_rank(c.fts, query.tsq) AS rank
  FROM ai_knowledge_chunks c, query
  WHERE c.account_id = p_account_id
    AND query.tsq IS NOT NULL
    AND c.fts @@ query.tsq
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

-- Re-assert the EXECUTE grant (CREATE OR REPLACE preserves it, but
-- keep it explicit and re-runnable — mirrors migrations 030 / 032).
REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO authenticated, service_role;
