-- Weekly per-company health numbers for the /admin "Salud semanal" tab and
-- the Monday email (src/lib/admin/weekly-health.ts). Aggregated in SQL so
-- the PostgREST 1000-row cap never truncates a count. Platform-wide read:
-- service_role only.
CREATE OR REPLACE FUNCTION public.platform_weekly_health(p_end timestamptz DEFAULT now())
RETURNS TABLE (
  account_id uuid,
  name text,
  industry_vertical text,
  suspended boolean,
  inbound bigint,
  inbound_prev bigint,
  conversations bigint,
  ai_replies bigint,
  staff_replies bigint,
  first_response_median_min numeric,
  waiting_over_2h bigint,
  handoffs bigint,
  handoffs_unattended bigint,
  ai_records bigint,
  followups_sent bigint,
  followups_failed bigint,
  ai_tokens bigint,
  alerts_critical bigint,
  alerts_other bigint
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH p AS (
    SELECT p_end AS t_end, p_end - interval '7 days' AS t_start, p_end - interval '14 days' AS p_start
  ),
  m AS (
    SELECT c.account_id, m.conversation_id, m.sender_type, m.ai_generated, m.created_at
    FROM messages m JOIN conversations c ON c.id = m.conversation_id, p
    WHERE m.created_at >= p.p_start AND m.created_at < p.t_end
  ),
  fi AS (
    SELECT m.account_id, m.conversation_id, min(m.created_at) AS first_in
    FROM m, p WHERE m.sender_type = 'customer' AND m.created_at >= p.t_start
    GROUP BY 1, 2
  ),
  fr AS (
    SELECT fi.account_id,
      extract(epoch FROM (
        SELECT min(r.created_at) FROM messages r
        WHERE r.conversation_id = fi.conversation_id
          AND r.sender_type <> 'customer' AND r.created_at > fi.first_in
      ) - fi.first_in) / 60 AS mins
    FROM fi
  )
  SELECT a.id, a.name, a.industry_vertical, a.suspended_at IS NOT NULL,
    (SELECT count(*) FROM m, p WHERE m.account_id = a.id AND m.sender_type = 'customer' AND m.created_at >= p.t_start),
    (SELECT count(*) FROM m, p WHERE m.account_id = a.id AND m.sender_type = 'customer' AND m.created_at < p.t_start),
    (SELECT count(*) FROM fi WHERE fi.account_id = a.id),
    (SELECT count(*) FROM m, p WHERE m.account_id = a.id AND m.ai_generated AND m.created_at >= p.t_start),
    (SELECT count(*) FROM m, p WHERE m.account_id = a.id AND m.sender_type = 'agent' AND m.created_at >= p.t_start),
    (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY fr.mins)::numeric, 1) FROM fr WHERE fr.account_id = a.id),
    -- Open threads whose last message (this week) is the customer's, unanswered for 2 h+.
    (SELECT count(*) FROM conversations c, p,
       LATERAL (SELECT x.sender_type, x.created_at FROM messages x
                WHERE x.conversation_id = c.id ORDER BY x.created_at DESC LIMIT 1) l
     WHERE c.account_id = a.id AND c.status <> 'closed' AND l.sender_type = 'customer'
       AND l.created_at >= p.t_start AND l.created_at < p.t_end - interval '2 hours'),
    (SELECT count(*) FROM conversations c, p WHERE c.account_id = a.id AND c.ai_handoff_at >= p.t_start AND c.ai_handoff_at < p.t_end),
    -- Handed to the team 24 h+ ago and no teammate has written since.
    (SELECT count(*) FROM conversations c, p
     WHERE c.account_id = a.id AND c.status <> 'closed'
       AND c.ai_handoff_at >= p.t_start AND c.ai_handoff_at < p.t_end - interval '24 hours'
       AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.conversation_id = c.id
                       AND x.sender_type = 'agent' AND x.created_at > c.ai_handoff_at)),
    (SELECT count(*) FROM ai_action_log l, p WHERE l.account_id = a.id
       AND l.created_at >= p.t_start AND l.created_at < p.t_end
       AND l.action IN ('record_reservation', 'create_deal', 'schedule_appointment', 'create_quote')),
    (SELECT count(*) FROM ai_followup_log f, p WHERE f.account_id = a.id AND f.sent_at >= p.t_start AND f.sent_at < p.t_end AND f.error IS NULL),
    (SELECT count(*) FROM ai_followup_log f, p WHERE f.account_id = a.id AND f.sent_at >= p.t_start AND f.sent_at < p.t_end AND f.error IS NOT NULL),
    (SELECT coalesce(sum(u.total_tokens), 0)::bigint FROM ai_usage_log u, p WHERE u.account_id = a.id AND u.created_at >= p.t_start AND u.created_at < p.t_end),
    (SELECT count(*) FROM system_alerts s WHERE s.account_id = a.id AND s.resolved_at IS NULL AND s.severity = 'critical'),
    (SELECT count(*) FROM system_alerts s WHERE s.account_id = a.id AND s.resolved_at IS NULL AND s.severity <> 'critical')
  FROM accounts a
$$;

REVOKE ALL ON FUNCTION public.platform_weekly_health(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_weekly_health(timestamptz) TO service_role;
