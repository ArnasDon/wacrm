-- Bound observability payloads before debug APIs can materialize or return
-- them. Legacy oversized values are replaced with explicit sentinels before
-- the constraints are installed. Forward-only and idempotent.

ALTER TABLE flow_node_executions
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE flow_node_executions
SET inputs = jsonb_build_object(
  'truncated', true,
  'reason', 'legacy_payload_exceeded_limit',
  'original_bytes', octet_length(inputs::text)
)
WHERE octet_length(inputs::text) > 61440;

UPDATE flow_node_executions
SET outputs = jsonb_build_object(
  'truncated', true,
  'reason', 'legacy_payload_exceeded_limit',
  'original_bytes', octet_length(outputs::text)
)
WHERE outputs IS NOT NULL AND octet_length(outputs::text) > 61440;

UPDATE flow_node_executions
SET error = jsonb_build_object(
  'truncated', true,
  'reason', 'legacy_payload_exceeded_limit',
  'original_bytes', octet_length(error::text)
)
WHERE error IS NOT NULL AND octet_length(error::text) > 61440;

UPDATE flow_node_executions
SET metadata = jsonb_build_object(
  'truncated', true,
  'reason', 'legacy_payload_exceeded_limit',
  'original_bytes', octet_length(metadata::text)
)
WHERE octet_length(metadata::text) > 61440;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_node_executions_inputs_size'
  ) THEN
    ALTER TABLE flow_node_executions
      ADD CONSTRAINT flow_node_executions_inputs_size CHECK (
        octet_length(inputs::text) <= 61440
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_node_executions_outputs_size'
  ) THEN
    ALTER TABLE flow_node_executions
      ADD CONSTRAINT flow_node_executions_outputs_size CHECK (
        octet_length(COALESCE(outputs, 'null'::jsonb)::text) <= 61440
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_node_executions_error_size'
  ) THEN
    ALTER TABLE flow_node_executions
      ADD CONSTRAINT flow_node_executions_error_size CHECK (
        octet_length(COALESCE(error, 'null'::jsonb)::text) <= 61440
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_node_executions_metadata_size'
  ) THEN
    ALTER TABLE flow_node_executions
      ADD CONSTRAINT flow_node_executions_metadata_size CHECK (
        jsonb_typeof(metadata) = 'object'
        AND octet_length(metadata::text) <= 61440
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_node_executions_debug_result_size'
  ) THEN
    ALTER TABLE flow_node_executions
      ADD CONSTRAINT flow_node_executions_debug_result_size CHECK (
        octet_length(jsonb_build_object(
          'inputs', inputs,
          'outputs', outputs,
          'error', error,
          'metadata', metadata
        )::text) <= 262144
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION read_flow_debug_source_variables(
  p_flow_id UUID,
  p_run_id UUID,
  p_max_bytes INTEGER DEFAULT 65536
)
RETURNS TABLE(
  result_json JSONB,
  truncated BOOLEAN,
  original_bytes INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vars JSONB;
  v_bytes INTEGER;
BEGIN
  IF p_max_bytes IS NULL OR p_max_bytes < 1024 OR p_max_bytes > 65536 THEN
    RAISE EXCEPTION 'invalid source variable byte limit';
  END IF;
  SELECT r.vars
  INTO v_vars
  FROM flow_runs r
  WHERE r.id = p_run_id
    AND r.flow_id = p_flow_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_bytes := octet_length(v_vars::text);
  IF v_bytes > p_max_bytes THEN
    RETURN QUERY SELECT
      jsonb_build_object(
        'truncated', true,
        'reason', 'source_variables_exceeded_limit',
        'original_bytes', v_bytes
      ),
      true,
      v_bytes;
  ELSE
    RETURN QUERY SELECT v_vars, false, v_bytes;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION read_flow_debug_source_variables(UUID, UUID, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION read_flow_debug_source_variables(UUID, UUID, INTEGER)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION read_flow_debug_source_variables(UUID, UUID, INTEGER)
  TO service_role;

UPDATE flow_debug_node_executions
SET inputs = jsonb_build_object(
  'truncated', true,
  'reason', 'legacy_payload_exceeded_limit',
  'original_bytes', octet_length(inputs::text)
)
WHERE octet_length(inputs::text) > 32768;

UPDATE flow_debug_node_executions
SET outputs = jsonb_build_object(
  'truncated', true,
  'reason', 'legacy_payload_exceeded_limit',
  'original_bytes', octet_length(outputs::text)
)
WHERE outputs IS NOT NULL AND octet_length(outputs::text) > 32768;

UPDATE flow_debug_node_executions
SET simulated_effects = jsonb_build_array(jsonb_build_object(
  'truncated', true,
  'reason', 'legacy_payload_exceeded_limit',
  'original_bytes', octet_length(simulated_effects::text)
))
WHERE octet_length(simulated_effects::text) > 32768;

UPDATE flow_debug_node_executions
SET metadata = jsonb_build_object(
  'truncated', true,
  'reason', 'legacy_payload_exceeded_limit',
  'original_bytes', octet_length(metadata::text)
)
WHERE octet_length(metadata::text) > 32768;

UPDATE flow_debug_node_executions
SET error = jsonb_build_object(
  'truncated', true,
  'reason', 'legacy_payload_exceeded_limit',
  'original_bytes', octet_length(error::text)
)
WHERE error IS NOT NULL AND octet_length(error::text) > 32768;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_debug_executions_inputs_bounded'
  ) THEN
    ALTER TABLE flow_debug_node_executions
      ADD CONSTRAINT flow_debug_executions_inputs_bounded CHECK (
        octet_length(inputs::text) <= 32768
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_debug_executions_outputs_bounded'
  ) THEN
    ALTER TABLE flow_debug_node_executions
      ADD CONSTRAINT flow_debug_executions_outputs_bounded CHECK (
        octet_length(COALESCE(outputs, 'null'::jsonb)::text) <= 32768
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_debug_executions_simulated_effects_bounded'
  ) THEN
    ALTER TABLE flow_debug_node_executions
      ADD CONSTRAINT flow_debug_executions_simulated_effects_bounded CHECK (
        jsonb_typeof(simulated_effects) = 'array'
        AND octet_length(simulated_effects::text) <= 32768
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_debug_executions_metadata_bounded'
  ) THEN
    ALTER TABLE flow_debug_node_executions
      ADD CONSTRAINT flow_debug_executions_metadata_bounded CHECK (
        jsonb_typeof(metadata) = 'object'
        AND octet_length(metadata::text) <= 32768
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_debug_executions_error_bounded'
  ) THEN
    ALTER TABLE flow_debug_node_executions
      ADD CONSTRAINT flow_debug_executions_error_bounded CHECK (
        octet_length(COALESCE(error, 'null'::jsonb)::text) <= 32768
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_debug_executions_result_json_bounded'
  ) THEN
    ALTER TABLE flow_debug_node_executions
      ADD CONSTRAINT flow_debug_executions_result_json_bounded CHECK (
        octet_length(jsonb_build_object(
          'inputs', inputs,
          'outputs', outputs,
          'variables', variables,
          'simulated_effects', simulated_effects,
          'metadata', metadata,
          'error', error
        )::text) <= 262144
      );
  END IF;
END $$;
