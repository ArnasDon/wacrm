-- Runtime primitives for authored flows.
-- This first section persists typed variable declarations. It is forward-only
-- and safe to rerun; later sections in this migration add runtime primitives.

ALTER TABLE flows
  ADD COLUMN IF NOT EXISTS variable_schema JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'flows_variable_schema_is_array'
      AND conrelid = 'flows'::regclass
  ) THEN
    ALTER TABLE flows
      ADD CONSTRAINT flows_variable_schema_is_array
      CHECK (jsonb_typeof(variable_schema) = 'array');
  END IF;
END $$;

-- Keep the revision guard and graph replacement from migration 047 while
-- extending its whitelisted envelope with variable_schema.
CREATE OR REPLACE FUNCTION save_flow_draft(
  p_flow_id UUID,
  p_expected_revision BIGINT,
  p_patch JSONB,
  p_nodes JSONB DEFAULT NULL
)
RETURNS SETOF flows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flow flows%ROWTYPE;
BEGIN
  SELECT * INTO v_flow
  FROM flows
  WHERE id = p_flow_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'flow not found';
  END IF;
  IF p_expected_revision IS NULL
     OR v_flow.draft_revision <> p_expected_revision THEN
    RAISE EXCEPTION USING
      MESSAGE = 'draft_revision_conflict',
      ERRCODE = '40001';
  END IF;
  IF jsonb_typeof(COALESCE(p_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'invalid flow draft patch';
  END IF;
  IF p_nodes IS NOT NULL AND jsonb_typeof(p_nodes) <> 'array' THEN
    RAISE EXCEPTION 'invalid flow draft nodes';
  END IF;
  IF p_patch ? 'variable_schema'
     AND jsonb_typeof(p_patch->'variable_schema') <> 'array' THEN
    RAISE EXCEPTION 'invalid flow variable schema';
  END IF;

  UPDATE flows
  SET name = CASE
        WHEN p_patch ? 'name' THEN p_patch->>'name'
        ELSE name
      END,
      description = CASE
        WHEN NOT (p_patch ? 'description') THEN description
        WHEN jsonb_typeof(p_patch->'description') = 'null' THEN NULL
        ELSE p_patch->>'description'
      END,
      trigger_type = CASE
        WHEN p_patch ? 'trigger_type' THEN p_patch->>'trigger_type'
        ELSE trigger_type
      END,
      trigger_config = CASE
        WHEN p_patch ? 'trigger_config' THEN p_patch->'trigger_config'
        ELSE trigger_config
      END,
      entry_node_id = CASE
        WHEN NOT (p_patch ? 'entry_node_id') THEN entry_node_id
        WHEN jsonb_typeof(p_patch->'entry_node_id') = 'null' THEN NULL
        ELSE p_patch->>'entry_node_id'
      END,
      fallback_policy = CASE
        WHEN p_patch ? 'fallback_policy' THEN p_patch->'fallback_policy'
        ELSE fallback_policy
      END,
      variable_schema = CASE
        WHEN p_patch ? 'variable_schema' THEN p_patch->'variable_schema'
        ELSE variable_schema
      END,
      draft_revision = v_flow.draft_revision + 1,
      updated_at = NOW()
  WHERE id = p_flow_id
  RETURNING * INTO v_flow;

  IF p_nodes IS NOT NULL THEN
    DELETE FROM flow_nodes WHERE flow_id = p_flow_id;
    INSERT INTO flow_nodes (
      flow_id, node_key, node_type, config, position_x, position_y
    )
    SELECT
      p_flow_id,
      node_key,
      node_type,
      config,
      COALESCE(position_x, 0),
      COALESCE(position_y, 0)
    FROM jsonb_to_recordset(p_nodes) AS node(
      node_key TEXT,
      node_type TEXT,
      config JSONB,
      position_x INTEGER,
      position_y INTEGER
    );
  END IF;

  RETURN NEXT v_flow;
END;
$$;

REVOKE ALL ON FUNCTION save_flow_draft(UUID, BIGINT, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_flow_draft(UUID, BIGINT, JSONB, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION save_flow_draft(UUID, BIGINT, JSONB, JSONB) TO service_role;

-- Restoring a version changes only the editable draft. Legacy version graphs
-- predate this field and therefore restore the safe empty schema.
CREATE OR REPLACE FUNCTION restore_flow_version(
  p_flow_id UUID,
  p_flow_version_id UUID,
  p_expected_draft_revision BIGINT,
  p_expected_published_version_id UUID
)
RETURNS SETOF flows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flow flows%ROWTYPE;
  v_graph JSONB;
BEGIN
  SELECT * INTO v_flow
  FROM flows
  WHERE id = p_flow_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'flow not found';
  END IF;
  IF p_expected_draft_revision IS NULL
     OR v_flow.draft_revision <> p_expected_draft_revision THEN
    RAISE EXCEPTION USING
      MESSAGE = 'draft_revision_conflict',
      ERRCODE = '40001';
  END IF;
  IF v_flow.published_version_id IS DISTINCT FROM p_expected_published_version_id THEN
    RAISE EXCEPTION USING
      MESSAGE = 'published_version_conflict',
      ERRCODE = '40001';
  END IF;

  SELECT graph INTO v_graph
  FROM flow_versions
  WHERE id = p_flow_version_id
    AND flow_id = p_flow_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'flow version not found';
  END IF;
  IF v_graph->>'schema_version' <> '1'
     OR (
       v_graph ? 'variable_schema'
       AND jsonb_typeof(v_graph->'variable_schema') <> 'array'
     ) THEN
    RAISE EXCEPTION 'invalid flow version graph';
  END IF;

  UPDATE flows
  SET trigger_type = v_graph #>> '{trigger,type}',
      trigger_config = v_graph #> '{trigger,config}',
      entry_node_id = v_graph->>'entry_node_key',
      fallback_policy = v_graph->'fallback_policy',
      variable_schema = COALESCE(v_graph->'variable_schema', '[]'::jsonb),
      draft_revision = v_flow.draft_revision + 1,
      updated_at = NOW()
  WHERE id = p_flow_id;

  DELETE FROM flow_nodes WHERE flow_id = p_flow_id;
  INSERT INTO flow_nodes (
    flow_id, node_key, node_type, config, position_x, position_y
  )
  SELECT
    p_flow_id, node_key, node_type, config,
    COALESCE(position_x, 0), COALESCE(position_y, 0)
  FROM jsonb_to_recordset(v_graph->'nodes') AS n(
    node_key TEXT,
    node_type TEXT,
    config JSONB,
    position_x INTEGER,
    position_y INTEGER
  );

  RETURN QUERY SELECT * FROM flows WHERE id = p_flow_id;
END;
$$;

REVOKE ALL ON FUNCTION restore_flow_version(UUID, UUID, BIGINT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION restore_flow_version(UUID, UUID, BIGINT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION restore_flow_version(UUID, UUID, BIGINT, UUID) TO service_role;

-- Durable waits are persisted state transitions, never in-process sleeps.
ALTER TABLE flow_runs
  DROP CONSTRAINT IF EXISTS flow_runs_status_check;
ALTER TABLE flow_runs
  ADD CONSTRAINT flow_runs_status_check CHECK (status IN (
    'active',
    'waiting',
    'resuming',
    'needs_recovery',
    'completed',
    'handed_off',
    'timed_out',
    'paused_by_agent',
    'failed'
  ));
ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS wake_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_visit_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  ADD COLUMN IF NOT EXISTS continuation_id UUID,
  ADD COLUMN IF NOT EXISTS continuation_phase TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS continuation_step BIGINT NOT NULL DEFAULT 0;

ALTER TABLE flow_runs
  DROP CONSTRAINT IF EXISTS flow_runs_continuation_phase_check;
ALTER TABLE flow_runs
  ADD CONSTRAINT flow_runs_continuation_phase_check
  CHECK (continuation_phase IN ('idle', 'running', 'completed'));

DROP INDEX IF EXISTS idx_one_active_run_per_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_contact
  ON flow_runs(account_id, contact_id)
  WHERE status IN ('active', 'waiting', 'resuming', 'needs_recovery');

CREATE TABLE IF NOT EXISTS flow_waits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  flow_version_id UUID NOT NULL REFERENCES flow_versions(id) ON DELETE RESTRICT,
  node_key TEXT NOT NULL,
  next_node_key TEXT NOT NULL,
  wake_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'claimed', 'resumed', 'failed')
  ),
  claim_token UUID,
  resume_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  claimed_at TIMESTAMPTZ,
  resumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flow_run_id)
);

ALTER TABLE flow_waits
  ADD COLUMN IF NOT EXISTS resume_id UUID NOT NULL DEFAULT uuid_generate_v4();

CREATE INDEX IF NOT EXISTS idx_flow_waits_due
  ON flow_waits(wake_at, id)
  WHERE status = 'pending';

ALTER TABLE flow_waits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flow_waits_select ON flow_waits;
CREATE POLICY flow_waits_select ON flow_waits FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM flow_runs run
      WHERE run.id = flow_waits.flow_run_id
        AND is_account_member(run.account_id, 'viewer')
    )
  );

CREATE OR REPLACE FUNCTION schedule_flow_wait(
  p_run_id UUID,
  p_flow_version_id UUID,
  p_node_key TEXT,
  p_next_node_key TEXT,
  p_wake_at TIMESTAMPTZ
)
RETURNS SETOF flow_waits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run flow_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run
  FROM flow_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_run.flow_version_id IS DISTINCT FROM p_flow_version_id THEN
    RAISE EXCEPTION 'flow run is not eligible for wait';
  END IF;

  -- A caller can safely retry after the transaction committed but its response
  -- was lost. Return the already-scheduled wait instead of rejecting the run
  -- because it has moved to the waiting state.
  IF v_run.status = 'waiting' THEN
    RETURN QUERY
    SELECT wait.*
    FROM flow_waits wait
    WHERE wait.flow_run_id = p_run_id
      AND wait.flow_version_id = p_flow_version_id
      AND wait.node_key = p_node_key
      AND wait.next_node_key = p_next_node_key
      AND wait.status IN ('pending', 'claimed');

    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  IF v_run.status NOT IN ('active', 'resuming', 'needs_recovery') THEN
    RAISE EXCEPTION 'flow run is not eligible for wait';
  END IF;

  IF p_wake_at <= NOW() OR NULLIF(BTRIM(p_next_node_key), '') IS NULL THEN
    RAISE EXCEPTION 'invalid flow wait';
  END IF;

  INSERT INTO flow_waits (
    flow_run_id,
    flow_version_id,
    node_key,
    next_node_key,
    wake_at,
    status,
    claim_token,
    claimed_at,
    resumed_at,
    resume_id,
    updated_at
  )
  VALUES (
    p_run_id,
    p_flow_version_id,
    p_node_key,
    p_next_node_key,
    p_wake_at,
    'pending',
    NULL,
    NULL,
    NULL,
    uuid_generate_v4(),
    NOW()
  )
  ON CONFLICT (flow_run_id) DO UPDATE
  SET flow_version_id = EXCLUDED.flow_version_id,
      node_key = EXCLUDED.node_key,
      next_node_key = EXCLUDED.next_node_key,
      wake_at = EXCLUDED.wake_at,
      status = 'pending',
      claim_token = NULL,
      claimed_at = NULL,
      resumed_at = NULL,
      resume_id = uuid_generate_v4(),
      updated_at = NOW();

  UPDATE flow_runs
  SET status = 'waiting',
      current_node_key = p_node_key,
      current_visit_id = uuid_generate_v4(),
      continuation_id = NULL,
      continuation_phase = 'idle',
      continuation_step = 0,
      wake_at = p_wake_at,
      last_advanced_at = NOW()
  WHERE id = p_run_id;

  RETURN QUERY SELECT * FROM flow_waits WHERE flow_run_id = p_run_id;
END;
$$;

REVOKE ALL ON FUNCTION schedule_flow_wait(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION schedule_flow_wait(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION schedule_flow_wait(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION claim_due_flow_waits(
  p_now TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  flow_run_id UUID,
  flow_version_id UUID,
  node_key TEXT,
  next_node_key TEXT,
  claim_token UUID,
  resume_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT wait.id
    FROM flow_waits wait
    JOIN flow_runs run
      ON run.id = wait.flow_run_id
     AND run.flow_version_id = wait.flow_version_id
    WHERE wait.wake_at <= p_now
      AND (
        (
          wait.status = 'pending'
          AND run.status = 'waiting'
          AND run.current_node_key = wait.node_key
        )
        OR (
          wait.status = 'claimed'
          AND wait.claimed_at < p_now - INTERVAL '5 minutes'
        )
      )
    ORDER BY wait.wake_at, wait.id
    FOR UPDATE OF wait SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
  ),
  claimed AS (
    UPDATE flow_waits wait
    SET status = 'claimed',
        claim_token = uuid_generate_v4(),
        claimed_at = p_now,
        updated_at = p_now
    FROM candidates
    WHERE wait.id = candidates.id
    RETURNING wait.*
  )
  SELECT
    claimed.id,
    claimed.flow_run_id,
    claimed.flow_version_id,
    claimed.node_key,
    claimed.next_node_key,
    claimed.claim_token,
    claimed.resume_id
  FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION claim_due_flow_waits(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_due_flow_waits(TIMESTAMPTZ, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION claim_due_flow_waits(TIMESTAMPTZ, INTEGER) TO service_role;

DROP FUNCTION IF EXISTS resume_flow_wait(UUID, UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION prepare_flow_wait_resume(
  p_wait_id UUID,
  p_claim_token UUID,
  p_flow_version_id UUID
)
RETURNS SETOF flow_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wait flow_waits%ROWTYPE;
  v_run flow_runs%ROWTYPE;
  v_run_id UUID;
BEGIN
  SELECT flow_run_id INTO v_run_id
  FROM flow_waits
  WHERE id = p_wait_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_run
  FROM flow_runs
  WHERE id = v_run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_wait
  FROM flow_waits
  WHERE id = p_wait_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_wait.status <> 'claimed'
     OR v_wait.claim_token IS DISTINCT FROM p_claim_token
     OR v_wait.flow_version_id IS DISTINCT FROM p_flow_version_id THEN
    RETURN;
  END IF;

  -- A reclaimed worker continues from the durable cursor of this exact
  -- continuation. It never starts again from the wait node.
  IF v_run.flow_version_id = p_flow_version_id
     AND v_run.continuation_id = v_wait.resume_id THEN
    RETURN NEXT v_run;
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE flow_runs
  SET status = 'resuming',
      current_node_key = v_wait.next_node_key,
      current_visit_id = v_wait.resume_id,
      continuation_id = v_wait.resume_id,
      continuation_phase = 'running',
      continuation_step = 0,
      last_advanced_at = NOW()
  WHERE id = v_wait.flow_run_id
    AND flow_version_id = p_flow_version_id
    AND status = 'waiting'
    AND current_node_key = v_wait.node_key
  RETURNING flow_runs.*;
END;
$$;

REVOKE ALL ON FUNCTION prepare_flow_wait_resume(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION prepare_flow_wait_resume(UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION prepare_flow_wait_resume(UUID, UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION complete_flow_wait_continuation(
  p_wait_id UUID,
  p_claim_token UUID,
  p_flow_version_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wait flow_waits%ROWTYPE;
BEGIN
  SELECT * INTO v_wait
  FROM flow_waits
  WHERE id = p_wait_id
    AND status = 'claimed'
    AND claim_token = p_claim_token
    AND flow_version_id = p_flow_version_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE flow_runs
  SET continuation_phase = 'completed',
      last_advanced_at = NOW()
  WHERE id = v_wait.flow_run_id
    AND flow_version_id = p_flow_version_id
    AND continuation_id = v_wait.resume_id
    AND continuation_phase IN ('running', 'completed');
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION complete_flow_wait_continuation(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_flow_wait_continuation(UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION complete_flow_wait_continuation(UUID, UUID, UUID) TO service_role;

DROP FUNCTION IF EXISTS advance_flow_run_cursor(UUID, UUID, TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION advance_flow_run_cursor(
  p_run_id UUID,
  p_flow_version_id UUID,
  p_expected_node_key TEXT,
  p_expected_visit_id UUID,
  p_next_node_key TEXT,
  p_next_visit_id UUID
)
RETURNS SETOF flow_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run flow_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run
  FROM flow_runs
  WHERE id = p_run_id
    AND flow_version_id = p_flow_version_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_run.status NOT IN ('active', 'resuming', 'needs_recovery') THEN
    RETURN;
  END IF;

  IF v_run.current_node_key IS DISTINCT FROM p_expected_node_key
     OR v_run.current_visit_id IS DISTINCT FROM p_expected_visit_id THEN
    IF v_run.current_node_key IS NOT DISTINCT FROM p_next_node_key
       AND v_run.current_visit_id IS NOT DISTINCT FROM p_next_visit_id THEN
      RETURN NEXT v_run;
    END IF;
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE flow_runs
  SET status = CASE
        WHEN continuation_id IS NOT NULL THEN 'resuming'
        WHEN status = 'needs_recovery' THEN 'active'
        ELSE status
      END,
      current_node_key = p_next_node_key,
      current_visit_id = p_next_visit_id,
      continuation_step = continuation_step + 1,
      last_advanced_at = NOW()
  WHERE id = p_run_id
  RETURNING flow_runs.*;
END;
$$;

REVOKE ALL ON FUNCTION advance_flow_run_cursor(UUID, UUID, TEXT, UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION advance_flow_run_cursor(UUID, UUID, TEXT, UUID, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION advance_flow_run_cursor(UUID, UUID, TEXT, UUID, TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION ack_flow_wait_resume(
  p_wait_id UUID,
  p_claim_token UUID,
  p_flow_version_id UUID,
  p_node_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wait flow_waits%ROWTYPE;
  v_run flow_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run
  FROM flow_runs
  WHERE flow_version_id = p_flow_version_id
    AND id = (SELECT flow_run_id FROM flow_waits WHERE id = p_wait_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_wait
  FROM flow_waits
  WHERE id = p_wait_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_wait.status = 'resumed'
     AND v_wait.claim_token = p_claim_token
     AND v_wait.flow_version_id = p_flow_version_id
     AND v_wait.node_key = p_node_key THEN
    RETURN TRUE;
  END IF;

  -- A second wait can supersede this claim while the first continuation is
  -- advancing. That durable replacement is itself the acknowledgement.
  IF v_wait.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN v_wait.node_key IS DISTINCT FROM p_node_key
      AND v_wait.status IN ('pending', 'claimed')
      AND v_run.current_node_key IS DISTINCT FROM p_node_key;
  END IF;

  IF v_wait.status <> 'claimed'
     OR v_wait.flow_version_id IS DISTINCT FROM p_flow_version_id
     OR v_wait.node_key IS DISTINCT FROM p_node_key
     OR v_run.continuation_id IS DISTINCT FROM v_wait.resume_id
     OR v_run.continuation_phase <> 'completed' THEN
    RETURN FALSE;
  END IF;

  UPDATE flow_waits
  SET status = 'resumed',
      resumed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_wait_id
    AND status = 'claimed'
    AND claim_token = p_claim_token;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE flow_runs
  SET status = CASE
        WHEN status IN ('resuming', 'needs_recovery') THEN 'active'
        ELSE status
      END,
      wake_at = NULL,
      continuation_id = NULL,
      continuation_phase = 'idle',
      continuation_step = 0,
      last_advanced_at = NOW()
  WHERE id = v_wait.flow_run_id
    AND continuation_id = v_wait.resume_id
    AND continuation_phase = 'completed';

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION ack_flow_wait_resume(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION ack_flow_wait_resume(UUID, UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION ack_flow_wait_resume(UUID, UUID, UUID, TEXT) TO service_role;

-- A reply is not considered consumed until its selected edge is durable.
-- The unique inbound identity makes retries return the original edge instead
-- of re-evaluating mutable in-memory state.
CREATE TABLE IF NOT EXISTS flow_reply_transitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  flow_run_id UUID REFERENCES flow_runs(id) ON DELETE SET NULL,
  flow_version_id UUID NOT NULL REFERENCES flow_versions(id) ON DELETE RESTRICT,
  meta_message_id TEXT NOT NULL,
  from_node_key TEXT NOT NULL,
  from_visit_id UUID NOT NULL,
  next_node_key TEXT NOT NULL,
  next_visit_id UUID NOT NULL,
  transition_kind TEXT NOT NULL
    CHECK (transition_kind IN (
      'reply_branch',
      'reprompt',
      'fallback_ignore',
      'fallback_handoff',
      'fallback_end'
    )),
  recovery_state TEXT NOT NULL
    CHECK (recovery_state IN ('pending', 'completed')),
  vars_after JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, contact_id, meta_message_id)
);

ALTER TABLE flow_reply_transitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flow_reply_transitions_select ON flow_reply_transitions;
CREATE POLICY flow_reply_transitions_select ON flow_reply_transitions FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

REVOKE ALL ON TABLE flow_reply_transitions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE flow_reply_transitions FROM authenticated;
GRANT SELECT ON TABLE flow_reply_transitions TO authenticated;
GRANT ALL ON TABLE flow_reply_transitions TO service_role;

CREATE OR REPLACE FUNCTION commit_flow_reply_transition(
  p_run_id UUID,
  p_flow_version_id UUID,
  p_expected_node_key TEXT,
  p_expected_visit_id UUID,
  p_next_node_key TEXT,
  p_meta_message_id TEXT,
  p_vars JSONB DEFAULT NULL
)
RETURNS TABLE (
  flow_run_id UUID,
  current_node_key TEXT,
  current_visit_id UUID,
  next_node_key TEXT,
  run_vars JSONB,
  reprompt_count INTEGER,
  continuation_step BIGINT,
  duplicate BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run flow_runs%ROWTYPE;
  v_transition flow_reply_transitions%ROWTYPE;
  v_next_visit_id UUID;
BEGIN
  IF NULLIF(BTRIM(p_expected_node_key), '') IS NULL
     OR NULLIF(BTRIM(p_next_node_key), '') IS NULL
     OR NULLIF(BTRIM(p_meta_message_id), '') IS NULL
     OR (p_vars IS NOT NULL AND jsonb_typeof(p_vars) <> 'object') THEN
    RETURN;
  END IF;

  SELECT * INTO v_run
  FROM flow_runs
  WHERE id = p_run_id
  FOR UPDATE;
  IF NOT FOUND OR v_run.flow_version_id IS DISTINCT FROM p_flow_version_id THEN
    RETURN;
  END IF;

  SELECT * INTO v_transition
  FROM flow_reply_transitions transition
  WHERE transition.account_id = v_run.account_id
    AND transition.contact_id = v_run.contact_id
    AND transition.meta_message_id = p_meta_message_id;
  IF FOUND THEN
    RETURN QUERY SELECT
      v_run.id,
      v_run.current_node_key,
      v_run.current_visit_id,
      v_transition.next_node_key,
      v_run.vars,
      v_run.reprompt_count,
      v_run.continuation_step,
      TRUE;
    RETURN;
  END IF;

  IF v_run.contact_id IS NULL
     OR v_run.status NOT IN ('active', 'resuming', 'needs_recovery')
     OR v_run.current_node_key IS DISTINCT FROM p_expected_node_key
     OR v_run.current_visit_id IS DISTINCT FROM p_expected_visit_id THEN
    RETURN;
  END IF;

  v_next_visit_id := uuid_generate_v4();
  INSERT INTO flow_reply_transitions (
    account_id,
    contact_id,
    flow_run_id,
    flow_version_id,
    meta_message_id,
    from_node_key,
    from_visit_id,
    next_node_key,
    next_visit_id,
    transition_kind,
    recovery_state,
    vars_after
  )
  VALUES (
    v_run.account_id,
    v_run.contact_id,
    p_run_id,
    p_flow_version_id,
    p_meta_message_id,
    p_expected_node_key,
    p_expected_visit_id,
    p_next_node_key,
    v_next_visit_id,
    'reply_branch',
    'pending',
    COALESCE(p_vars, v_run.vars)
  )
  RETURNING * INTO v_transition;

  UPDATE flow_runs
  SET status = CASE
        WHEN continuation_id IS NOT NULL THEN 'resuming'
        WHEN status = 'needs_recovery' THEN 'active'
        ELSE status
      END,
      vars = COALESCE(p_vars, flow_runs.vars),
      reprompt_count = 0,
      current_node_key = p_next_node_key,
      current_visit_id = v_next_visit_id,
      continuation_step = flow_runs.continuation_step + 1,
      last_advanced_at = NOW()
  WHERE id = p_run_id
  RETURNING * INTO v_run;

  RETURN QUERY SELECT
    v_run.id,
    v_run.current_node_key,
    v_run.current_visit_id,
    v_transition.next_node_key,
    v_run.vars,
    v_run.reprompt_count,
    v_run.continuation_step,
    FALSE;
END;
$$;

REVOKE ALL ON FUNCTION commit_flow_reply_transition(UUID, UUID, TEXT, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION commit_flow_reply_transition(UUID, UUID, TEXT, UUID, TEXT, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION commit_flow_reply_transition(UUID, UUID, TEXT, UUID, TEXT, TEXT, JSONB) TO service_role;

-- Every external effect reserves one stable operation id before invocation.
-- A different worker finding a reserved visit must mark it ambiguous and stop:
-- providers are not assumed to support idempotency. Once remote_committed,
-- recovery reuses the recorded result and never invokes the provider again.
CREATE TABLE IF NOT EXISTS flow_node_effects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  flow_version_id UUID NOT NULL REFERENCES flow_versions(id) ON DELETE RESTRICT,
  visit_id UUID NOT NULL,
  node_key TEXT NOT NULL,
  effect_kind TEXT NOT NULL,
  operation_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  invocation_token UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'remote_committed', 'completed', 'ambiguous')),
  result JSONB,
  external_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  remote_committed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  ambiguous_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flow_run_id, visit_id, node_key, effect_kind)
);

ALTER TABLE flow_node_effects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flow_node_effects_select ON flow_node_effects;
CREATE POLICY flow_node_effects_select ON flow_node_effects FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM flow_runs run
      WHERE run.id = flow_node_effects.flow_run_id
        AND is_account_member(run.account_id, 'viewer')
    )
  );

REVOKE ALL ON TABLE flow_node_effects FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE flow_node_effects FROM authenticated;
GRANT SELECT ON TABLE flow_node_effects TO authenticated;
GRANT ALL ON TABLE flow_node_effects TO service_role;

CREATE OR REPLACE FUNCTION reserve_flow_node_effect(
  p_run_id UUID,
  p_flow_version_id UUID,
  p_node_key TEXT,
  p_visit_id UUID,
  p_effect_kind TEXT,
  p_invocation_token UUID
)
RETURNS TABLE (
  id UUID,
  operation_id UUID,
  status TEXT,
  result JSONB,
  external_reference TEXT,
  is_owner BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NULLIF(BTRIM(p_effect_kind), '') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM flow_runs
    WHERE id = p_run_id
      AND flow_version_id = p_flow_version_id
      AND current_visit_id = p_visit_id
      AND status IN ('active', 'resuming', 'needs_recovery')
  ) THEN
    RETURN;
  END IF;

  INSERT INTO flow_node_effects (
    flow_run_id, flow_version_id, visit_id, node_key, effect_kind,
    invocation_token
  )
  VALUES (
    p_run_id, p_flow_version_id, p_visit_id, p_node_key, p_effect_kind,
    p_invocation_token
  )
  ON CONFLICT (flow_run_id, visit_id, node_key, effect_kind) DO NOTHING;

  RETURN QUERY
  SELECT
    effect.id,
    effect.operation_id,
    effect.status,
    effect.result,
    effect.external_reference,
    effect.invocation_token = p_invocation_token
  FROM flow_node_effects effect
  WHERE effect.flow_run_id = p_run_id
    AND effect.visit_id = p_visit_id
    AND effect.node_key = p_node_key
    AND effect.effect_kind = p_effect_kind;
END;
$$;

REVOKE ALL ON FUNCTION reserve_flow_node_effect(UUID, UUID, TEXT, UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_flow_node_effect(UUID, UUID, TEXT, UUID, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION reserve_flow_node_effect(UUID, UUID, TEXT, UUID, TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION mark_flow_node_effect_committed(
  p_effect_id UUID,
  p_operation_id UUID,
  p_result JSONB,
  p_external_reference TEXT DEFAULT NULL
)
RETURNS SETOF flow_node_effects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE flow_node_effects
  SET status = 'remote_committed',
      result = p_result,
      external_reference = LEFT(p_external_reference, 500),
      remote_committed_at = COALESCE(remote_committed_at, NOW()),
      updated_at = NOW()
  WHERE id = p_effect_id
    AND operation_id = p_operation_id
    AND status = 'reserved';

  RETURN QUERY
  SELECT effect.*
  FROM flow_node_effects effect
  WHERE effect.id = p_effect_id
    AND effect.operation_id = p_operation_id
    AND effect.status IN ('remote_committed', 'completed');
END;
$$;

REVOKE ALL ON FUNCTION mark_flow_node_effect_committed(UUID, UUID, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_flow_node_effect_committed(UUID, UUID, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION mark_flow_node_effect_committed(UUID, UUID, JSONB, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION mark_flow_node_effect_ambiguous(
  p_effect_id UUID,
  p_operation_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE flow_node_effects
  SET status = 'ambiguous',
      ambiguous_at = COALESCE(ambiguous_at, NOW()),
      updated_at = NOW()
  WHERE id = p_effect_id
    AND operation_id = p_operation_id
    AND status IN ('reserved', 'ambiguous');
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION mark_flow_node_effect_ambiguous(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_flow_node_effect_ambiguous(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION mark_flow_node_effect_ambiguous(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION complete_flow_node_effect(
  p_effect_id UUID,
  p_operation_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE flow_node_effects
  SET status = 'completed',
      completed_at = COALESCE(completed_at, NOW()),
      updated_at = NOW()
  WHERE id = p_effect_id
    AND operation_id = p_operation_id
    AND status IN ('remote_committed', 'completed');
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION complete_flow_node_effect(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_flow_node_effect(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION complete_flow_node_effect(UUID, UUID) TO service_role;

-- Reconcile an ambiguous post-remote failure under row locks. Only the exact
-- operation, cursor visit and wait continuation may move a run to recovery.
-- A completed ledger is treated as success and stale/terminal state is never
-- overwritten.
DROP FUNCTION IF EXISTS reconcile_flow_node_effect_recovery(UUID, UUID, UUID, UUID, TEXT, UUID, UUID);

CREATE OR REPLACE FUNCTION reconcile_flow_node_effect_recovery(
  p_run_id UUID,
  p_flow_version_id UUID,
  p_effect_id UUID,
  p_operation_id UUID,
  p_expected_node_key TEXT,
  p_expected_visit_id UUID,
  p_expected_continuation_id UUID DEFAULT NULL,
  p_intended_next_node_key TEXT DEFAULT NULL,
  p_intended_next_visit_id UUID DEFAULT NULL,
  p_remote_result JSONB DEFAULT NULL,
  p_external_reference TEXT DEFAULT NULL
)
RETURNS TABLE (
  outcome TEXT,
  run_row JSONB,
  effect_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run flow_runs%ROWTYPE;
  v_effect flow_node_effects%ROWTYPE;
BEGIN
  SELECT * INTO v_run
  FROM flow_runs
  WHERE id = p_run_id
    AND flow_version_id = p_flow_version_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_effect
  FROM flow_node_effects effect
  WHERE effect.id = p_effect_id
    AND effect.operation_id = p_operation_id
    AND effect.flow_run_id = p_run_id
    AND effect.flow_version_id = p_flow_version_id
    AND effect.node_key = p_expected_node_key
    AND effect.visit_id = p_expected_visit_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'stale', to_jsonb(v_run), NULL::TEXT;
    RETURN;
  END IF;

  IF v_effect.status = 'reserved'
     AND p_remote_result IS NOT NULL THEN
    UPDATE flow_node_effects
    SET status = 'remote_committed',
        result = p_remote_result,
        external_reference = LEFT(p_external_reference, 500),
        remote_committed_at = COALESCE(remote_committed_at, NOW()),
        updated_at = NOW()
    WHERE id = v_effect.id
      AND operation_id = p_operation_id
      AND status = 'reserved'
    RETURNING * INTO v_effect;
  END IF;

  IF v_effect.status = 'completed' THEN
    RETURN QUERY
    SELECT 'completed', to_jsonb(v_run), v_effect.status;
    RETURN;
  END IF;

  IF v_effect.status = 'remote_committed'
     AND p_intended_next_node_key IS NOT NULL
     AND p_intended_next_visit_id IS NOT NULL
     AND v_run.current_node_key IS NOT DISTINCT FROM p_intended_next_node_key
     AND v_run.current_visit_id IS NOT DISTINCT FROM p_intended_next_visit_id
     AND v_run.continuation_id IS NOT DISTINCT FROM p_expected_continuation_id
  THEN
    UPDATE flow_node_effects
    SET status = 'completed',
        completed_at = COALESCE(completed_at, NOW()),
        updated_at = NOW()
    WHERE id = v_effect.id
      AND operation_id = p_operation_id
      AND status = 'remote_committed'
    RETURNING * INTO v_effect;
    RETURN QUERY
    SELECT 'already_committed', to_jsonb(v_run), v_effect.status;
    RETURN;
  END IF;

  IF v_effect.status = 'remote_committed'
     AND v_run.status IN ('active', 'resuming', 'needs_recovery')
     AND v_run.current_node_key IS NOT DISTINCT FROM p_expected_node_key
     AND v_run.current_visit_id IS NOT DISTINCT FROM p_expected_visit_id
     AND v_run.continuation_id IS NOT DISTINCT FROM p_expected_continuation_id
  THEN
    UPDATE flow_runs
    SET status = 'needs_recovery',
        ended_at = NULL,
        end_reason = 'side_effect_committed_local_persistence_failed',
        last_advanced_at = NOW()
    WHERE id = p_run_id
    RETURNING * INTO v_run;
    RETURN QUERY
    SELECT 'recovery_required', to_jsonb(v_run), v_effect.status;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'stale', to_jsonb(v_run), v_effect.status;
END;
$$;

REVOKE ALL ON FUNCTION reconcile_flow_node_effect_recovery(UUID, UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, UUID, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION reconcile_flow_node_effect_recovery(UUID, UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, UUID, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION reconcile_flow_node_effect_recovery(UUID, UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, UUID, JSONB, TEXT) TO service_role;

DROP FUNCTION IF EXISTS mark_flow_run_cursor_recovery(UUID, UUID, TEXT, UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION mark_flow_run_cursor_recovery(
  p_run_id UUID,
  p_flow_version_id UUID,
  p_expected_node_key TEXT,
  p_expected_visit_id UUID,
  p_expected_continuation_id UUID,
  p_reason TEXT,
  p_intended_next_node_key TEXT,
  p_intended_next_visit_id UUID
)
RETURNS SETOF flow_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE flow_runs
  SET status = 'needs_recovery',
      ended_at = NULL,
      end_reason = LEFT(p_reason, 200),
      last_advanced_at = NOW()
  WHERE id = p_run_id
    AND flow_version_id = p_flow_version_id
    AND status IN ('active', 'resuming', 'needs_recovery')
    AND continuation_id IS NOT DISTINCT FROM p_expected_continuation_id
    AND (
      (
        current_node_key IS NOT DISTINCT FROM p_expected_node_key
        AND current_visit_id IS NOT DISTINCT FROM p_expected_visit_id
      )
      OR (
        p_intended_next_node_key IS NOT NULL
        AND p_intended_next_visit_id IS NOT NULL
        AND current_node_key IS NOT DISTINCT FROM p_intended_next_node_key
        AND current_visit_id IS NOT DISTINCT FROM p_intended_next_visit_id
      )
    )
  RETURNING flow_runs.*;
END;
$$;

REVOKE ALL ON FUNCTION mark_flow_run_cursor_recovery(UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_flow_run_cursor_recovery(UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION mark_flow_run_cursor_recovery(UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID) TO service_role;

-- A reprompt's cursor visit, counter and effect completion are one state
-- transition. Recovery therefore sees either the old remote_committed visit or
-- the fully advanced completed visit, never a completed ledger with a stale
-- counter.
CREATE OR REPLACE FUNCTION finalize_flow_reprompt_effect(
  p_run_id UUID,
  p_flow_version_id UUID,
  p_effect_id UUID,
  p_operation_id UUID,
  p_expected_node_key TEXT,
  p_expected_visit_id UUID,
  p_reprompt_count INTEGER,
  p_meta_message_id TEXT
)
RETURNS SETOF flow_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run flow_runs%ROWTYPE;
  v_effect flow_node_effects%ROWTYPE;
  v_next_visit_id UUID;
BEGIN
  IF p_reprompt_count < 1
     OR NULLIF(BTRIM(p_meta_message_id), '') IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_run
  FROM flow_runs
  WHERE id = p_run_id
  FOR UPDATE;
  IF NOT FOUND OR v_run.flow_version_id IS DISTINCT FROM p_flow_version_id THEN
    RETURN;
  END IF;

  SELECT * INTO v_effect
  FROM flow_node_effects effect
  WHERE effect.id = p_effect_id
    AND effect.operation_id = p_operation_id
    AND effect.flow_run_id = p_run_id
    AND effect.flow_version_id = p_flow_version_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_effect.status = 'completed' THEN
    IF v_run.reprompt_count >= p_reprompt_count THEN
      RETURN NEXT v_run;
    END IF;
    RETURN;
  END IF;

  IF v_effect.status <> 'remote_committed'
     OR v_effect.node_key IS DISTINCT FROM p_expected_node_key
     OR v_effect.visit_id IS DISTINCT FROM p_expected_visit_id
     OR v_run.contact_id IS NULL
     OR v_run.status NOT IN ('active', 'resuming', 'needs_recovery')
     OR v_run.current_node_key IS DISTINCT FROM p_expected_node_key
     OR v_run.current_visit_id IS DISTINCT FROM p_expected_visit_id
     OR p_reprompt_count <> v_run.reprompt_count + 1 THEN
    RETURN;
  END IF;

  v_next_visit_id := uuid_generate_v4();
  INSERT INTO flow_reply_transitions (
    account_id,
    contact_id,
    flow_run_id,
    flow_version_id,
    meta_message_id,
    from_node_key,
    from_visit_id,
    next_node_key,
    next_visit_id,
    transition_kind,
    recovery_state,
    vars_after
  )
  VALUES (
    v_run.account_id,
    v_run.contact_id,
    p_run_id,
    p_flow_version_id,
    p_meta_message_id,
    p_expected_node_key,
    p_expected_visit_id,
    p_expected_node_key,
    v_next_visit_id,
    'reprompt',
    'completed',
    v_run.vars
  );

  UPDATE flow_runs
  SET status = CASE
        WHEN continuation_id IS NOT NULL THEN 'resuming'
        WHEN status = 'needs_recovery' THEN 'active'
        ELSE status
      END,
      reprompt_count = p_reprompt_count,
      current_node_key = p_expected_node_key,
      current_visit_id = v_next_visit_id,
      continuation_step = continuation_step + 1,
      last_advanced_at = NOW()
  WHERE id = p_run_id
  RETURNING * INTO v_run;

  UPDATE flow_node_effects
  SET status = 'completed',
      completed_at = COALESCE(completed_at, NOW()),
      updated_at = NOW()
  WHERE id = p_effect_id
    AND operation_id = p_operation_id
    AND status = 'remote_committed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reprompt effect completion race';
  END IF;

  RETURN NEXT v_run;
END;
$$;

REVOKE ALL ON FUNCTION finalize_flow_reprompt_effect(UUID, UUID, UUID, UUID, TEXT, UUID, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION finalize_flow_reprompt_effect(UUID, UUID, UUID, UUID, TEXT, UUID, INTEGER, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION finalize_flow_reprompt_effect(UUID, UUID, UUID, UUID, TEXT, UUID, INTEGER, TEXT) TO service_role;

-- Exhaustion and non-reprompt decisions consume an inbound exactly once.
-- The receipt, counter and terminal/handoff state share one transaction.
CREATE OR REPLACE FUNCTION finalize_flow_fallback_decision(
  p_run_id UUID,
  p_flow_version_id UUID,
  p_expected_node_key TEXT,
  p_expected_visit_id UUID,
  p_meta_message_id TEXT,
  p_reprompt_count INTEGER,
  p_decision TEXT
)
RETURNS SETOF flow_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run flow_runs%ROWTYPE;
  v_transition flow_reply_transitions%ROWTYPE;
BEGIN
  IF p_reprompt_count < 1
     OR p_decision IS NULL
     OR p_decision NOT IN ('ignore', 'handoff', 'end')
     OR NULLIF(BTRIM(p_meta_message_id), '') IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_run
  FROM flow_runs
  WHERE id = p_run_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_run.flow_version_id IS DISTINCT FROM p_flow_version_id
     OR v_run.contact_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_transition
  FROM flow_reply_transitions transition
  WHERE transition.account_id = v_run.account_id
    AND transition.contact_id = v_run.contact_id
    AND transition.meta_message_id = p_meta_message_id;
  IF FOUND THEN
    IF v_transition.flow_run_id = v_run.id
       AND v_transition.transition_kind = 'fallback_' || p_decision
       AND v_transition.recovery_state = 'completed' THEN
      RETURN NEXT v_run;
    END IF;
    RETURN;
  END IF;

  IF v_run.status NOT IN ('active', 'resuming', 'needs_recovery')
     OR v_run.current_node_key IS DISTINCT FROM p_expected_node_key
     OR v_run.current_visit_id IS DISTINCT FROM p_expected_visit_id
     OR p_reprompt_count <> v_run.reprompt_count + 1 THEN
    RETURN;
  END IF;

  INSERT INTO flow_reply_transitions (
    account_id,
    contact_id,
    flow_run_id,
    flow_version_id,
    meta_message_id,
    from_node_key,
    from_visit_id,
    next_node_key,
    next_visit_id,
    transition_kind,
    recovery_state,
    vars_after
  )
  VALUES (
    v_run.account_id,
    v_run.contact_id,
    v_run.id,
    v_run.flow_version_id,
    p_meta_message_id,
    p_expected_node_key,
    p_expected_visit_id,
    p_expected_node_key,
    p_expected_visit_id,
    'fallback_' || p_decision,
    'completed',
    v_run.vars
  );

  IF p_decision = 'handoff' THEN
    UPDATE conversations
    SET status = 'pending',
        updated_at = NOW()
    WHERE id = v_run.conversation_id;

    UPDATE flow_runs
    SET reprompt_count = p_reprompt_count,
        status = 'handed_off',
        ended_at = NOW(),
        end_reason = 'fallback_exhausted'
    WHERE id = p_run_id
    RETURNING * INTO v_run;
  ELSIF p_decision = 'end' THEN
    UPDATE flow_runs
    SET reprompt_count = p_reprompt_count,
        status = 'completed',
        ended_at = NOW(),
        end_reason = 'fallback_exhausted_end'
    WHERE id = p_run_id
    RETURNING * INTO v_run;
  ELSE
    UPDATE flow_runs
    SET reprompt_count = p_reprompt_count,
        status = CASE
          WHEN continuation_id IS NOT NULL THEN 'resuming'
          WHEN status = 'needs_recovery' THEN 'active'
          ELSE status
        END,
        last_advanced_at = NOW()
    WHERE id = p_run_id
    RETURNING * INTO v_run;
  END IF;

  RETURN NEXT v_run;
END;
$$;

REVOKE ALL ON FUNCTION finalize_flow_fallback_decision(UUID, UUID, TEXT, UUID, TEXT, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION finalize_flow_fallback_decision(UUID, UUID, TEXT, UUID, TEXT, INTEGER, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION finalize_flow_fallback_decision(UUID, UUID, TEXT, UUID, TEXT, INTEGER, TEXT) TO service_role;
