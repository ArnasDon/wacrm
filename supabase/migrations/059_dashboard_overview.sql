ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS reply_target_minutes INTEGER NOT NULL DEFAULT 5;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_reply_target_minutes_range;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_reply_target_minutes_range
  CHECK (reply_target_minutes BETWEEN 1 AND 1440);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reply_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_conversations_account_created
  ON conversations(account_id, created_at);

CREATE INDEX IF NOT EXISTS idx_conversations_account_closed
  ON conversations(account_id, closed_at)
  WHERE closed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_account_awaiting
  ON conversations(account_id, last_inbound_at)
  WHERE status <> 'closed' AND last_inbound_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deals_account_closed
  ON deals(account_id, closed_at)
  WHERE closed_at IS NOT NULL;

ALTER TABLE conversations DISABLE TRIGGER set_updated_at;
ALTER TABLE deals DISABLE TRIGGER set_updated_at;

UPDATE conversations c
SET last_inbound_at = m.latest
FROM (
  SELECT conversation_id, max(created_at) AS latest
  FROM messages
  WHERE sender_type = 'customer'
  GROUP BY conversation_id
) m
WHERE m.conversation_id = c.id
  AND c.last_inbound_at IS NULL;

UPDATE conversations c
SET last_reply_at = m.latest
FROM (
  SELECT conversation_id, max(created_at) AS latest
  FROM messages
  WHERE (sender_type = 'agent' OR ai_generated)
    AND status <> 'failed'
  GROUP BY conversation_id
) m
WHERE m.conversation_id = c.id
  AND c.last_reply_at IS NULL;

UPDATE conversations
SET closed_at = updated_at
WHERE status = 'closed'
  AND closed_at IS NULL;

UPDATE deals
SET closed_at = updated_at
WHERE status IN ('won', 'lost')
  AND closed_at IS NULL;

ALTER TABLE conversations ENABLE TRIGGER set_updated_at;
ALTER TABLE deals ENABLE TRIGGER set_updated_at;

CREATE OR REPLACE FUNCTION public.track_conversation_message_times()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sender_type = 'customer' THEN
      UPDATE conversations
      SET last_inbound_at = GREATEST(COALESCE(last_inbound_at, NEW.created_at), NEW.created_at)
      WHERE id = NEW.conversation_id;
    ELSIF (NEW.sender_type = 'agent' OR NEW.ai_generated) AND NEW.status IS DISTINCT FROM 'failed' THEN
      UPDATE conversations
      SET last_reply_at = GREATEST(COALESCE(last_reply_at, NEW.created_at), NEW.created_at)
      WHERE id = NEW.conversation_id;
    END IF;
  ELSIF NEW.status = 'failed'
    AND OLD.status IS DISTINCT FROM 'failed'
    AND (NEW.sender_type = 'agent' OR NEW.ai_generated) THEN
    UPDATE conversations
    SET last_reply_at = (
      SELECT max(m.created_at)
      FROM messages m
      WHERE m.conversation_id = NEW.conversation_id
        AND (m.sender_type = 'agent' OR m.ai_generated)
        AND m.status <> 'failed'
    )
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.track_conversation_message_times() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.track_conversation_message_times() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS messages_track_conversation_times ON messages;
CREATE TRIGGER messages_track_conversation_times
  AFTER INSERT OR UPDATE OF status ON messages
  FOR EACH ROW EXECUTE FUNCTION public.track_conversation_message_times();

CREATE OR REPLACE FUNCTION public.stamp_conversation_closed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'closed' THEN
    NEW.closed_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  ELSIF OLD.status IS DISTINCT FROM 'closed' THEN
    NEW.closed_at := now();
  ELSE
    NEW.closed_at := COALESCE(OLD.closed_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_stamp_closed_at ON conversations;
CREATE TRIGGER conversations_stamp_closed_at
  BEFORE INSERT OR UPDATE OF status ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.stamp_conversation_closed_at();

CREATE OR REPLACE FUNCTION public.stamp_deal_closed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('won', 'lost') THEN
    NEW.closed_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.closed_at := now();
  ELSE
    NEW.closed_at := COALESCE(OLD.closed_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_stamp_closed_at ON deals;
CREATE TRIGGER deals_stamp_closed_at
  BEFORE INSERT OR UPDATE OF status ON deals
  FOR EACH ROW EXECUTE FUNCTION public.stamp_deal_closed_at();

CREATE OR REPLACE FUNCTION public.dashboard_overview(
  p_days INTEGER,
  p_tz TEXT DEFAULT 'UTC'
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_tz TEXT := 'UTC';
  v_now TIMESTAMPTZ := now();
  v_start TIMESTAMPTZ;
  v_prev_start TIMESTAMPTZ;
  v_prev_end TIMESTAMPTZ;
  v_unit TEXT;
  v_step INTERVAL;
  v_target INTEGER;
  v_attention JSONB;
  v_replies JSONB;
  v_volume JSONB;
  v_kpis JSONB;
  v_pipeline JSONB;
  v_campaigns JSONB;
  v_setup JSONB;
BEGIN
  SELECT p.account_id INTO v_account
  FROM profiles p
  WHERE p.user_id = auth.uid();

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'caller is not a member of an account' USING ERRCODE = '42501';
  END IF;

  IF p_days IS NULL OR p_days NOT IN (1, 7, 30, 90) THEN
    RAISE EXCEPTION 'p_days must be one of 1, 7, 30, 90' USING ERRCODE = '22023';
  END IF;

  IF p_tz IS NOT NULL THEN
    BEGIN
      PERFORM v_now AT TIME ZONE p_tz;
      v_tz := p_tz;
    EXCEPTION WHEN invalid_parameter_value THEN
      v_tz := 'UTC';
    END;
  END IF;

  v_start := (date_trunc('day', v_now AT TIME ZONE v_tz) - make_interval(days => p_days - 1)) AT TIME ZONE v_tz;
  v_prev_start := v_start - make_interval(days => p_days);
  v_prev_end := v_now - make_interval(days => p_days);
  v_unit := CASE WHEN p_days = 1 THEN 'hour' ELSE 'day' END;
  v_step := CASE WHEN p_days = 1 THEN interval '1 hour' ELSE interval '1 day' END;

  SELECT a.reply_target_minutes INTO v_target FROM accounts a WHERE a.id = v_account;
  v_target := COALESCE(v_target, 5);

  WITH awaiting AS (
    SELECT
      c.id,
      c.contact_id,
      c.assigned_agent_id,
      c.last_message_text,
      c.last_inbound_at,
      (c.ai_autoreply_disabled AND c.ai_handoff_summary IS NOT NULL) AS handed_off,
      COALESCE((
        SELECT min(m.created_at)
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sender_type = 'customer'
          AND m.created_at > COALESCE(c.last_reply_at, '-infinity'::timestamptz)
      ), c.last_inbound_at) AS waiting_since
    FROM conversations c
    WHERE c.account_id = v_account
      AND c.status <> 'closed'
      AND c.last_inbound_at IS NOT NULL
      AND (c.last_reply_at IS NULL OR c.last_reply_at < c.last_inbound_at)
  ),
  failed AS (
    SELECT m.id, m.conversation_id, m.content_text, m.error_code, m.error_title, m.created_at,
           ct.name AS contact_name, ct.phone AS contact_phone
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN contacts ct ON ct.id = c.contact_id
    WHERE c.account_id = v_account
      AND m.sender_type <> 'customer'
      AND m.status = 'failed'
      AND m.created_at >= v_now - interval '24 hours'
  )
  SELECT jsonb_build_object(
    'waiting', (SELECT count(*) FROM awaiting),
    'oldestWaitingSince', (SELECT min(waiting_since) FROM awaiting),
    'waitingOverTarget', (SELECT count(*) FROM awaiting WHERE waiting_since < v_now - make_interval(mins => v_target)),
    'unassigned', (
      SELECT count(*) FROM conversations c
      WHERE c.account_id = v_account AND c.status = 'open' AND c.assigned_agent_id IS NULL
    ),
    'windowsClosing', (
      SELECT count(*) FROM awaiting
      WHERE last_inbound_at > v_now - interval '24 hours'
        AND last_inbound_at <= v_now - interval '22 hours'
    ),
    'failed', (SELECT count(*) FROM failed),
    'failedMessages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id,
        'conversationId', f.conversation_id,
        'contactName', f.contact_name,
        'contactPhone', f.contact_phone,
        'preview', left(f.content_text, 120),
        'errorCode', f.error_code,
        'errorTitle', f.error_title,
        'at', f.created_at
      ) ORDER BY f.created_at DESC)
      FROM (SELECT * FROM failed ORDER BY created_at DESC LIMIT 10) f
    ), '[]'::jsonb),
    'queue', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'conversationId', q.id,
        'contactName', ct.name,
        'contactPhone', ct.phone,
        'avatarUrl', ct.avatar_url,
        'preview', left(q.last_message_text, 120),
        'waitingSince', q.waiting_since,
        'windowClosesAt', q.last_inbound_at + interval '24 hours',
        'assignedAgentId', q.assigned_agent_id,
        'handedOff', COALESCE(q.handed_off, false)
      ) ORDER BY q.waiting_since)
      FROM (SELECT * FROM awaiting ORDER BY waiting_since LIMIT 6) q
      LEFT JOIN contacts ct ON ct.id = q.contact_id
    ), '[]'::jsonb)
  ) INTO v_attention;

  WITH msgs AS (
    SELECT m.id, m.conversation_id, m.sender_type, m.ai_generated, m.status, m.created_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = v_account
      AND m.created_at >= v_prev_start - interval '1 day'
  ),
  streams AS (
    SELECT
      'human'::text AS kind,
      conversation_id,
      created_at,
      sender_type = 'customer' AS is_customer,
      lag(sender_type = 'customer') OVER (PARTITION BY conversation_id ORDER BY created_at, id) AS prev_customer
    FROM msgs
    WHERE sender_type = 'customer' OR (sender_type = 'agent' AND status <> 'failed')
    UNION ALL
    SELECT
      'ai'::text,
      conversation_id,
      created_at,
      sender_type = 'customer',
      lag(sender_type = 'customer') OVER (PARTITION BY conversation_id ORDER BY created_at, id)
    FROM msgs
    WHERE sender_type = 'customer' OR (ai_generated AND status <> 'failed')
  ),
  turns AS (
    SELECT
      s.kind,
      s.created_at AS asked_at,
      r.sender_id AS reply_agent,
      extract(epoch FROM r.created_at - s.created_at) / 60.0 AS minutes
    FROM streams s
    CROSS JOIN LATERAL (
      SELECT m2.sender_id, m2.created_at
      FROM messages m2
      WHERE m2.conversation_id = s.conversation_id
        AND m2.created_at > s.created_at
        AND m2.status <> 'failed'
        AND CASE WHEN s.kind = 'human' THEN m2.sender_type = 'agent' ELSE m2.ai_generated END
      ORDER BY m2.created_at, m2.id
      LIMIT 1
    ) r
    WHERE s.is_customer
      AND s.prev_customer IS NOT TRUE
      AND s.created_at >= v_prev_start
  ),
  members AS (
    SELECT p.user_id, p.full_name, p.avatar_url, p.account_role
    FROM profiles p
    WHERE p.account_id = v_account
  )
  SELECT jsonb_build_object(
    'medianHuman', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
      FROM turns WHERE kind = 'human' AND asked_at >= v_start
    ),
    'medianHumanPrevious', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
      FROM turns WHERE kind = 'human' AND asked_at >= v_prev_start AND asked_at < v_prev_end
    ),
    'team', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'userId', mb.user_id,
        'name', mb.full_name,
        'avatarUrl', mb.avatar_url,
        'role', mb.account_role,
        'presence', mp.status,
        'lastSeenAt', mp.last_seen_at,
        'open', (
          SELECT count(*) FROM conversations c
          WHERE c.account_id = v_account AND c.status <> 'closed' AND c.assigned_agent_id = mb.user_id
        ),
        'replies', (
          SELECT count(*) FROM turns
          WHERE kind = 'human' AND reply_agent = mb.user_id AND asked_at >= v_start
        ),
        'medianMinutes', (
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
          FROM turns
          WHERE kind = 'human' AND reply_agent = mb.user_id AND asked_at >= v_start
        )
      ) ORDER BY mb.full_name NULLS LAST)
      FROM members mb
      LEFT JOIN member_presence mp ON mp.user_id = mb.user_id AND mp.account_id = v_account
    ), '[]'::jsonb),
    'ai', jsonb_build_object(
      'replies', (
        SELECT count(*)
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.account_id = v_account AND m.ai_generated AND m.created_at >= v_start
      ),
      'medianMinutes', (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
        FROM turns WHERE kind = 'ai' AND asked_at >= v_start
      )
    )
  ) INTO v_replies;

  WITH buckets AS (
    SELECT b
    FROM generate_series(
      date_trunc(v_unit, v_start AT TIME ZONE v_tz),
      date_trunc(v_unit, v_now AT TIME ZONE v_tz),
      v_step
    ) AS b
  ),
  period_msgs AS (
    SELECT m.sender_type, m.created_at AT TIME ZONE v_tz AS local_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = v_account
      AND m.created_at >= v_start
  ),
  msg_counts AS (
    SELECT date_trunc(v_unit, local_at) AS b,
           count(*) FILTER (WHERE sender_type = 'customer') AS incoming,
           count(*) FILTER (WHERE sender_type <> 'customer') AS outgoing
    FROM period_msgs
    GROUP BY 1
  ),
  conv_counts AS (
    SELECT date_trunc(v_unit, created_at AT TIME ZONE v_tz) AS b, count(*) AS n
    FROM conversations
    WHERE account_id = v_account AND created_at >= v_start
    GROUP BY 1
  ),
  resolved_counts AS (
    SELECT date_trunc(v_unit, closed_at AT TIME ZONE v_tz) AS b, count(*) AS n
    FROM conversations
    WHERE account_id = v_account AND status = 'closed' AND closed_at >= v_start
    GROUP BY 1
  ),
  won_counts AS (
    SELECT date_trunc(v_unit, closed_at AT TIME ZONE v_tz) AS b, count(*) AS n
    FROM deals
    WHERE account_id = v_account AND status = 'won' AND closed_at >= v_start
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'series', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        't', to_char(bk.b, 'YYYY-MM-DD"T"HH24:MI'),
        'incoming', COALESCE(mc.incoming, 0),
        'outgoing', COALESCE(mc.outgoing, 0),
        'newConversations', COALESCE(cc.n, 0),
        'resolved', COALESCE(rc.n, 0),
        'dealsWon', COALESCE(wc.n, 0)
      ) ORDER BY bk.b)
      FROM buckets bk
      LEFT JOIN msg_counts mc ON mc.b = bk.b
      LEFT JOIN conv_counts cc ON cc.b = bk.b
      LEFT JOIN resolved_counts rc ON rc.b = bk.b
      LEFT JOIN won_counts wc ON wc.b = bk.b
    ), '[]'::jsonb),
    'hourly', (
      SELECT jsonb_agg(COALESCE(h.n, 0) ORDER BY hr.hour)
      FROM generate_series(0, 23) AS hr(hour)
      LEFT JOIN (
        SELECT extract(hour FROM local_at)::int AS hour, count(*) AS n
        FROM period_msgs
        WHERE sender_type = 'customer'
        GROUP BY 1
      ) h ON h.hour = hr.hour
    )
  ) INTO v_volume;

  SELECT jsonb_build_object(
    'newConversations', (
      SELECT count(*) FROM conversations
      WHERE account_id = v_account AND created_at >= v_start
    ),
    'newConversationsPrevious', (
      SELECT count(*) FROM conversations
      WHERE account_id = v_account AND created_at >= v_prev_start AND created_at < v_prev_end
    ),
    'resolved', (
      SELECT count(*) FROM conversations
      WHERE account_id = v_account AND status = 'closed' AND closed_at >= v_start
    ),
    'resolvedPrevious', (
      SELECT count(*) FROM conversations
      WHERE account_id = v_account AND status = 'closed' AND closed_at >= v_prev_start AND closed_at < v_prev_end
    ),
    'dealsWon', (
      SELECT count(*) FROM deals
      WHERE account_id = v_account AND status = 'won' AND closed_at >= v_start
    ),
    'dealsWonPrevious', (
      SELECT count(*) FROM deals
      WHERE account_id = v_account AND status = 'won' AND closed_at >= v_prev_start AND closed_at < v_prev_end
    ),
    'dealsWonValue', (
      SELECT COALESCE(sum(value), 0) FROM deals
      WHERE account_id = v_account AND status = 'won' AND closed_at >= v_start
    ),
    'broadcastDelivered', (
      SELECT COALESCE(sum(delivered_count), 0) FROM broadcasts
      WHERE account_id = v_account AND status IN ('sending', 'sent')
        AND COALESCE(scheduled_at, created_at) >= v_start
    ),
    'broadcastRead', (
      SELECT COALESCE(sum(read_count), 0) FROM broadcasts
      WHERE account_id = v_account AND status IN ('sending', 'sent')
        AND COALESCE(scheduled_at, created_at) >= v_start
    ),
    'broadcastDeliveredPrevious', (
      SELECT COALESCE(sum(delivered_count), 0) FROM broadcasts
      WHERE account_id = v_account AND status IN ('sending', 'sent')
        AND COALESCE(scheduled_at, created_at) >= v_prev_start
        AND COALESCE(scheduled_at, created_at) < v_prev_end
    ),
    'broadcastReadPrevious', (
      SELECT COALESCE(sum(read_count), 0) FROM broadcasts
      WHERE account_id = v_account AND status IN ('sending', 'sent')
        AND COALESCE(scheduled_at, created_at) >= v_prev_start
        AND COALESCE(scheduled_at, created_at) < v_prev_end
    )
  ) INTO v_kpis;

  SELECT jsonb_build_object(
    'pipelines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name) ORDER BY pl.created_at, pl.id)
      FROM pipelines pl
      WHERE pl.account_id = v_account
    ), '[]'::jsonb),
    'stages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'pipelineId', s.pipeline_id,
        'name', s.name,
        'color', s.color,
        'dealCount', (SELECT count(*) FROM deals d WHERE d.stage_id = s.id AND d.status = 'open'),
        'totalValue', (SELECT COALESCE(sum(d.value), 0) FROM deals d WHERE d.stage_id = s.id AND d.status = 'open')
      ) ORDER BY s.position, s.created_at)
      FROM pipeline_stages s
      JOIN pipelines pl ON pl.id = s.pipeline_id
      WHERE pl.account_id = v_account
    ), '[]'::jsonb),
    'stats', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'pipelineId', pl.id,
        'won', (
          SELECT count(*) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'won' AND d.closed_at >= v_start
        ),
        'lost', (
          SELECT count(*) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'lost' AND d.closed_at >= v_start
        ),
        'avgDaysToWin', (
          SELECT avg(extract(epoch FROM d.closed_at - d.created_at) / 86400.0) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'won' AND d.closed_at >= v_start
        ),
        'idleDeals', (
          SELECT count(*) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'open' AND d.updated_at < v_now - interval '7 days'
        )
      ))
      FROM pipelines pl
      WHERE pl.account_id = v_account
    ), '[]'::jsonb)
  ) INTO v_pipeline;

  SELECT jsonb_build_object(
    'latestBroadcast', (
      SELECT jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'status', b.status,
        'at', COALESCE(b.scheduled_at, b.created_at),
        'recipients', b.total_recipients,
        'delivered', b.delivered_count,
        'read', b.read_count,
        'replied', b.replied_count,
        'failed', b.failed_count
      )
      FROM broadcasts b
      WHERE b.account_id = v_account AND b.status IN ('sending', 'sent', 'failed')
      ORDER BY COALESCE(b.scheduled_at, b.created_at) DESC
      LIMIT 1
    ),
    'automationRuns', (
      SELECT count(*) FROM automation_logs
      WHERE account_id = v_account AND created_at >= v_start
    ),
    'automationFailed', (
      SELECT count(*) FROM automation_logs
      WHERE account_id = v_account AND created_at >= v_start AND status = 'failed'
    ),
    'flowFailed', (
      SELECT count(*) FROM flow_runs
      WHERE account_id = v_account AND status = 'failed' AND ended_at >= v_start
    ),
    'topFailingFlow', (
      SELECT jsonb_build_object('id', f.id, 'name', f.name, 'failed', count(*))
      FROM flow_runs r
      JOIN flows f ON f.id = r.flow_id
      WHERE r.account_id = v_account AND r.status = 'failed' AND r.ended_at >= v_start
      GROUP BY f.id, f.name
      ORDER BY count(*) DESC, f.name
      LIMIT 1
    ),
    'templatesApproved', (
      SELECT count(*) FROM message_templates
      WHERE account_id = v_account AND status = 'APPROVED'
    ),
    'templatesRejected', (
      SELECT count(*) FROM message_templates
      WHERE account_id = v_account AND status = 'REJECTED'
    )
  ) INTO v_campaigns;

  SELECT jsonb_build_object(
    'whatsappConnected', EXISTS (
      SELECT 1 FROM whatsapp_config WHERE account_id = v_account AND status = 'connected'
    ),
    'hasContacts', EXISTS (SELECT 1 FROM contacts WHERE account_id = v_account),
    'hasApprovedTemplate', EXISTS (
      SELECT 1 FROM message_templates WHERE account_id = v_account AND status = 'APPROVED'
    ),
    'memberCount', (SELECT count(*) FROM profiles WHERE account_id = v_account),
    'hasConversations', EXISTS (SELECT 1 FROM conversations WHERE account_id = v_account)
  ) INTO v_setup;

  RETURN jsonb_build_object(
    'generatedAt', v_now,
    'timeZone', v_tz,
    'days', p_days,
    'unit', v_unit,
    'periodStart', v_start,
    'previousStart', v_prev_start,
    'previousEnd', v_prev_end,
    'replyTargetMinutes', v_target,
    'attention', v_attention,
    'replies', v_replies,
    'volume', v_volume,
    'kpis', v_kpis,
    'pipeline', v_pipeline,
    'campaigns', v_campaigns,
    'setup', v_setup
  );
END;
$$;

ALTER FUNCTION public.dashboard_overview(INTEGER, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_overview(INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_overview(INTEGER, TEXT) TO authenticated;
