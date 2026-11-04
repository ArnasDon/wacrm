ALTER TABLE flow_runs
  DROP CONSTRAINT IF EXISTS flow_runs_status_check;

ALTER TABLE flow_runs
  ADD CONSTRAINT flow_runs_status_check
  CHECK (status IN (
    'active', 'completed', 'handed_off', 'timed_out',
    'paused_by_agent', 'cancelled', 'failed'
  ));

ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS transition_seq INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.replace_flow_nodes(
  p_flow_id UUID,
  p_nodes JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_cancelled INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_nodes IS NULL OR jsonb_typeof(p_nodes) <> 'array' THEN
    RAISE EXCEPTION 'p_nodes must be a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
  FROM flows
  WHERE id = p_flow_id
  FOR UPDATE;

  IF v_account_id IS NULL OR NOT is_account_member(v_account_id, 'agent') THEN
    RAISE EXCEPTION 'Flow not found' USING ERRCODE = '42501';
  END IF;

  DELETE FROM flow_nodes WHERE flow_id = p_flow_id;

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y)
  SELECT
    p_flow_id,
    n->>'node_key',
    n->>'node_type',
    COALESCE(n->'config', '{}'::jsonb),
    COALESCE((n->>'position_x')::INTEGER, 0),
    COALESCE((n->>'position_y')::INTEGER, 0)
  FROM jsonb_array_elements(p_nodes) AS n;

  UPDATE flow_runs r
  SET status = 'cancelled',
      ended_at = NOW(),
      end_reason = 'current_node_removed'
  WHERE r.flow_id = p_flow_id
    AND r.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM flow_nodes fn
      WHERE fn.flow_id = p_flow_id
        AND fn.node_key = r.current_node_key
    );
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  RETURN v_cancelled;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_flow_nodes(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_flow_nodes(UUID, JSONB) TO authenticated, service_role;
