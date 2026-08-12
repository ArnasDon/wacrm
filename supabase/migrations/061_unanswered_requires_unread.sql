-- ============================================================
-- 061_unanswered_requires_unread.sql — custom feature, not part
-- of the upstream wacrm template.
--
-- Root cause: "Leads Não Respondidos" (list_unanswered_conversation_ids,
-- migration 047 — count_unanswered_conversations delegates to it) only
-- looked at whether the last message came from the customer. Opening a
-- conversation resets `conversations.unread_count` to 0 (MessageThread's
-- own reset effect) but never touched this rule, so a lead the operator
-- had already viewed kept showing as "unanswered" until an agent reply
-- flipped the last-message sender — the two concepts were unrelated.
--
-- Fix: reuse unread_count (no new column) as the "already viewed" signal
-- — it's already exactly that: 0 whenever the operator has caught up
-- with a conversation, bumped back up whenever a new customer message
-- arrives (webhook) or via the manual "Marcar como não lida"/"Marcar
-- como lido" actions. Adding it to this one WHERE clause is enough:
-- count_unanswered_conversations() delegates here, so both the
-- dashboard KPI and the Inbox drill-through pick it up automatically.
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
    AND last_msg.sender_type = 'customer'
    AND c.unread_count > 0;
$$;
