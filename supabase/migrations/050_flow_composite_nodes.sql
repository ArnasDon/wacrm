-- Durable state for bounded composite flow nodes. Forward-only and idempotent.

ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS active_flow_id UUID REFERENCES flows(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS active_flow_version_id UUID REFERENCES flow_versions(id) ON DELETE RESTRICT;

UPDATE flow_runs
SET active_flow_id = flow_id,
    active_flow_version_id = flow_version_id
WHERE active_flow_id IS NULL OR active_flow_version_id IS NULL;

CREATE TABLE IF NOT EXISTS flow_loop_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  flow_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  flow_version_id UUID NOT NULL REFERENCES flow_versions(id) ON DELETE RESTRICT,
  node_key TEXT NOT NULL,
  visit_id UUID NOT NULL,
  loop_kind TEXT NOT NULL CHECK (loop_kind IN ('each', 'loop')),
  items JSONB,
  next_iteration INTEGER NOT NULL DEFAULT 0 CHECK (next_iteration >= 0),
  max_iterations INTEGER NOT NULL CHECK (max_iterations BETWEEN 1 AND 100),
  state_version BIGINT NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flow_run_id, flow_version_id, node_key, visit_id)
);

CREATE INDEX IF NOT EXISTS idx_flow_loop_states_run_active
  ON flow_loop_states(flow_run_id, completed, updated_at);

ALTER TABLE flow_loop_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flow_loop_states_select ON flow_loop_states;
CREATE POLICY flow_loop_states_select ON flow_loop_states FOR SELECT
  USING (is_account_member(account_id, 'viewer'));
REVOKE ALL ON TABLE flow_loop_states FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE flow_loop_states FROM authenticated;
GRANT SELECT ON TABLE flow_loop_states TO authenticated;
GRANT ALL ON TABLE flow_loop_states TO service_role;

CREATE TABLE IF NOT EXISTS flow_call_frames (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  flow_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  depth INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 8),
  parent_flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE RESTRICT,
  parent_flow_version_id UUID NOT NULL REFERENCES flow_versions(id) ON DELETE RESTRICT,
  parent_node_key TEXT NOT NULL,
  parent_visit_id UUID NOT NULL,
  return_node_key TEXT NOT NULL,
  parent_vars JSONB NOT NULL DEFAULT '{}'::JSONB,
  output_mapping JSONB NOT NULL DEFAULT '[]'::JSONB,
  child_flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE RESTRICT,
  child_flow_version_id UUID NOT NULL REFERENCES flow_versions(id) ON DELETE RESTRICT,
  child_entry_node_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'returning', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  completed_child_visit_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flow_run_id, parent_flow_version_id, parent_node_key, parent_visit_id)
);

ALTER TABLE flow_call_frames
  ADD COLUMN IF NOT EXISTS output_mapping JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS completed_child_visit_id UUID;

-- A completed frame frees its stack depth for a later call. Earlier local
-- iterations of this migration used an unconditional UNIQUE constraint.
ALTER TABLE flow_call_frames
  DROP CONSTRAINT IF EXISTS flow_call_frames_flow_run_id_depth_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_flow_call_frames_run_active_depth
  ON flow_call_frames(flow_run_id, depth)
  WHERE state IN ('active', 'returning');

CREATE INDEX IF NOT EXISTS idx_flow_call_frames_run_stack
  ON flow_call_frames(flow_run_id, depth DESC)
  WHERE state IN ('active', 'returning');

ALTER TABLE flow_call_frames ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flow_call_frames_select ON flow_call_frames;
CREATE POLICY flow_call_frames_select ON flow_call_frames FOR SELECT
  USING (is_account_member(account_id, 'viewer'));
REVOKE ALL ON TABLE flow_call_frames FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE flow_call_frames FROM authenticated;
GRANT SELECT ON TABLE flow_call_frames TO authenticated;
GRANT ALL ON TABLE flow_call_frames TO service_role;

CREATE OR REPLACE FUNCTION begin_flow_loop_iteration(
  p_run_id UUID,
  p_flow_version_id UUID,
  p_node_key TEXT,
  p_expected_visit_id UUID,
  p_loop_kind TEXT,
  p_items JSONB,
  p_max_iterations INTEGER
)
RETURNS SETOF flow_loop_states
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run flow_runs%ROWTYPE;
BEGIN
  IF p_loop_kind NOT IN ('each', 'loop')
     OR p_max_iterations NOT BETWEEN 1 AND 100
     OR (p_loop_kind = 'each'
         AND jsonb_typeof(p_items) IS DISTINCT FROM 'array')
     OR (p_loop_kind = 'each' AND jsonb_array_length(p_items) > p_max_iterations)
  THEN
    RETURN;
  END IF;

  SELECT * INTO v_run
  FROM flow_runs
  WHERE id = p_run_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_run.active_flow_version_id IS DISTINCT FROM p_flow_version_id
     OR v_run.current_node_key IS DISTINCT FROM p_node_key
     OR v_run.current_visit_id IS DISTINCT FROM p_expected_visit_id
     OR v_run.status NOT IN ('active', 'resuming', 'needs_recovery')
  THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT state.*
  FROM flow_loop_states state
  WHERE state.flow_run_id = p_run_id
    AND state.flow_version_id = p_flow_version_id
    AND state.node_key = p_node_key
    AND NOT state.completed
  ORDER BY state.created_at DESC
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  INSERT INTO flow_loop_states (
    account_id, flow_run_id, flow_version_id, node_key, visit_id,
    loop_kind, items, max_iterations
  )
  VALUES (
    v_run.account_id, v_run.id, p_flow_version_id, p_node_key,
    p_expected_visit_id, p_loop_kind,
    CASE WHEN p_loop_kind = 'each' THEN p_items ELSE NULL END,
    p_max_iterations
  )
  ON CONFLICT (flow_run_id, flow_version_id, node_key, visit_id) DO NOTHING;

  RETURN QUERY
  SELECT state.*
  FROM flow_loop_states state
  WHERE state.flow_run_id = p_run_id
    AND state.flow_version_id = p_flow_version_id
    AND state.node_key = p_node_key
    AND state.visit_id = p_expected_visit_id;
END;
$$;

REVOKE ALL ON FUNCTION begin_flow_loop_iteration(UUID, UUID, TEXT, UUID, TEXT, JSONB, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION begin_flow_loop_iteration(UUID, UUID, TEXT, UUID, TEXT, JSONB, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION begin_flow_loop_iteration(UUID, UUID, TEXT, UUID, TEXT, JSONB, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION advance_flow_loop_iteration(
  p_run_id UUID,
  p_flow_version_id UUID,
  p_node_key TEXT,
  p_expected_visit_id UUID,
  p_state_id UUID,
  p_expected_state_version BIGINT,
  p_next_iteration INTEGER,
  p_completed BOOLEAN,
  p_next_node_key TEXT,
  p_next_visit_id UUID,
  p_next_vars JSONB
)
RETURNS SETOF flow_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run flow_runs%ROWTYPE;
  v_state flow_loop_states%ROWTYPE;
BEGIN
  SELECT * INTO v_run
  FROM flow_runs
  WHERE id = p_run_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_run.active_flow_version_id IS DISTINCT FROM p_flow_version_id
  THEN
    RETURN;
  END IF;
  IF v_run.current_node_key IS NOT DISTINCT FROM p_next_node_key
     AND v_run.current_visit_id IS NOT DISTINCT FROM p_next_visit_id
  THEN RETURN NEXT v_run; RETURN; END IF;
  IF v_run.current_node_key IS DISTINCT FROM p_node_key
     OR v_run.current_visit_id IS DISTINCT FROM p_expected_visit_id
  THEN RETURN; END IF;

  SELECT * INTO v_state
  FROM flow_loop_states
  WHERE id = p_state_id
    AND flow_run_id = p_run_id
    AND flow_version_id = p_flow_version_id
    AND node_key = p_node_key
  FOR UPDATE;
  IF NOT FOUND
     OR v_state.state_version <> p_expected_state_version
     OR v_state.completed
     OR p_next_iteration < v_state.next_iteration
     OR p_next_iteration > v_state.max_iterations
  THEN
    RETURN;
  END IF;

  UPDATE flow_loop_states
  SET next_iteration = p_next_iteration,
      completed = p_completed,
      state_version = state_version + 1,
      updated_at = NOW()
  WHERE id = v_state.id
    AND state_version = p_expected_state_version;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE flow_runs
  SET current_node_key = p_next_node_key,
      current_visit_id = p_next_visit_id,
      vars = p_next_vars,
      continuation_step = continuation_step + 1,
      last_advanced_at = NOW()
  WHERE id = p_run_id
  RETURNING * INTO v_run;
  RETURN NEXT v_run;
END;
$$;

REVOKE ALL ON FUNCTION advance_flow_loop_iteration(UUID, UUID, TEXT, UUID, UUID, BIGINT, INTEGER, BOOLEAN, TEXT, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION advance_flow_loop_iteration(UUID, UUID, TEXT, UUID, UUID, BIGINT, INTEGER, BOOLEAN, TEXT, UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION advance_flow_loop_iteration(UUID, UUID, TEXT, UUID, UUID, BIGINT, INTEGER, BOOLEAN, TEXT, UUID, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION push_flow_call_frame(
  p_run_id UUID,
  p_parent_flow_version_id UUID,
  p_parent_node_key TEXT,
  p_expected_visit_id UUID,
  p_return_node_key TEXT,
  p_child_flow_id UUID,
  p_child_flow_version_id UUID,
  p_child_entry_node_key TEXT,
  p_child_vars JSONB,
  p_output_mapping JSONB
)
RETURNS SETOF flow_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run flow_runs%ROWTYPE;
  v_depth INTEGER;
BEGIN
  SELECT * INTO v_run
  FROM flow_runs
  WHERE id = p_run_id
  FOR UPDATE;
  IF NOT FOUND
     OR jsonb_typeof(p_child_vars) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_output_mapping) IS DISTINCT FROM 'array'
  THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1 FROM flow_call_frames frame
    WHERE frame.flow_run_id = p_run_id
      AND frame.parent_flow_version_id = p_parent_flow_version_id
      AND frame.parent_node_key = p_parent_node_key
      AND frame.parent_visit_id = p_expected_visit_id
      AND frame.child_flow_id = p_child_flow_id
      AND frame.child_flow_version_id = p_child_flow_version_id
      AND frame.state IN ('active', 'returning')
  ) AND v_run.active_flow_version_id = p_child_flow_version_id
  THEN RETURN NEXT v_run; RETURN; END IF;

  IF v_run.active_flow_version_id IS DISTINCT FROM p_parent_flow_version_id
     OR v_run.current_node_key IS DISTINCT FROM p_parent_node_key
     OR v_run.current_visit_id IS DISTINCT FROM p_expected_visit_id
     OR v_run.status NOT IN ('active', 'resuming', 'needs_recovery')
     OR jsonb_array_length(p_output_mapping) > 50
  THEN RETURN; END IF;

  SELECT COALESCE(MAX(depth), 0) + 1 INTO v_depth
  FROM flow_call_frames
  WHERE flow_run_id = p_run_id AND state IN ('active', 'returning');
  IF v_depth > 8 THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM flow_versions version
    JOIN flows child ON child.id = version.flow_id
    WHERE version.id = p_child_flow_version_id
      AND version.flow_id = p_child_flow_id
      AND version.account_id = v_run.account_id
      AND child.account_id = v_run.account_id
  ) THEN RETURN; END IF;

  INSERT INTO flow_call_frames (
    account_id, flow_run_id, depth,
    parent_flow_id, parent_flow_version_id, parent_node_key, parent_visit_id,
    return_node_key, parent_vars, output_mapping,
    child_flow_id, child_flow_version_id, child_entry_node_key
  )
  VALUES (
    v_run.account_id, p_run_id, v_depth,
    COALESCE(v_run.active_flow_id, v_run.flow_id),
    p_parent_flow_version_id, p_parent_node_key,
    p_expected_visit_id, p_return_node_key, v_run.vars, p_output_mapping,
    p_child_flow_id, p_child_flow_version_id, p_child_entry_node_key
  )
  ON CONFLICT (flow_run_id, parent_flow_version_id, parent_node_key, parent_visit_id)
  DO NOTHING;

  UPDATE flow_runs
  SET active_flow_id = p_child_flow_id,
      active_flow_version_id = p_child_flow_version_id,
      current_node_key = p_child_entry_node_key,
      current_visit_id = uuid_generate_v4(),
      vars = p_child_vars,
      continuation_step = continuation_step + 1,
      last_advanced_at = NOW()
  WHERE id = p_run_id
    AND active_flow_version_id = p_parent_flow_version_id
    AND current_node_key = p_parent_node_key
    AND current_visit_id = p_expected_visit_id
  RETURNING * INTO v_run;
  IF FOUND THEN RETURN NEXT v_run; END IF;
END;
$$;

REVOKE ALL ON FUNCTION push_flow_call_frame(UUID, UUID, TEXT, UUID, TEXT, UUID, UUID, TEXT, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION push_flow_call_frame(UUID, UUID, TEXT, UUID, TEXT, UUID, UUID, TEXT, JSONB, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION push_flow_call_frame(UUID, UUID, TEXT, UUID, TEXT, UUID, UUID, TEXT, JSONB, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION pop_flow_call_frame(
  p_run_id UUID,
  p_child_flow_version_id UUID,
  p_expected_visit_id UUID,
  p_child_vars JSONB
)
RETURNS SETOF flow_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run flow_runs%ROWTYPE;
  v_frame flow_call_frames%ROWTYPE;
  v_parent_vars JSONB;
  v_mapping JSONB;
  v_child_key TEXT;
  v_parent_key TEXT;
BEGIN
  SELECT * INTO v_run FROM flow_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND
     OR jsonb_typeof(p_child_vars) IS DISTINCT FROM 'object'
  THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1 FROM flow_call_frames frame
    WHERE frame.flow_run_id = p_run_id
      AND frame.child_flow_version_id = p_child_flow_version_id
      AND frame.completed_child_visit_id = p_expected_visit_id
      AND frame.state = 'completed'
      AND v_run.active_flow_version_id = frame.parent_flow_version_id
      AND v_run.current_node_key = frame.return_node_key
  ) THEN RETURN NEXT v_run; RETURN; END IF;

  IF v_run.active_flow_version_id IS DISTINCT FROM p_child_flow_version_id
     OR v_run.current_visit_id IS DISTINCT FROM p_expected_visit_id
  THEN RETURN; END IF;

  SELECT * INTO v_frame
  FROM flow_call_frames
  WHERE flow_run_id = p_run_id AND state IN ('active', 'returning')
  ORDER BY depth DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND
     OR v_frame.child_flow_version_id IS DISTINCT FROM p_child_flow_version_id
  THEN RETURN; END IF;

  UPDATE flow_call_frames
  SET state = 'completed',
      completed_child_visit_id = p_expected_visit_id,
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = v_frame.id AND state IN ('active', 'returning');
  IF NOT FOUND THEN RETURN; END IF;

  v_parent_vars := v_frame.parent_vars;
  IF jsonb_typeof(v_frame.output_mapping) <> 'array'
     OR jsonb_array_length(v_frame.output_mapping) > 50
  THEN RAISE EXCEPTION 'invalid_output_mapping'; END IF;
  FOR v_mapping IN SELECT value FROM jsonb_array_elements(v_frame.output_mapping)
  LOOP
    v_child_key := v_mapping->>'child_key';
    v_parent_key := v_mapping->>'parent_key';
    IF v_child_key !~ '^[A-Za-z_][A-Za-z0-9_]*$'
       OR v_parent_key !~ '^[A-Za-z_][A-Za-z0-9_]*$'
    THEN RAISE EXCEPTION 'invalid_output_mapping'; END IF;
    IF p_child_vars ? v_child_key THEN
      v_parent_vars := jsonb_set(
        v_parent_vars,
        ARRAY[v_parent_key],
        p_child_vars->v_child_key,
        TRUE
      );
    END IF;
  END LOOP;

  UPDATE flow_runs
  SET status = CASE
        WHEN continuation_id IS NOT NULL THEN 'resuming'
        ELSE 'active'
      END,
      ended_at = NULL,
      end_reason = NULL,
      active_flow_id = v_frame.parent_flow_id,
      active_flow_version_id = v_frame.parent_flow_version_id,
      current_node_key = v_frame.return_node_key,
      current_visit_id = uuid_generate_v4(),
      vars = v_parent_vars,
      continuation_step = continuation_step + 1,
      last_advanced_at = NOW()
  WHERE id = p_run_id
  RETURNING * INTO v_run;
  RETURN NEXT v_run;
END;
$$;

REVOKE ALL ON FUNCTION pop_flow_call_frame(UUID, UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION pop_flow_call_frame(UUID, UUID, UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION pop_flow_call_frame(UUID, UUID, UUID, JSONB) TO service_role;

-- Wait continuations use the active child version while the immutable
-- flow_runs.flow_version_id continues to identify the root invocation.
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
DECLARE v_run flow_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM flow_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND
     OR COALESCE(v_run.active_flow_version_id, v_run.flow_version_id)
        IS DISTINCT FROM p_flow_version_id
  THEN RAISE EXCEPTION 'flow run is not eligible for wait'; END IF;

  IF v_run.status = 'waiting' THEN
    RETURN QUERY SELECT wait.* FROM flow_waits wait
    WHERE wait.flow_run_id = p_run_id
      AND wait.flow_version_id = p_flow_version_id
      AND wait.node_key = p_node_key
      AND wait.next_node_key = p_next_node_key
      AND wait.status IN ('pending', 'claimed');
    IF FOUND THEN RETURN; END IF;
  END IF;
  IF v_run.status NOT IN ('active', 'resuming', 'needs_recovery')
     OR p_wake_at <= NOW()
     OR NULLIF(BTRIM(p_next_node_key), '') IS NULL
  THEN RAISE EXCEPTION 'invalid flow wait'; END IF;

  INSERT INTO flow_waits (
    flow_run_id, flow_version_id, node_key, next_node_key, wake_at,
    status, claim_token, claimed_at, resumed_at, resume_id, updated_at
  ) VALUES (
    p_run_id, p_flow_version_id, p_node_key, p_next_node_key, p_wake_at,
    'pending', NULL, NULL, NULL, uuid_generate_v4(), NOW()
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

  UPDATE flow_runs SET
    status = 'waiting',
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
  id UUID, flow_run_id UUID, flow_version_id UUID, node_key TEXT,
  next_node_key TEXT, claim_token UUID, resume_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY WITH candidates AS (
    SELECT wait.id FROM flow_waits wait
    JOIN flow_runs run ON run.id = wait.flow_run_id
      AND COALESCE(run.active_flow_version_id, run.flow_version_id)
          = wait.flow_version_id
    WHERE wait.wake_at <= p_now
      AND (
        (wait.status = 'pending' AND run.status = 'waiting'
          AND run.current_node_key = wait.node_key)
        OR (wait.status = 'claimed'
          AND wait.claimed_at < p_now - INTERVAL '5 minutes')
      )
    ORDER BY wait.wake_at, wait.id
    FOR UPDATE OF wait SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
  ), claimed AS (
    UPDATE flow_waits wait SET
      status = 'claimed', claim_token = uuid_generate_v4(),
      claimed_at = p_now, updated_at = p_now
    FROM candidates WHERE wait.id = candidates.id
    RETURNING wait.*
  )
  SELECT claimed.id, claimed.flow_run_id, claimed.flow_version_id,
    claimed.node_key, claimed.next_node_key, claimed.claim_token,
    claimed.resume_id
  FROM claimed;
END;
$$;
REVOKE ALL ON FUNCTION claim_due_flow_waits(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_due_flow_waits(TIMESTAMPTZ, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION claim_due_flow_waits(TIMESTAMPTZ, INTEGER) TO service_role;

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
DECLARE v_wait flow_waits%ROWTYPE; v_run flow_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_wait FROM flow_waits WHERE id = p_wait_id FOR UPDATE;
  IF NOT FOUND OR v_wait.status <> 'claimed'
     OR v_wait.claim_token IS DISTINCT FROM p_claim_token
     OR v_wait.flow_version_id IS DISTINCT FROM p_flow_version_id
  THEN RETURN; END IF;
  SELECT * INTO v_run FROM flow_runs
  WHERE id = v_wait.flow_run_id FOR UPDATE;
  IF NOT FOUND
     OR COALESCE(v_run.active_flow_version_id, v_run.flow_version_id)
        IS DISTINCT FROM p_flow_version_id
  THEN RETURN; END IF;
  IF v_run.continuation_id = v_wait.resume_id THEN
    RETURN NEXT v_run; RETURN;
  END IF;
  RETURN QUERY UPDATE flow_runs SET
    status = 'resuming',
    current_node_key = v_wait.next_node_key,
    current_visit_id = v_wait.resume_id,
    continuation_id = v_wait.resume_id,
    continuation_phase = 'running',
    continuation_step = 0,
    last_advanced_at = NOW()
  WHERE id = v_wait.flow_run_id
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
DECLARE v_wait flow_waits%ROWTYPE;
BEGIN
  SELECT * INTO v_wait FROM flow_waits
  WHERE id = p_wait_id AND status = 'claimed'
    AND claim_token = p_claim_token
    AND flow_version_id = p_flow_version_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  UPDATE flow_runs SET continuation_phase = 'completed',
    last_advanced_at = NOW()
  WHERE id = v_wait.flow_run_id
    AND continuation_id = v_wait.resume_id
    AND continuation_phase IN ('running', 'completed');
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION complete_flow_wait_continuation(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_flow_wait_continuation(UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION complete_flow_wait_continuation(UUID, UUID, UUID) TO service_role;

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
DECLARE v_wait flow_waits%ROWTYPE; v_run flow_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_wait FROM flow_waits WHERE id = p_wait_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  SELECT * INTO v_run FROM flow_runs WHERE id = v_wait.flow_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_wait.status = 'resumed'
     AND v_wait.claim_token = p_claim_token
     AND v_wait.flow_version_id = p_flow_version_id
     AND v_wait.node_key = p_node_key
  THEN RETURN TRUE; END IF;
  IF v_wait.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN v_wait.node_key IS DISTINCT FROM p_node_key
      AND v_wait.status IN ('pending', 'claimed')
      AND v_run.current_node_key IS DISTINCT FROM p_node_key;
  END IF;
  IF v_wait.status <> 'claimed'
     OR v_wait.flow_version_id IS DISTINCT FROM p_flow_version_id
     OR v_wait.node_key IS DISTINCT FROM p_node_key
     OR v_run.continuation_id IS DISTINCT FROM v_wait.resume_id
     OR v_run.continuation_phase <> 'completed'
  THEN RETURN FALSE; END IF;
  UPDATE flow_waits SET status = 'resumed', resumed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_wait_id AND status = 'claimed'
    AND claim_token = p_claim_token;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  UPDATE flow_runs SET status = CASE
      WHEN status IN ('resuming', 'needs_recovery') THEN 'active'
      ELSE status
    END,
    wake_at = NULL,
    continuation_id = NULL, continuation_phase = 'idle',
    continuation_step = 0, last_advanced_at = NOW()
  WHERE id = v_wait.flow_run_id
    AND continuation_id = v_wait.resume_id
    AND continuation_phase = 'completed';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION ack_flow_wait_resume(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION ack_flow_wait_resume(UUID, UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION ack_flow_wait_resume(UUID, UUID, UUID, TEXT) TO service_role;
