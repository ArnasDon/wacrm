-- Isolated, expiring flow debug sessions and node execution records.
-- Forward-only/idempotent. Debug state never references or mutates a
-- production run except for the optional read-only source_run_id provenance.

CREATE TABLE IF NOT EXISTS flow_debug_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  flow_version_id UUID REFERENCES flow_versions(id) ON DELETE RESTRICT,
  draft_revision BIGINT,
  snapshot_hash TEXT NOT NULL CHECK (char_length(snapshot_hash) BETWEEN 16 AND 128),
  graph_snapshot JSONB NOT NULL CHECK (jsonb_typeof(graph_snapshot) = 'object'),
  source_run_id UUID REFERENCES flow_runs(id) ON DELETE SET NULL,
  variables JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(variables) = 'object'),
  node_outputs JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(node_outputs) = 'object'),
  source_node_outputs JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_node_outputs) = 'object'),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed', 'expired')),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_variable_edit_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((flow_version_id IS NOT NULL) <> (draft_revision IS NOT NULL)),
  CHECK (octet_length(graph_snapshot::text) <= 1048576),
  CHECK (octet_length(variables::text) <= 65536),
  CHECK (octet_length(node_outputs::text) <= 262144),
  CHECK (octet_length(source_node_outputs::text) <= 262144)
);

ALTER TABLE flow_debug_sessions
  ADD COLUMN IF NOT EXISTS source_node_outputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_variable_edit_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_debug_sessions_source_outputs_shape'
  ) THEN
    ALTER TABLE flow_debug_sessions
      ADD CONSTRAINT flow_debug_sessions_source_outputs_shape CHECK (
        jsonb_typeof(source_node_outputs) = 'object'
        AND octet_length(source_node_outputs::text) <= 262144
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS flow_debug_node_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES flow_debug_sessions(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL CHECK (char_length(node_key) BETWEEN 1 AND 120),
  node_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'error')),
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(inputs) = 'object'),
  outputs JSONB CHECK (outputs IS NULL OR jsonb_typeof(outputs) IN ('object', 'array', 'string', 'number', 'boolean', 'null')),
  variables JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(variables) = 'object'),
  simulated_effects JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(simulated_effects) = 'array'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0 AND duration_ms <= 60000),
  error JSONB,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (octet_length(inputs::text) <= 65536),
  CHECK (octet_length(COALESCE(outputs, 'null'::jsonb)::text) <= 65536),
  CHECK (octet_length(variables::text) <= 65536),
  CHECK (octet_length(simulated_effects::text) <= 65536),
  CHECK (octet_length(metadata::text) <= 65536),
  CHECK (octet_length(COALESCE(error, 'null'::jsonb)::text) <= 65536),
  UNIQUE (session_id, node_key, attempt)
);

CREATE TABLE IF NOT EXISTS flow_debug_rate_limits (
  session_id UUID NOT NULL REFERENCES flow_debug_sessions(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope = 'flow_debug_execution_rate'),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hit_count INTEGER NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, scope)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_debug_executions_variables_size'
  ) THEN
    ALTER TABLE flow_debug_node_executions
      ADD CONSTRAINT flow_debug_executions_variables_size CHECK (
        jsonb_typeof(variables) = 'object'
        AND octet_length(variables::text) <= 65536
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_debug_executions_metadata_size'
  ) THEN
    ALTER TABLE flow_debug_node_executions
      ADD CONSTRAINT flow_debug_executions_metadata_size CHECK (
        jsonb_typeof(metadata) = 'object'
        AND octet_length(metadata::text) <= 65536
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_debug_executions_error_size'
  ) THEN
    ALTER TABLE flow_debug_node_executions
      ADD CONSTRAINT flow_debug_executions_error_size CHECK (
        octet_length(COALESCE(error, 'null'::jsonb)::text) <= 65536
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_flow_debug_sessions_owner_active
  ON flow_debug_sessions(created_by, flow_id, updated_at DESC)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_flow_debug_sessions_expiry
  ON flow_debug_sessions(expires_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_flow_debug_executions_latest
  ON flow_debug_node_executions(session_id, node_key, created_at DESC);

ALTER TABLE flow_debug_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_debug_node_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_debug_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flow_debug_sessions_select ON flow_debug_sessions;
CREATE POLICY flow_debug_sessions_select ON flow_debug_sessions FOR SELECT
  USING (
    created_by = auth.uid()
    AND is_account_member(account_id)
  );

DROP POLICY IF EXISTS flow_debug_node_executions_select
  ON flow_debug_node_executions;
CREATE POLICY flow_debug_node_executions_select
  ON flow_debug_node_executions FOR SELECT
  USING (
    is_account_member(account_id)
    AND EXISTS (
      SELECT 1
      FROM flow_debug_sessions s
      WHERE s.id = flow_debug_node_executions.session_id
        AND s.created_by = auth.uid()
    )
  );

REVOKE ALL ON TABLE flow_debug_sessions FROM PUBLIC;
REVOKE ALL ON TABLE flow_debug_sessions FROM authenticated;
REVOKE ALL ON TABLE flow_debug_node_executions FROM PUBLIC;
REVOKE ALL ON TABLE flow_debug_node_executions FROM authenticated;
REVOKE ALL ON TABLE flow_debug_rate_limits FROM PUBLIC;
REVOKE ALL ON TABLE flow_debug_rate_limits FROM authenticated;
GRANT ALL ON TABLE flow_debug_sessions TO service_role;
GRANT ALL ON TABLE flow_debug_node_executions TO service_role;
GRANT ALL ON TABLE flow_debug_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION purge_expired_flow_debug_sessions(
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE(expired_count INTEGER, deleted_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired INTEGER := 0;
  v_deleted INTEGER := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'invalid debug purge limit';
  END IF;
  WITH candidates AS (
    SELECT id FROM flow_debug_sessions
    WHERE status = 'active' AND expires_at <= NOW()
    ORDER BY expires_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE flow_debug_sessions s
  SET status = 'expired', updated_at = NOW()
  FROM candidates c
  WHERE s.id = c.id;
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  WITH stale AS (
    SELECT id FROM flow_debug_sessions
    WHERE status IN ('expired', 'closed')
      AND updated_at < NOW() - INTERVAL '1 day'
    ORDER BY updated_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM flow_debug_sessions s
  USING stale
  WHERE s.id = stale.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT v_expired, v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION purge_expired_flow_debug_sessions(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_expired_flow_debug_sessions(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION purge_expired_flow_debug_sessions(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION consume_flow_debug_rate_limit(
  p_session_id UUID,
  p_created_by UUID,
  p_limit INTEGER DEFAULT 30,
  p_window_seconds INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed BOOLEAN;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR p_window_seconds IS NULL OR p_window_seconds < 1
     OR p_window_seconds > 3600 THEN
    RAISE EXCEPTION 'invalid debug rate limit';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM flow_debug_sessions s
    WHERE s.id = p_session_id
      AND s.created_by = p_created_by
      AND s.status = 'active'
      AND s.expires_at > NOW()
  ) THEN
    RAISE EXCEPTION 'debug session not found';
  END IF;

  INSERT INTO flow_debug_rate_limits AS current_limit (
    session_id, scope, window_started_at, hit_count, updated_at
  ) VALUES (
    p_session_id, 'flow_debug_execution_rate', NOW(), 1, NOW()
  )
  ON CONFLICT (session_id, scope) DO UPDATE
  SET hit_count = CASE
        WHEN current_limit.window_started_at
             <= NOW() - make_interval(secs => p_window_seconds)
          THEN 1
        ELSE current_limit.hit_count + 1
      END,
      window_started_at = CASE
        WHEN current_limit.window_started_at
             <= NOW() - make_interval(secs => p_window_seconds)
          THEN NOW()
        ELSE current_limit.window_started_at
      END,
      updated_at = NOW()
  RETURNING hit_count <= p_limit INTO v_allowed;

  RETURN v_allowed;
END;
$$;

REVOKE ALL ON FUNCTION consume_flow_debug_rate_limit(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION consume_flow_debug_rate_limit(UUID, UUID, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION consume_flow_debug_rate_limit(UUID, UUID, INTEGER, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION create_flow_debug_session(
  p_flow_id UUID,
  p_created_by UUID,
  p_graph_snapshot JSONB,
  p_snapshot_hash TEXT,
  p_flow_version_id UUID DEFAULT NULL,
  p_draft_revision BIGINT DEFAULT NULL,
  p_source_run_id UUID DEFAULT NULL,
  p_variables JSONB DEFAULT '{}'::jsonb,
  p_node_outputs JSONB DEFAULT '{}'::jsonb,
  p_source_node_outputs JSONB DEFAULT '{}'::jsonb
)
RETURNS SETOF flow_debug_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flow flows%ROWTYPE;
  v_session flow_debug_sessions%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_created_by::text, 0));
  SELECT * INTO v_flow FROM flows WHERE id = p_flow_id;
  IF NOT FOUND OR v_flow.user_id <> p_created_by THEN
    RAISE EXCEPTION 'flow not found';
  END IF;
  IF (p_flow_version_id IS NOT NULL) = (p_draft_revision IS NOT NULL) THEN
    RAISE EXCEPTION 'debug snapshot must pin exactly one graph revision';
  END IF;
  IF p_draft_revision IS NOT NULL AND p_draft_revision <> v_flow.draft_revision THEN
    RAISE EXCEPTION USING MESSAGE = 'debug_revision_conflict', ERRCODE = '40001';
  END IF;
  IF p_flow_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM flow_versions v
    WHERE v.id = p_flow_version_id AND v.flow_id = p_flow_id
  ) THEN
    RAISE EXCEPTION 'flow version not found';
  END IF;
  IF p_source_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM flow_runs r
    WHERE r.id = p_source_run_id
      AND r.flow_id = p_flow_id
      AND r.account_id = v_flow.account_id
      AND r.flow_version_id = p_flow_version_id
  ) THEN
    RAISE EXCEPTION 'source run not found';
  END IF;
  IF jsonb_typeof(p_graph_snapshot) <> 'object'
     OR jsonb_typeof(COALESCE(p_variables, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_node_outputs, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_source_node_outputs, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'invalid debug session payload';
  END IF;
  IF (
    SELECT COUNT(*) FROM flow_debug_sessions s
    WHERE s.created_by = p_created_by
      AND s.created_at >= NOW() - INTERVAL '1 minute'
  ) >= 10 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'debug_session_rate_limited',
      ERRCODE = '54000';
  END IF;
  UPDATE flow_debug_sessions
  SET status = 'expired', updated_at = NOW()
  WHERE created_by = p_created_by
    AND status = 'active'
    AND expires_at <= NOW();
  IF (
    SELECT COUNT(*) FROM flow_debug_sessions s
    WHERE s.created_by = p_created_by
      AND s.account_id = v_flow.account_id
      AND s.status = 'active'
  ) >= 5 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'debug_session_quota',
      ERRCODE = '54000';
  END IF;

  INSERT INTO flow_debug_sessions (
    account_id, flow_id, flow_version_id, draft_revision, snapshot_hash,
    graph_snapshot, source_run_id, variables, node_outputs,
    source_node_outputs, created_by
  ) VALUES (
    v_flow.account_id, p_flow_id, p_flow_version_id, p_draft_revision,
    p_snapshot_hash, p_graph_snapshot, p_source_run_id,
    p_variables, p_node_outputs, p_source_node_outputs, p_created_by
  )
  RETURNING * INTO v_session;
  RETURN NEXT v_session;
END;
$$;

REVOKE ALL ON FUNCTION create_flow_debug_session(UUID, UUID, JSONB, TEXT, UUID, BIGINT, UUID, JSONB, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_flow_debug_session(UUID, UUID, JSONB, TEXT, UUID, BIGINT, UUID, JSONB, JSONB, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION create_flow_debug_session(UUID, UUID, JSONB, TEXT, UUID, BIGINT, UUID, JSONB, JSONB, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION edit_flow_debug_session_variables(
  p_session_id UUID,
  p_created_by UUID,
  p_expected_revision BIGINT,
  p_variables JSONB
)
RETURNS SETOF flow_debug_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session flow_debug_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session
  FROM flow_debug_sessions
  WHERE id = p_session_id AND created_by = p_created_by
  FOR UPDATE;
  IF NOT FOUND OR v_session.status <> 'active'
     OR v_session.expires_at <= NOW() THEN
    RAISE EXCEPTION 'debug session not found';
  END IF;
  IF p_expected_revision IS NULL OR v_session.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING MESSAGE = 'debug_revision_conflict', ERRCODE = '40001';
  END IF;
  IF jsonb_typeof(p_variables) <> 'object' THEN
    RAISE EXCEPTION 'invalid debug variables';
  END IF;
  IF v_session.last_variable_edit_at IS NOT NULL
     AND v_session.last_variable_edit_at > NOW() - INTERVAL '250 milliseconds' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'debug_edit_rate_limited',
      ERRCODE = '54000';
  END IF;

  UPDATE flow_debug_sessions
  SET variables = p_variables,
      revision = revision + 1,
      last_variable_edit_at = NOW(),
      updated_at = NOW()
  WHERE id = p_session_id
  RETURNING * INTO v_session;
  RETURN NEXT v_session;
END;
$$;

REVOKE ALL ON FUNCTION edit_flow_debug_session_variables(UUID, UUID, BIGINT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION edit_flow_debug_session_variables(UUID, UUID, BIGINT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION edit_flow_debug_session_variables(UUID, UUID, BIGINT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION commit_flow_debug_node_execution(
  p_session_id UUID,
  p_created_by UUID,
  p_expected_revision BIGINT,
  p_node_key TEXT,
  p_node_type TEXT,
  p_status TEXT,
  p_inputs JSONB,
  p_outputs JSONB,
  p_variables JSONB,
  p_simulated_effects JSONB,
  p_metadata JSONB,
  p_duration_ms INTEGER,
  p_error JSONB DEFAULT NULL
)
RETURNS TABLE(session JSONB, execution JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session flow_debug_sessions%ROWTYPE;
  v_execution flow_debug_node_executions%ROWTYPE;
  v_attempt INTEGER;
BEGIN
  SELECT * INTO v_session
  FROM flow_debug_sessions
  WHERE id = p_session_id AND created_by = p_created_by
  FOR UPDATE;
  IF NOT FOUND OR v_session.status <> 'active'
     OR v_session.expires_at <= NOW() THEN
    RAISE EXCEPTION 'debug session not found';
  END IF;
  IF p_expected_revision IS NULL OR v_session.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING MESSAGE = 'debug_revision_conflict', ERRCODE = '40001';
  END IF;
  SELECT COALESCE(MAX(e.attempt), 0) + 1 INTO v_attempt
  FROM flow_debug_node_executions e
  WHERE e.session_id = p_session_id AND e.node_key = p_node_key;

  INSERT INTO flow_debug_node_executions (
    session_id, account_id, flow_id, node_key, node_type, status,
    inputs, outputs, variables, simulated_effects, metadata, duration_ms,
    error, attempt
  ) VALUES (
    v_session.id, v_session.account_id, v_session.flow_id, p_node_key,
    p_node_type, p_status, COALESCE(p_inputs, '{}'::jsonb), p_outputs,
    p_variables, COALESCE(p_simulated_effects, '[]'::jsonb),
    COALESCE(p_metadata, '{}'::jsonb), p_duration_ms, p_error, v_attempt
  )
  RETURNING * INTO v_execution;

  UPDATE flow_debug_sessions
  SET variables = p_variables,
      node_outputs = jsonb_set(
        node_outputs,
        ARRAY[p_node_key],
        COALESCE(p_outputs, 'null'::jsonb),
        true
      ),
      revision = revision + 1,
      updated_at = NOW()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN QUERY SELECT to_jsonb(v_session), to_jsonb(v_execution);
END;
$$;

REVOKE ALL ON FUNCTION commit_flow_debug_node_execution(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, INTEGER, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION commit_flow_debug_node_execution(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, INTEGER, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION commit_flow_debug_node_execution(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, INTEGER, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION close_flow_debug_session(
  p_session_id UUID,
  p_created_by UUID,
  p_expected_revision BIGINT
)
RETURNS SETOF flow_debug_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session flow_debug_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session
  FROM flow_debug_sessions
  WHERE id = p_session_id AND created_by = p_created_by
  FOR UPDATE;
  IF NOT FOUND OR v_session.status <> 'active' THEN
    RAISE EXCEPTION 'debug session not found';
  END IF;
  IF p_expected_revision IS NULL OR v_session.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING MESSAGE = 'debug_revision_conflict', ERRCODE = '40001';
  END IF;
  UPDATE flow_debug_sessions
  SET status = 'closed', revision = revision + 1, updated_at = NOW()
  WHERE id = p_session_id
  RETURNING * INTO v_session;
  RETURN NEXT v_session;
END;
$$;

REVOKE ALL ON FUNCTION close_flow_debug_session(UUID, UUID, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION close_flow_debug_session(UUID, UUID, BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION close_flow_debug_session(UUID, UUID, BIGINT) TO service_role;
