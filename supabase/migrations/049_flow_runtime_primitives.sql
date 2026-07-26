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
