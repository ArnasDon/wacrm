-- ============================================================
-- 054_conversation_last_agent_sender.sql — custom feature, not part
-- of the upstream wacrm template.
--
-- Inbox "who last answered this lead" indicator (colored bar) and
-- the same indicator on Pipeline deal cards both need, for a whole
-- list of conversations at once, which internal user (agent) sent
-- the most recent message on each one. Doing that per-row from the
-- app would be an N+1 query pattern against `messages`. Mirrors
-- list_unanswered_conversation_ids (migration 047): one SQL function,
-- one round trip, both surfaces read from the exact same rule so
-- they can never disagree.
--
-- Only messages with sender_type = 'agent' AND a non-null sender_id
-- count — messages from the customer never change who "last
-- answered", and older agent messages sent before sender_id started
-- being recorded on send are correctly treated as unattributed
-- (excluded here, resolved to the "no internal response" gray state
-- by the frontend) rather than guessed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_conversation_last_agent_senders()
RETURNS TABLE (conversation_id uuid, sender_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.id AS conversation_id, last_agent.sender_id
  FROM conversations c
  CROSS JOIN LATERAL (
    SELECT m.sender_id
    FROM messages m
    WHERE m.conversation_id = c.id
      AND m.sender_type = 'agent'
      AND m.sender_id IS NOT NULL
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) last_agent;
$$;

ALTER FUNCTION public.list_conversation_last_agent_senders() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_conversation_last_agent_senders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_conversation_last_agent_senders() TO authenticated;
