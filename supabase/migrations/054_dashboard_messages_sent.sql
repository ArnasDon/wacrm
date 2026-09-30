-- ============================================================
-- 054: "Messages sent" for the dashboard
--
-- Counts every outbound WhatsApp message in a time window:
--   * inbox messages sent by agents, automations, flows and AI
--     (messages.sender_type 'agent' | 'bot'), and
--   * campaign sends (broadcast_recipients with a sent_at).
--
-- A campaign message can also be copied into the customer's inbox thread
-- (lib/campaigns/inbox-messages.ts), so the two sets are merged on the
-- WhatsApp message id — each message counts once. Failed sends aren't
-- counted.
--
-- SECURITY INVOKER: row-level security scopes it to the caller's account,
-- exactly like the dashboard's other queries.
-- ============================================================

CREATE OR REPLACE FUNCTION public.dashboard_messages_sent(
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT count(*) FROM (
    SELECT COALESCE(m.message_id, m.id::text) AS k
    FROM messages m
    WHERE m.sender_type IN ('agent', 'bot')
      AND m.status <> 'failed'
      AND m.created_at >= p_from
      AND (p_to IS NULL OR m.created_at < p_to)
    UNION
    SELECT COALESCE(r.whatsapp_message_id, r.id::text)
    FROM broadcast_recipients r
    WHERE r.status IN ('sent', 'delivered', 'read', 'replied')
      AND r.sent_at >= p_from
      AND (p_to IS NULL OR r.sent_at < p_to)
  ) s;
$$;

REVOKE ALL ON FUNCTION public.dashboard_messages_sent(TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_messages_sent(TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated, service_role;
