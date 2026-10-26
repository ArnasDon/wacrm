CREATE OR REPLACE FUNCTION public.claim_ai_reply_slot(
  conversation_id uuid,
  max_replies integer
)
RETURNS boolean AS $$
  WITH claimed AS (
    UPDATE conversations
    SET ai_reply_count = ai_reply_count + 1
    WHERE id = conversation_id
      AND ai_reply_count < max_replies
      AND NOT ai_autoreply_disabled
      AND assigned_agent_id IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.claim_ai_reply_slot(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(UUID, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, rank real) AS $$
  WITH any_term AS (
    SELECT string_agg(
             '''' || replace(replace(lexeme, '\', '\\'), '''', '''''') || '''',
             ' | '
           )::tsquery AS query
    FROM unnest(tsvector_to_array(to_tsvector('simple', coalesce(p_query, '')))) AS lexeme
  )
  SELECT c.id,
         c.content,
         ts_rank(c.fts, any_term.query) AS rank
  FROM ai_knowledge_chunks c
  CROSS JOIN any_term
  WHERE any_term.query IS NOT NULL
    AND c.account_id = p_account_id
    AND c.fts @@ any_term.query
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO authenticated, service_role;
