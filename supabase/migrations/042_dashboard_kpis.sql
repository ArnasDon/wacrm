-- ============================================================
-- 042_dashboard_kpis.sql — custom feature, not part of the upstream
-- wacrm template.
--
-- Backs the "Leads Não Respondidos" dashboard card. A conversation is
-- unanswered when its most recent message came from the customer and
-- no agent/bot message followed it — i.e. whoever spoke last was the
-- customer. Closed conversations are excluded: a closed thread isn't
-- something the team is "waiting to attend".
--
-- Implemented as a real RPC (not pulled client-side and reduced, the
-- way the rest of src/lib/dashboard/queries.ts does its aggregation)
-- because "last message per conversation" has to scan every
-- conversation regardless of how old its last message is — unlike
-- the response-time chart, there's no natural recent-days window to
-- bound the client-side pull without silently missing a lead who
-- messaged weeks ago and was never answered.
-- ============================================================

CREATE OR REPLACE FUNCTION public.count_unanswered_conversations()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM conversations c
  CROSS JOIN LATERAL (
    SELECT m.sender_type
    FROM messages m
    WHERE m.conversation_id = c.id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) last_msg
  WHERE c.status <> 'closed'
    AND last_msg.sender_type = 'customer';
$$;

ALTER FUNCTION public.count_unanswered_conversations() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.count_unanswered_conversations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_unanswered_conversations() TO authenticated;
