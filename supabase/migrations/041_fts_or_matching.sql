-- ============================================================
-- 040_fts_or_matching.sql — FTS OR-matching for product search
--
-- match_ai_knowledge_fts uses plainto_tsquery which ANDs all
-- terms: "tienes el a56 de 256gb" → 'tienes' & 'el' & 'a56' &
-- 'de' & '256gb'.  Natural-language words ("tienes", "el") don't
-- appear in inventory chunks, so @@ returns false for every chunk
-- and nothing is retrieved.
--
-- Fix: sanitise the query (strip non-alphanumeric / non-Spanish
-- chars, collapse whitespace), then join tokens with OR so ANY
-- matching keyword returns a result.  ts_rank still prioritises
-- chunks that match more terms, so the most relevant product
-- appears at the top.
-- ============================================================

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, rank real) AS $$
  SELECT c.id,
         c.content,
         ts_rank(c.fts, to_tsquery('simple', x.q)) AS rank
  FROM (SELECT regexp_replace(regexp_replace(regexp_replace(trim(p_query), '[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ\s\-]', '', 'g'), '\s+', ' ', 'g'), ' ', ' | ', 'g') AS q) x,
       ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND (x.q <> '' AND c.fts @@ to_tsquery('simple', x.q))
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO authenticated, service_role;
