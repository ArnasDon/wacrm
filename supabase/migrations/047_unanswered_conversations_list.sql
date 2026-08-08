-- ============================================================
-- 047_unanswered_conversations_list.sql — custom feature, not part
-- of the upstream wacrm template.
--
-- Dashboard card "Leads Não Respondidos" (migration 042) and its
-- Inbox drill-through ("Não respondidas" filter) must never disagree
-- about which conversations qualify. Previously the WHERE clause
-- lived only inside count_unanswered_conversations, with nothing for
-- the Inbox to call to get the *same* rows instead of a count.
--
-- list_unanswered_conversation_ids() extracts that rule into its own
-- SETOF function; count_unanswered_conversations() is redefined to
-- just COUNT(*) over it, so the two can no longer drift — there is
-- exactly one place the "unanswered" rule is written down.
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_unanswered_conversation_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.id
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

ALTER FUNCTION public.list_unanswered_conversation_ids() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_unanswered_conversation_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_unanswered_conversation_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.count_unanswered_conversations()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COUNT(*)::int FROM public.list_unanswered_conversation_ids();
$$;
