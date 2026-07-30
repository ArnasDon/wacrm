-- ============================================================
-- 038_ai_knowledge_fts_or_match — lexical KB search never matched
--                                  real customer questions
--
-- The problem
--
--   `match_ai_knowledge_fts` (migration 030) ranks with
--   `plainto_tsquery('simple', p_query)`. `plainto_tsquery` ANDs every
--   lexeme in the input together, so a match requires ALL of them to
--   appear in the same chunk. A real customer question is a full
--   sentence full of filler words ("como", "al", "el", "tell", "me",
--   "about", ...) that are very unlikely to all appear verbatim in a
--   short knowledge-base excerpt — so the lexical path silently
--   returned zero rows for nearly every real question, even when the
--   answer (e.g. "Salto El León" itself) was right there in the text:
--
--     select plainto_tsquery('simple', 'como llegar al salto el leon?');
--       -> 'como' & 'llegar' & 'al' & 'salto' & 'el' & 'leon'
--     select * from match_ai_knowledge_fts(<account>, 'como llegar al salto el leon?', 5);
--       -> 0 rows, even though the account's KB has a chunk
--          containing "...the majestic Salto El León waterfall..."
--
--   Verified directly against production: with an embeddings key
--   unset (lexical-only path), the auto-reply/draft/Playground path
--   never received any knowledge excerpts, so the model fell back to
--   generic (sometimes fabricated) answers instead of the account's
--   own documented facts.
--
-- The fix
--
--   Search engines rank on ANY-term matches, not require ALL terms.
--   Reuse `plainto_tsquery` purely for its tokenizing/normalization
--   (case folding, punctuation stripping — identical to before), then
--   rewrite its `&`-joined lexeme list as `|`-joined before matching,
--   so a chunk containing just "salto" and "leon" now ranks and
--   returns instead of requiring "como", "al", and "el" to also be
--   present verbatim. `ts_rank` still rewards chunks that match more
--   of the query, so closer matches keep sorting first.
--
--   SECURITY INVOKER (set by migration 032) is unchanged — only the
--   query-construction logic differs.
-- ============================================================

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, rank real) AS $$
  SELECT c.id,
         c.content,
         ts_rank(c.fts, q.query) AS rank
  FROM ai_knowledge_chunks c,
       LATERAL (
         SELECT to_tsquery('simple', string_agg(lexeme, ' | ')) AS query
         FROM unnest(
           string_to_array(plainto_tsquery('simple', p_query)::text, ' & ')
         ) AS lexeme
       ) q
  WHERE c.account_id = p_account_id
    AND q.query IS NOT NULL
    AND c.fts @@ q.query
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO authenticated, service_role;

-- ============================================================
-- Manual validation (run against a live instance):
--
--   select * from match_ai_knowledge_fts(<account with a "Salto El
--   León" doc>, 'como llegar al salto el leon?', 5);  -> now returns
--   the location/accessibility chunk instead of 0 rows.
-- ============================================================
