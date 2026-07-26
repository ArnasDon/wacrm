-- Immutable flow publication snapshots and run version pinning.
-- Forward-only and idempotent: existing active flows receive version 1.

CREATE TABLE IF NOT EXISTS flow_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  graph JSONB NOT NULL CHECK (jsonb_typeof(graph) = 'object'),
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  label TEXT CHECK (label IS NULL OR char_length(label) <= 120),
  UNIQUE (flow_id, version),
  UNIQUE (flow_id, id)
);

CREATE INDEX IF NOT EXISTS idx_flow_versions_flow_newest
  ON flow_versions(flow_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_flow_versions_account
  ON flow_versions(account_id);

ALTER TABLE flow_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flow_versions_select ON flow_versions;
CREATE POLICY flow_versions_select ON flow_versions FOR SELECT
  USING (is_account_member(account_id));
-- Historical rows are immutable to authenticated clients. Publication and
-- restore are exposed only through service-role RPCs below.

ALTER TABLE flows
  ADD COLUMN IF NOT EXISTS published_version_id UUID;
ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS flow_version_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flows_published_version_id_fkey'
  ) THEN
    ALTER TABLE flows
      ADD CONSTRAINT flows_published_version_id_fkey
      FOREIGN KEY (published_version_id)
      REFERENCES flow_versions(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flows_published_version_belongs_to_flow'
  ) THEN
    ALTER TABLE flows
      ADD CONSTRAINT flows_published_version_belongs_to_flow
      FOREIGN KEY (id, published_version_id)
      REFERENCES flow_versions(flow_id, id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_runs_flow_version_id_fkey'
  ) THEN
    ALTER TABLE flow_runs
      ADD CONSTRAINT flow_runs_flow_version_id_fkey
      FOREIGN KEY (flow_version_id)
      REFERENCES flow_versions(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_runs_version_belongs_to_flow'
  ) THEN
    ALTER TABLE flow_runs
      ADD CONSTRAINT flow_runs_version_belongs_to_flow
      FOREIGN KEY (flow_id, flow_version_id)
      REFERENCES flow_versions(flow_id, id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_flow_runs_version
  ON flow_runs(flow_version_id);

CREATE OR REPLACE FUNCTION publish_flow_version(
  p_flow_id UUID,
  p_graph JSONB,
  p_published_by UUID,
  p_label TEXT DEFAULT NULL
)
RETURNS SETOF flow_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flow flows%ROWTYPE;
  v_version INTEGER;
  v_snapshot flow_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_flow
  FROM flows
  WHERE id = p_flow_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'flow not found';
  END IF;
  IF jsonb_typeof(p_graph) <> 'object'
     OR p_graph->>'schema_version' <> '1' THEN
    RAISE EXCEPTION 'invalid flow version graph';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
  FROM flow_versions
  WHERE flow_id = p_flow_id;

  INSERT INTO flow_versions (
    flow_id, account_id, version, graph, published_by, label
  ) VALUES (
    p_flow_id, v_flow.account_id, v_version, p_graph, p_published_by,
    NULLIF(btrim(p_label), '')
  )
  RETURNING * INTO v_snapshot;

  UPDATE flows
  SET published_version_id = v_snapshot.id,
      status = 'active',
      updated_at = NOW()
  WHERE id = p_flow_id;

  RETURN NEXT v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION publish_flow_version(UUID, JSONB, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION publish_flow_version(UUID, JSONB, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION publish_flow_version(UUID, JSONB, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION restore_flow_version(
  p_flow_id UUID,
  p_flow_version_id UUID
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

  SELECT graph INTO v_graph
  FROM flow_versions
  WHERE id = p_flow_version_id
    AND flow_id = p_flow_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'flow version not found';
  END IF;
  IF v_graph->>'schema_version' <> '1' THEN
    RAISE EXCEPTION 'invalid flow version graph';
  END IF;

  UPDATE flows
  SET trigger_type = v_graph #>> '{trigger,type}',
      trigger_config = v_graph #> '{trigger,config}',
      entry_node_id = v_graph->>'entry_node_key',
      fallback_policy = v_graph->'fallback_policy',
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

REVOKE ALL ON FUNCTION restore_flow_version(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION restore_flow_version(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION restore_flow_version(UUID, UUID) TO service_role;

-- Backfill one immutable snapshot for every legacy active flow that has no
-- pointer yet. ON CONFLICT and the pointer predicate make reruns converge.
INSERT INTO flow_versions (
  flow_id, account_id, version, graph, published_at, published_by, label
)
SELECT
  f.id,
  f.account_id,
  1,
  jsonb_build_object(
    'schema_version', 1,
    'trigger', jsonb_build_object(
      'type', f.trigger_type,
      'config', f.trigger_config
    ),
    'entry_node_key', f.entry_node_id,
    'fallback_policy', f.fallback_policy,
    'nodes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'node_key', n.node_key,
        'node_type', n.node_type,
        'config', n.config,
        'position_x', n.position_x,
        'position_y', n.position_y
      ) ORDER BY n.created_at, n.node_key)
      FROM flow_nodes n
      WHERE n.flow_id = f.id
    ), '[]'::jsonb)
  ),
  COALESCE(f.updated_at, NOW()),
  f.user_id,
  'Legacy active flow'
FROM flows f
WHERE f.status = 'active'
  AND f.published_version_id IS NULL
  AND f.entry_node_id IS NOT NULL
ON CONFLICT (flow_id, version) DO NOTHING;

UPDATE flows f
SET published_version_id = v.id
FROM flow_versions v
WHERE f.status = 'active'
  AND f.published_version_id IS NULL
  AND v.flow_id = f.id
  AND v.version = (
    SELECT MIN(v2.version) FROM flow_versions v2 WHERE v2.flow_id = f.id
  );

UPDATE flow_runs r
SET flow_version_id = f.published_version_id
FROM flows f
WHERE r.flow_id = f.id
  AND r.flow_version_id IS NULL
  AND f.published_version_id IS NOT NULL;
