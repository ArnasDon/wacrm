-- First-class, per-attempt observability for the flow runtime.
-- Forward-only and idempotent. Runtime writes are intentionally best-effort:
-- an unavailable observability table must never repeat or fail business work.

CREATE TABLE IF NOT EXISTS flow_node_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  flow_version_id UUID NOT NULL REFERENCES flow_versions(id) ON DELETE RESTRICT,
  node_key TEXT NOT NULL,
  node_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'submitted', 'executing', 'completed', 'error'
  )),
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  outputs JSONB,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  error JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flow_node_executions_run_started
  ON flow_node_executions(flow_run_id, started_at, attempt);
CREATE INDEX IF NOT EXISTS idx_flow_node_executions_version_node
  ON flow_node_executions(flow_version_id, node_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_node_executions_errors
  ON flow_node_executions(flow_run_id, completed_at DESC)
  WHERE status = 'error';

ALTER TABLE flow_node_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flow_node_executions_select ON flow_node_executions;
CREATE POLICY flow_node_executions_select
  ON flow_node_executions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM flow_runs r
      WHERE r.id = flow_node_executions.flow_run_id
        AND is_account_member(r.account_id)
    )
  );
