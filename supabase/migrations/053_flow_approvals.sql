-- Durable human-in-the-loop approvals for immutable flow versions.
CREATE TABLE IF NOT EXISTS flow_approval_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  flow_version_id UUID NOT NULL REFERENCES flow_versions(id) ON DELETE RESTRICT,
  flow_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL CHECK (char_length(node_key) BETWEEN 1 AND 200),
  visit_id UUID NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 3),
  assignee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  message TEXT NOT NULL CHECK (
    char_length(message) BETWEEN 1 AND 2000
    AND octet_length(message) <= 8000
  ),
  approved_next TEXT NOT NULL CHECK (char_length(approved_next) BETWEEN 1 AND 200),
  rejected_next TEXT NOT NULL CHECK (char_length(rejected_next) BETWEEN 1 AND 200),
  timeout_action TEXT NOT NULL CHECK (timeout_action IN ('fail', 'branch', 'default')),
  timeout_next TEXT CHECK (timeout_next IS NULL OR char_length(timeout_next) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'resuming', 'completed', 'failed')),
  decision TEXT CHECK (decision IN ('approved', 'rejected', 'timed_out')),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_note TEXT CHECK (
    decision_note IS NULL OR (
      char_length(decision_note) <= 1000
      AND octet_length(decision_note) <= 4000
    )
  ),
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  resolution_token UUID,
  resume_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retention_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
  UNIQUE (flow_run_id, visit_id, node_key, attempt),
  CHECK (
    (status = 'pending' AND decision IS NULL)
    OR (status <> 'pending' AND decision IS NOT NULL)
  ),
  CHECK (
    (timeout_action = 'fail' AND timeout_next IS NULL)
    OR (timeout_action IN ('branch', 'default') AND timeout_next IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_flow_approval_assignee_pending
  ON flow_approval_requests(assignee_user_id, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_flow_approval_due
  ON flow_approval_requests(expires_at, id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_flow_approval_resolution
  ON flow_approval_requests(updated_at, id)
  WHERE status IN ('resolved', 'resuming');
CREATE INDEX IF NOT EXISTS idx_flow_approval_account_created
  ON flow_approval_requests(account_id, created_at DESC);

ALTER TABLE flow_run_events
  DROP CONSTRAINT IF EXISTS flow_run_events_event_type_check;
ALTER TABLE flow_run_events
  ADD CONSTRAINT flow_run_events_event_type_check
  CHECK (event_type IN (
    'started',
    'node_entered',
    'message_sent',
    'reply_received',
    'fallback_fired',
    'handoff',
    'timeout',
    'error',
    'completed',
    'approval_decision',
    'approval_timeout'
  ));

ALTER TABLE flow_approval_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flow_approval_requests_select ON flow_approval_requests;
CREATE POLICY flow_approval_requests_select
  ON flow_approval_requests FOR SELECT
  USING (
    (
      auth.uid() = assignee_user_id
      AND public.is_account_member(account_id, 'agent')
    )
    OR public.is_account_member(account_id, 'admin')
  );

REVOKE ALL ON TABLE flow_approval_requests FROM PUBLIC, anon;
REVOKE ALL ON TABLE flow_approval_requests FROM authenticated;
GRANT ALL ON TABLE flow_approval_requests TO service_role;

-- A paused approval still owns the account/contact active-run slot.
DROP INDEX IF EXISTS idx_one_active_run_per_contact;
CREATE UNIQUE INDEX idx_one_active_run_per_contact
  ON flow_runs(account_id, contact_id)
  WHERE status IN (
    'active', 'waiting', 'resuming', 'needs_recovery', 'paused_by_agent'
  );

-- Reuse the existing in-app inbox. No contact channel is stored or exposed.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS approval_request_id UUID
  REFERENCES flow_approval_requests(id) ON DELETE CASCADE;
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'flow_approval'));
CREATE INDEX IF NOT EXISTS idx_notifications_approval_request
  ON notifications(approval_request_id)
  WHERE approval_request_id IS NOT NULL;

-- A notification must stop being visible as soon as its recipient leaves (or
-- is transferred out of) the tenant. Keep the recipient check as well so
-- current teammates cannot read or acknowledge each other's notifications.
DROP POLICY IF EXISTS notifications_select ON notifications;
DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (
    auth.uid() = user_id
    AND public.is_account_member(account_id, 'viewer')
  );
CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (
    auth.uid() = user_id
    AND public.is_account_member(account_id, 'viewer')
  )
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_account_member(account_id, 'viewer')
  );

CREATE OR REPLACE FUNCTION end_flow_run_if_owned(
  p_run_id UUID,
  p_active_flow_version_id UUID,
  p_expected_status TEXT,
  p_expected_node_key TEXT,
  p_expected_visit_id UUID,
  p_expected_continuation_id UUID,
  p_target_status TEXT,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_target_status NOT IN ('completed', 'handed_off', 'timed_out', 'failed')
     OR NULLIF(BTRIM(p_reason), '') IS NULL
  THEN
    RAISE EXCEPTION 'invalid_flow_run_terminal_transition';
  END IF;

  UPDATE public.flow_runs run
  SET status = p_target_status,
      ended_at = NOW(),
      end_reason = LEFT(p_reason, 200),
      wake_at = NULL,
      last_advanced_at = NOW()
  WHERE run.id = p_run_id
    AND COALESCE(run.active_flow_version_id, run.flow_version_id)
        IS NOT DISTINCT FROM p_active_flow_version_id
    AND run.status IS NOT DISTINCT FROM p_expected_status
    AND run.current_node_key IS NOT DISTINCT FROM p_expected_node_key
    AND run.current_visit_id IS NOT DISTINCT FROM p_expected_visit_id
    AND run.continuation_id IS NOT DISTINCT FROM p_expected_continuation_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION end_flow_run_if_owned(
  UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT
) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION end_flow_run_if_owned(
  UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION schedule_flow_approval(
  p_run_id UUID,
  p_flow_id UUID,
  p_flow_version_id UUID,
  p_node_key TEXT,
  p_visit_id UUID,
  p_attempt INTEGER,
  p_assignee_user_id UUID,
  p_title TEXT,
  p_message TEXT,
  p_expires_at TIMESTAMPTZ,
  p_approved_next TEXT,
  p_rejected_next TEXT,
  p_timeout_action TEXT,
  p_timeout_next TEXT DEFAULT NULL
)
RETURNS SETOF flow_approval_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_run public.flow_runs%ROWTYPE;
  v_request public.flow_approval_requests%ROWTYPE;
  v_assignee_profile public.profiles%ROWTYPE;
  v_graph_node JSONB;
  v_inserted BOOLEAN := FALSE;
BEGIN
  IF p_attempt NOT BETWEEN 1 AND 3
     OR p_expires_at <= NOW()
     OR NULLIF(BTRIM(p_title), '') IS NULL
     OR char_length(p_title) > 120
     OR NULLIF(BTRIM(p_message), '') IS NULL
     OR char_length(p_message) > 2000
     OR octet_length(p_message) > 8000
     OR p_timeout_action NOT IN ('fail', 'branch', 'default')
     OR (p_timeout_action = 'fail' AND p_timeout_next IS NOT NULL)
     OR (p_timeout_action <> 'fail' AND NULLIF(BTRIM(p_timeout_next), '') IS NULL)
  THEN
    RAISE EXCEPTION 'invalid_flow_approval';
  END IF;

  SELECT * INTO v_run
  FROM public.flow_runs
  WHERE id = p_run_id;
  IF NOT FOUND OR v_run.account_id IS NULL THEN
    RAISE EXCEPTION 'stale_flow_approval_cursor';
  END IF;

  -- The insert/unique key establishes one request identity without taking a
  -- run row lock. All approval lifecycle RPCs then use request -> run order.
  INSERT INTO public.flow_approval_requests (
    account_id, flow_id, flow_version_id, flow_run_id, node_key, visit_id,
    attempt, assignee_user_id, title, message, expires_at, approved_next,
    rejected_next, timeout_action, timeout_next
  )
  VALUES (
    v_run.account_id, p_flow_id, p_flow_version_id, p_run_id, p_node_key,
    p_visit_id, p_attempt, p_assignee_user_id, BTRIM(p_title), BTRIM(p_message),
    p_expires_at, p_approved_next, p_rejected_next, p_timeout_action,
    p_timeout_next
  )
  ON CONFLICT (flow_run_id, visit_id, node_key, attempt) DO NOTHING
  RETURNING * INTO v_request;
  v_inserted := FOUND;

  SELECT * INTO v_request
  FROM public.flow_approval_requests
  WHERE flow_run_id = p_run_id
    AND visit_id = p_visit_id
    AND node_key = p_node_key
    AND attempt = p_attempt
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_flow_approval_cursor';
  END IF;

  SELECT * INTO v_run
  FROM public.flow_runs
  WHERE id = p_run_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_run.account_id IS NULL
     OR v_request.account_id IS DISTINCT FROM v_run.account_id
     OR v_run.status NOT IN ('active', 'resuming', 'needs_recovery', 'paused_by_agent')
     OR v_run.current_node_key IS DISTINCT FROM p_node_key
     OR v_run.current_visit_id IS DISTINCT FROM p_visit_id
     OR COALESCE(v_run.active_flow_id, v_run.flow_id) IS DISTINCT FROM p_flow_id
     OR COALESCE(v_run.active_flow_version_id, v_run.flow_version_id)
        IS DISTINCT FROM p_flow_version_id
  THEN
    RAISE EXCEPTION 'stale_flow_approval_cursor';
  END IF;

  IF v_request.flow_version_id IS DISTINCT FROM p_flow_version_id
     OR v_request.flow_id IS DISTINCT FROM p_flow_id
     OR v_request.node_key IS DISTINCT FROM p_node_key
     OR v_request.visit_id IS DISTINCT FROM p_visit_id
     OR v_request.attempt IS DISTINCT FROM p_attempt
     OR v_request.assignee_user_id IS DISTINCT FROM p_assignee_user_id
     OR v_request.title IS DISTINCT FROM BTRIM(p_title)
     OR v_request.message IS DISTINCT FROM BTRIM(p_message)
     OR v_request.expires_at IS DISTINCT FROM p_expires_at
     OR v_request.approved_next IS DISTINCT FROM p_approved_next
     OR v_request.rejected_next IS DISTINCT FROM p_rejected_next
     OR v_request.timeout_action IS DISTINCT FROM p_timeout_action
     OR v_request.timeout_next IS DISTINCT FROM p_timeout_next
  THEN
    RAISE EXCEPTION 'flow_approval_idempotency_conflict';
  END IF;

  SELECT * INTO v_assignee_profile
  FROM public.profiles
  WHERE user_id = p_assignee_user_id
  FOR SHARE;
  IF NOT FOUND
     OR v_assignee_profile.account_id IS DISTINCT FROM v_run.account_id
     OR v_assignee_profile.account_role NOT IN ('owner', 'admin', 'agent')
  THEN
    RAISE EXCEPTION 'approval_assignee_not_eligible';
  END IF;

  SELECT node INTO v_graph_node
  FROM public.flow_versions version,
       LATERAL jsonb_array_elements(version.graph->'nodes') node
  WHERE version.id = p_flow_version_id
    AND version.flow_id = p_flow_id
    AND version.account_id = v_run.account_id
    AND node->>'node_key' = p_node_key
    AND node->>'node_type' = 'approval';
  IF NOT FOUND
     OR v_graph_node->'config'->>'assignee_user_id'
        IS DISTINCT FROM p_assignee_user_id::TEXT
     OR v_graph_node->'config'->>'approved_next'
        IS DISTINCT FROM p_approved_next
     OR v_graph_node->'config'->>'rejected_next'
        IS DISTINCT FROM p_rejected_next
  THEN
    RAISE EXCEPTION 'approval_pinned_config_mismatch';
  END IF;

  UPDATE public.flow_runs
  SET status = 'paused_by_agent',
      wake_at = p_expires_at,
      ended_at = NULL,
      end_reason = NULL,
      last_advanced_at = NOW()
  WHERE id = p_run_id
    AND account_id = v_request.account_id
    AND current_node_key = p_node_key
    AND current_visit_id = p_visit_id
    AND status IN ('active', 'resuming', 'needs_recovery', 'paused_by_agent')
    AND COALESCE(active_flow_id, flow_id) = p_flow_id
    AND COALESCE(active_flow_version_id, flow_version_id) = p_flow_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_flow_approval_cursor';
  END IF;

  IF v_inserted THEN
    INSERT INTO public.notifications (
      account_id, user_id, type, approval_request_id, title, body
    )
    VALUES (
      v_request.account_id, v_request.assignee_user_id, 'flow_approval',
      v_request.id, LEFT(v_request.title, 120),
      'A flow is waiting for your decision.'
    );
  END IF;
  RETURN NEXT v_request;
END;
$$;

REVOKE ALL ON FUNCTION schedule_flow_approval(
  UUID, UUID, UUID, TEXT, UUID, INTEGER, UUID, TEXT, TEXT, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION schedule_flow_approval(
  UUID, UUID, UUID, TEXT, UUID, INTEGER, UUID, TEXT, TEXT, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION decide_flow_approval(
  p_request_id UUID,
  p_expected_revision BIGINT,
  p_decision TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_request public.flow_approval_requests%ROWTYPE;
  v_actor_profile public.profiles%ROWTYPE;
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'approval_unauthorized';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected')
     OR p_expected_revision < 0
     OR char_length(COALESCE(p_note, '')) > 1000
     OR octet_length(COALESCE(p_note, '')) > 4000
  THEN
    RAISE EXCEPTION 'invalid_flow_approval_decision';
  END IF;

  SELECT * INTO v_request
  FROM public.flow_approval_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_not_found';
  END IF;

  -- Lock order: approval request first, then the actor profile. Membership
  -- mutation RPCs UPDATE profiles and never lock approval requests, so this
  -- FOR SHARE conflicts with removal/demotion/transfer without a lock cycle.
  SELECT * INTO v_actor_profile
  FROM public.profiles
  WHERE user_id = v_actor
  FOR SHARE;
  IF NOT FOUND
     OR v_actor_profile.account_id IS DISTINCT FROM v_request.account_id
     OR NOT (
       (
         v_actor = v_request.assignee_user_id
         AND v_actor_profile.account_role IN ('owner', 'admin', 'agent')
       )
       OR v_actor_profile.account_role IN ('owner', 'admin')
     )
  THEN
    RAISE EXCEPTION 'approval_not_found';
  END IF;

  -- An exact retry is a successful no-op even after the deadline if the
  -- client lost the original response. Any changed decision, note, or CAS
  -- revision remains a conflict.
  IF v_request.decision = p_decision
     AND p_expected_revision = v_request.revision - 1
     AND v_request.decision_note IS NOT DISTINCT FROM NULLIF(BTRIM(p_note), '')
  THEN
    RETURN jsonb_build_object(
      'id', v_request.id,
      'account_id', v_request.account_id,
      'flow_id', v_request.flow_id,
      'flow_version_id', v_request.flow_version_id,
      'flow_run_id', v_request.flow_run_id,
      'node_key', v_request.node_key,
      'assignee_user_id', v_request.assignee_user_id,
      'title', v_request.title,
      'message', v_request.message,
      'status', v_request.status,
      'decision', v_request.decision,
      'revision', v_request.revision,
      'decision_note', v_request.decision_note,
      'decided_at', v_request.decided_at,
      'expires_at', v_request.expires_at,
      'created_at', v_request.created_at
    );
  ELSIF v_request.decision IS NOT NULL THEN
    RAISE EXCEPTION 'approval_already_decided';
  END IF;
  IF v_request.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'approval_expired';
  END IF;
  IF v_request.status <> 'pending'
     OR v_request.revision <> p_expected_revision
  THEN
    RAISE EXCEPTION 'approval_revision_conflict';
  END IF;

  UPDATE public.flow_approval_requests
  SET status = 'resolved',
      decision = p_decision,
      decided_by = v_actor,
      decision_note = NULLIF(BTRIM(p_note), ''),
      decided_at = NOW(),
      revision = revision + 1,
      updated_at = NOW()
  WHERE id = p_request_id
    AND status = 'pending'
    AND revision = p_expected_revision
  RETURNING * INTO v_request;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_revision_conflict';
  END IF;
  INSERT INTO public.flow_run_events (
    flow_run_id, event_type, node_key, payload
  ) VALUES (
    v_request.flow_run_id,
    'approval_decision',
    v_request.node_key,
    jsonb_build_object(
      'reason', 'approval_decision',
      'approval_request_id', v_request.id,
      'decision', v_request.decision,
      'decided_by', v_actor
    )
  );
  RETURN jsonb_build_object(
    'id', v_request.id,
    'account_id', v_request.account_id,
    'flow_id', v_request.flow_id,
    'flow_version_id', v_request.flow_version_id,
    'flow_run_id', v_request.flow_run_id,
    'node_key', v_request.node_key,
    'assignee_user_id', v_request.assignee_user_id,
    'title', v_request.title,
    'message', v_request.message,
    'status', v_request.status,
    'decision', v_request.decision,
    'revision', v_request.revision,
    'decision_note', v_request.decision_note,
    'decided_at', v_request.decided_at,
    'expires_at', v_request.expires_at,
    'created_at', v_request.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION decide_flow_approval(UUID, BIGINT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decide_flow_approval(UUID, BIGINT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION decide_flow_approval(UUID, BIGINT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION claim_flow_approval_resolutions(
  p_request_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  flow_run_id UUID,
  flow_version_id UUID,
  node_key TEXT,
  decision TEXT,
  resolution_token UUID,
  resume_id UUID,
  run_row JSONB,
  chained_approval_ready BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_request public.flow_approval_requests%ROWTYPE;
  v_run public.flow_runs%ROWTYPE;
  v_token UUID;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_approval_claim_limit';
  END IF;

  -- Expiry and resolution happen under the same row lock as claiming.
  UPDATE public.flow_approval_requests request
  SET status = 'resolved',
      decision = 'timed_out',
      decided_at = NOW(),
      revision = request.revision + 1,
      updated_at = NOW()
  WHERE request.id IN (
    SELECT due.id
    FROM public.flow_approval_requests due
    WHERE due.status = 'pending'
      AND due.expires_at <= NOW()
      AND (p_request_id IS NULL OR due.id = p_request_id)
    ORDER BY due.expires_at, due.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  );

  FOR v_request IN
    SELECT request.*
    FROM public.flow_approval_requests request
    WHERE (
      request.status = 'resolved'
      OR (
        request.status = 'resuming'
        AND request.claimed_at < NOW() - INTERVAL '5 minutes'
      )
    )
      AND (p_request_id IS NULL OR request.id = p_request_id)
    ORDER BY request.updated_at, request.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  LOOP
    SELECT * INTO v_run
    FROM public.flow_runs
    WHERE flow_runs.id = v_request.flow_run_id
    FOR UPDATE;
    IF NOT FOUND
       OR COALESCE(v_run.active_flow_version_id, v_run.flow_version_id)
          IS DISTINCT FROM v_request.flow_version_id
    THEN
      UPDATE public.flow_approval_requests
      SET status = 'failed', updated_at = NOW()
      WHERE flow_approval_requests.id = v_request.id;
      CONTINUE;
    END IF;

    IF v_request.decision = 'timed_out'
       AND v_request.status = 'resolved'
    THEN
      INSERT INTO public.flow_run_events (
        flow_run_id, event_type, node_key, payload
      ) VALUES (
        v_request.flow_run_id,
        'approval_timeout',
        v_request.node_key,
        jsonb_build_object(
          'reason', 'approval_timeout',
          'approval_request_id', v_request.id,
          'timeout_action', v_request.timeout_action
        )
      );
    END IF;

    IF v_request.decision = 'timed_out'
       AND v_request.timeout_action = 'fail'
    THEN
      UPDATE public.flow_runs
      SET status = 'failed',
          ended_at = NOW(),
          end_reason = 'approval_timed_out',
          wake_at = NULL,
          last_advanced_at = NOW()
      WHERE flow_runs.id = v_run.id
        AND flow_runs.status = 'paused_by_agent'
        AND flow_runs.current_node_key = v_request.node_key
        AND flow_runs.current_visit_id = v_request.visit_id;
      UPDATE public.flow_approval_requests
      SET status = 'completed', completed_at = NOW(), updated_at = NOW()
      WHERE flow_approval_requests.id = v_request.id;
      INSERT INTO public.notifications (
        account_id, user_id, type, approval_request_id, title, body
      ) VALUES (
        v_request.account_id, v_request.assignee_user_id, 'flow_approval',
        v_request.id, 'Approval timed out', 'The flow ended under its timeout policy.'
      );
      CONTINUE;
    END IF;

    IF v_request.status = 'resolved' THEN
      v_token := uuid_generate_v4();
      UPDATE public.flow_runs
      SET status = 'resuming',
          current_node_key = CASE v_request.decision
            WHEN 'approved' THEN v_request.approved_next
            WHEN 'rejected' THEN v_request.rejected_next
            ELSE v_request.timeout_next
          END,
          current_visit_id = v_request.resume_id,
          continuation_id = v_request.resume_id,
          continuation_phase = 'running',
          continuation_step = continuation_step + 1,
          wake_at = NULL,
          ended_at = NULL,
          end_reason = NULL,
          last_advanced_at = NOW()
      WHERE flow_runs.id = v_run.id
        AND flow_runs.status = 'paused_by_agent'
        AND flow_runs.current_node_key = v_request.node_key
        AND flow_runs.current_visit_id = v_request.visit_id
      RETURNING * INTO v_run;
      IF NOT FOUND THEN
        UPDATE public.flow_approval_requests
        SET status = 'failed', updated_at = NOW()
        WHERE flow_approval_requests.id = v_request.id;
        CONTINUE;
      END IF;
    ELSE
      v_token := uuid_generate_v4();
      SELECT * INTO v_run FROM public.flow_runs WHERE flow_runs.id = v_request.flow_run_id;
    END IF;

    -- If a worker committed the next approval but lost this request's ACK,
    -- durable evidence on the current run/visit proves that replaying the
    -- cursor would duplicate execution. This value is computed while both the
    -- request and run rows are locked and is returned with the claim.
    chained_approval_ready := (
      v_request.status = 'resuming'
      AND v_run.status = 'paused_by_agent'
      AND v_run.current_node_key IS NOT DISTINCT FROM CASE v_request.decision
        WHEN 'approved' THEN v_request.approved_next
        WHEN 'rejected' THEN v_request.rejected_next
        ELSE v_request.timeout_next
      END
      AND v_run.current_visit_id IS NOT DISTINCT FROM v_request.resume_id
      AND v_run.continuation_id IS NOT DISTINCT FROM v_request.resume_id
      AND EXISTS (
        SELECT 1
        FROM public.flow_approval_requests chained
        WHERE chained.id <> v_request.id
          AND chained.flow_run_id = v_request.flow_run_id
          AND chained.flow_version_id = v_request.flow_version_id
          AND chained.node_key = v_run.current_node_key
          AND chained.visit_id = v_run.current_visit_id
          AND chained.status IN ('pending', 'resolved', 'resuming', 'completed')
      )
    );

    UPDATE public.flow_approval_requests
    SET status = 'resuming',
        resolution_token = v_token,
        claimed_at = NOW(),
        updated_at = NOW()
    WHERE flow_approval_requests.id = v_request.id;

    id := v_request.id;
    flow_run_id := v_request.flow_run_id;
    flow_version_id := v_request.flow_version_id;
    node_key := v_request.node_key;
    decision := v_request.decision;
    resolution_token := v_token;
    resume_id := v_request.resume_id;
    run_row := to_jsonb(v_run);
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION claim_flow_approval_resolutions(UUID, INTEGER)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION claim_flow_approval_resolutions(UUID, INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION complete_flow_approval_resolution(
  p_request_id UUID,
  p_resolution_token UUID,
  p_flow_version_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_request public.flow_approval_requests%ROWTYPE;
  v_run public.flow_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_request
  FROM public.flow_approval_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.flow_version_id IS DISTINCT FROM p_flow_version_id THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_run
  FROM public.flow_runs
  WHERE id = v_request.flow_run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_request.status = 'completed' THEN
    RETURN TRUE;
  END IF;
  IF v_request.status <> 'resuming'
     OR v_request.resolution_token IS DISTINCT FROM p_resolution_token
  THEN
    RETURN FALSE;
  END IF;

  UPDATE public.flow_approval_requests
  SET status = 'completed',
      completed_at = COALESCE(completed_at, NOW()),
      updated_at = NOW()
  WHERE id = p_request_id;

  UPDATE public.flow_runs
  SET status = CASE
        WHEN status = 'resuming' THEN 'active'
        ELSE status
      END,
      wake_at = CASE
        WHEN status = 'resuming' THEN NULL
        ELSE wake_at
      END,
      continuation_id = NULL,
      continuation_phase = 'idle',
      continuation_step = 0,
      last_advanced_at = NOW()
  WHERE id = v_request.flow_run_id
    AND continuation_id = v_request.resume_id
    AND continuation_phase IN ('running', 'completed');

  INSERT INTO public.notifications (
    account_id, user_id, type, approval_request_id, title, body
  ) VALUES (
    v_request.account_id, v_request.assignee_user_id, 'flow_approval',
    v_request.id, 'Approval resolved',
    CASE v_request.decision
      WHEN 'approved' THEN 'The request was approved and the flow resumed.'
      WHEN 'rejected' THEN 'The request was rejected and the flow resumed.'
      ELSE 'The request timed out and the flow followed its timeout policy.'
    END
  );
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION complete_flow_approval_resolution(UUID, UUID, UUID)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION complete_flow_approval_resolution(UUID, UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION purge_expired_flow_approvals(
  p_limit INTEGER DEFAULT 100
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_approval_purge_limit';
  END IF;
  WITH doomed AS (
    SELECT id
    FROM public.flow_approval_requests
    WHERE status IN ('completed', 'failed')
      AND retention_expires_at <= NOW()
    ORDER BY retention_expires_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  DELETE FROM public.flow_approval_requests request
  USING doomed
  WHERE request.id = doomed.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION purge_expired_flow_approvals(INTEGER)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION purge_expired_flow_approvals(INTEGER) TO service_role;
