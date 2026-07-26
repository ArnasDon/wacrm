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
    'completed',
    'handed_off',
    'timed_out',
    'paused_by_agent',
    'failed'
  ));
ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS wake_at TIMESTAMPTZ;

DROP INDEX IF EXISTS idx_one_active_run_per_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_contact
  ON flow_runs(account_id, contact_id)
  WHERE status IN ('active', 'waiting', 'resuming');

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
  claimed_at TIMESTAMPTZ,
  resumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flow_run_id)
);

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

  IF v_run.status NOT IN ('active', 'resuming') THEN
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
      updated_at = NOW();

  UPDATE flow_runs
  SET status = 'waiting',
      current_node_key = p_node_key,
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
  claim_token UUID
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
    claimed.claim_token
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

  -- A continuation that already moved past the wait is returned as-is so a
  -- replacement worker can acknowledge it without replaying side effects.
  IF v_run.flow_version_id = p_flow_version_id
    AND (
      v_run.current_node_key IS DISTINCT FROM v_wait.node_key
      OR v_run.status IN ('completed', 'handed_off', 'timed_out', 'failed')
    ) THEN
    RETURN NEXT v_run;
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE flow_runs
  SET status = 'resuming',
      last_advanced_at = NOW()
  WHERE id = v_wait.flow_run_id
    AND flow_version_id = p_flow_version_id
    AND status IN ('waiting', 'resuming')
    AND current_node_key = v_wait.node_key
  RETURNING flow_runs.*;
END;
$$;

REVOKE ALL ON FUNCTION prepare_flow_wait_resume(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION prepare_flow_wait_resume(UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION prepare_flow_wait_resume(UUID, UUID, UUID) TO service_role;

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
     OR v_run.current_node_key IS NOT DISTINCT FROM p_node_key THEN
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
  SET status = 'active',
      wake_at = NULL,
      last_advanced_at = NOW()
  WHERE id = v_wait.flow_run_id
    AND status = 'resuming';

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION ack_flow_wait_resume(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION ack_flow_wait_resume(UUID, UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION ack_flow_wait_resume(UUID, UUID, UUID, TEXT) TO service_role;
