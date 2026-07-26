-- Bound observability payloads without rewriting legacy execution tables.
-- CHECK constraints are installed NOT VALID: PostgreSQL enforces them for
-- new writes immediately without scanning historical rows during deploy.
--
-- Validate during a maintenance window after an operational legacy cleanup:
--   ALTER TABLE public.flow_node_executions
--     VALIDATE CONSTRAINT flow_node_executions_inputs_size;
--   ALTER TABLE public.flow_debug_node_executions
--     VALIDATE CONSTRAINT flow_debug_executions_inputs_bounded;
-- Repeat validation for the remaining named constraints after monitoring the
-- legacy cleanup batches. Detail RPCs below replace oversized legacy values
-- with explicit sentinels before they cross the database boundary.

ALTER TABLE public.flow_node_executions
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'flow_node_executions_inputs_size'
      AND conrelid = 'public.flow_node_executions'::regclass
  ) THEN
    ALTER TABLE public.flow_node_executions
      ADD CONSTRAINT flow_node_executions_inputs_size CHECK (
        pg_catalog.octet_length(inputs::text) <= 61440
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'flow_node_executions_outputs_size'
      AND conrelid = 'public.flow_node_executions'::regclass
  ) THEN
    ALTER TABLE public.flow_node_executions
      ADD CONSTRAINT flow_node_executions_outputs_size CHECK (
        pg_catalog.octet_length(
          COALESCE(outputs, 'null'::jsonb)::text
        ) <= 61440
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'flow_node_executions_error_size'
      AND conrelid = 'public.flow_node_executions'::regclass
  ) THEN
    ALTER TABLE public.flow_node_executions
      ADD CONSTRAINT flow_node_executions_error_size CHECK (
        pg_catalog.octet_length(
          COALESCE(error, 'null'::jsonb)::text
        ) <= 61440
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'flow_node_executions_metadata_size'
      AND conrelid = 'public.flow_node_executions'::regclass
  ) THEN
    ALTER TABLE public.flow_node_executions
      ADD CONSTRAINT flow_node_executions_metadata_size CHECK (
        pg_catalog.jsonb_typeof(metadata) = 'object'
        AND pg_catalog.octet_length(metadata::text) <= 61440
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'flow_node_executions_debug_result_size'
      AND conrelid = 'public.flow_node_executions'::regclass
  ) THEN
    ALTER TABLE public.flow_node_executions
      ADD CONSTRAINT flow_node_executions_debug_result_size CHECK (
        pg_catalog.octet_length(pg_catalog.jsonb_build_object(
          'inputs', inputs,
          'outputs', outputs,
          'error', error,
          'metadata', metadata
        )::text) <= 262144
      ) NOT VALID;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'flow_debug_executions_inputs_bounded'
      AND conrelid = 'public.flow_debug_node_executions'::regclass
  ) THEN
    ALTER TABLE public.flow_debug_node_executions
      ADD CONSTRAINT flow_debug_executions_inputs_bounded CHECK (
        pg_catalog.octet_length(inputs::text) <= 32768
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'flow_debug_executions_outputs_bounded'
      AND conrelid = 'public.flow_debug_node_executions'::regclass
  ) THEN
    ALTER TABLE public.flow_debug_node_executions
      ADD CONSTRAINT flow_debug_executions_outputs_bounded CHECK (
        pg_catalog.octet_length(
          COALESCE(outputs, 'null'::jsonb)::text
        ) <= 32768
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'flow_debug_executions_simulated_effects_bounded'
      AND conrelid = 'public.flow_debug_node_executions'::regclass
  ) THEN
    ALTER TABLE public.flow_debug_node_executions
      ADD CONSTRAINT flow_debug_executions_simulated_effects_bounded CHECK (
        pg_catalog.jsonb_typeof(simulated_effects) = 'array'
        AND pg_catalog.octet_length(simulated_effects::text) <= 32768
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'flow_debug_executions_metadata_bounded'
      AND conrelid = 'public.flow_debug_node_executions'::regclass
  ) THEN
    ALTER TABLE public.flow_debug_node_executions
      ADD CONSTRAINT flow_debug_executions_metadata_bounded CHECK (
        pg_catalog.jsonb_typeof(metadata) = 'object'
        AND pg_catalog.octet_length(metadata::text) <= 32768
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'flow_debug_executions_error_bounded'
      AND conrelid = 'public.flow_debug_node_executions'::regclass
  ) THEN
    ALTER TABLE public.flow_debug_node_executions
      ADD CONSTRAINT flow_debug_executions_error_bounded CHECK (
        pg_catalog.octet_length(
          COALESCE(error, 'null'::jsonb)::text
        ) <= 32768
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'flow_debug_executions_result_json_bounded'
      AND conrelid = 'public.flow_debug_node_executions'::regclass
  ) THEN
    ALTER TABLE public.flow_debug_node_executions
      ADD CONSTRAINT flow_debug_executions_result_json_bounded CHECK (
        pg_catalog.octet_length(pg_catalog.jsonb_build_object(
          'inputs', inputs,
          'outputs', outputs,
          'variables', variables,
          'simulated_effects', simulated_effects,
          'metadata', metadata,
          'error', error
        )::text) <= 262144
      ) NOT VALID;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION read_flow_debug_source_snapshot(
  p_flow_id UUID,
  p_run_id UUID,
  p_created_by UUID,
  p_max_nodes INTEGER DEFAULT 100,
  p_max_field_bytes INTEGER DEFAULT 32768,
  p_max_total_bytes INTEGER DEFAULT 262144
)
RETURNS TABLE(
  variables_json JSONB,
  variables_truncated BOOLEAN,
  source_node_outputs JSONB,
  outputs_truncated BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_vars JSONB;
  v_variables_json JSONB;
  v_variables_truncated BOOLEAN;
  v_outputs JSONB;
  v_outputs_truncated BOOLEAN;
  v_node_count INTEGER;
  v_variables_bytes INTEGER;
  v_outputs_bytes INTEGER;
BEGIN
  IF p_max_nodes IS NULL OR p_max_nodes < 1 OR p_max_nodes > 100
     OR p_max_field_bytes IS NULL
     OR p_max_field_bytes < 1024
     OR p_max_field_bytes > 32768
     OR p_max_total_bytes IS NULL
     OR p_max_total_bytes < 16384
     OR p_max_total_bytes > 262144 THEN
    RAISE EXCEPTION 'invalid source snapshot bounds';
  END IF;

  SELECT COALESCE(r.vars, '{}'::jsonb)
  INTO v_vars
  FROM public.flow_runs r
  JOIN public.flows f ON f.id = r.flow_id
  WHERE r.id = p_run_id
    AND r.flow_id = p_flow_id
    AND r.account_id = f.account_id
    AND f.user_id = p_created_by;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_variables_bytes := pg_catalog.octet_length(v_vars::text);
  v_variables_truncated := v_variables_bytes > 65536;
  v_variables_json := CASE
    WHEN v_variables_truncated THEN pg_catalog.jsonb_build_object(
      'truncated', true,
      'reason', 'source_variables_exceeded_limit',
      'original_bytes', v_variables_bytes
    )
    ELSE v_vars
  END;

  WITH latest AS (
    SELECT DISTINCT ON (e.node_key)
      e.node_key,
      e.outputs
    FROM public.flow_node_executions e
    WHERE e.flow_run_id = p_run_id
    ORDER BY e.node_key, e.started_at DESC, e.id DESC
  ),
  limited AS (
    SELECT node_key, outputs
    FROM latest
    ORDER BY node_key
    LIMIT p_max_nodes
  ),
  safe AS (
    SELECT
      node_key,
      CASE
        WHEN pg_catalog.octet_length(
          COALESCE(outputs, 'null'::jsonb)::text
        ) > p_max_field_bytes
        THEN pg_catalog.jsonb_build_object(
          'truncated', true,
          'reason', 'legacy_payload_exceeded_limit',
          'original_bytes', pg_catalog.octet_length(
            COALESCE(outputs, 'null'::jsonb)::text
          )
        )
        ELSE COALESCE(outputs, 'null'::jsonb)
      END AS safe_output
    FROM limited
  )
  SELECT
    COALESCE(
      pg_catalog.jsonb_object_agg(node_key, safe_output),
      '{}'::jsonb
    ),
    (SELECT pg_catalog.count(*)::integer FROM latest)
  INTO v_outputs, v_node_count
  FROM safe;

  v_outputs_bytes := pg_catalog.octet_length(v_outputs::text);
  v_outputs_truncated :=
    v_node_count > p_max_nodes OR v_outputs_bytes > p_max_total_bytes;
  IF v_outputs_bytes > p_max_total_bytes THEN
    v_outputs := pg_catalog.jsonb_build_object(
      '_truncated',
      pg_catalog.jsonb_build_object(
        'truncated', true,
        'reason', 'source_clone_budget_exceeded',
        'original_bytes', v_outputs_bytes
      )
    );
  END IF;

  RETURN QUERY
  SELECT
    v_variables_json,
    v_variables_truncated,
    v_outputs,
    v_outputs_truncated;
END;
$$;

REVOKE ALL ON FUNCTION read_flow_debug_source_snapshot(
  UUID, UUID, UUID, INTEGER, INTEGER, INTEGER
) FROM PUBLIC;
REVOKE ALL ON FUNCTION read_flow_debug_source_snapshot(
  UUID, UUID, UUID, INTEGER, INTEGER, INTEGER
) FROM authenticated;
GRANT EXECUTE ON FUNCTION read_flow_debug_source_snapshot(
  UUID, UUID, UUID, INTEGER, INTEGER, INTEGER
) TO service_role;

CREATE OR REPLACE FUNCTION read_flow_debug_execution_detail(
  p_flow_id UUID,
  p_session_id UUID,
  p_execution_id UUID,
  p_created_by UUID,
  p_max_field_bytes INTEGER DEFAULT 32768
)
RETURNS TABLE(execution_json JSONB)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'id', e.id,
    'node_key', e.node_key,
    'node_type', e.node_type,
    'status', e.status,
    'attempt', e.attempt,
    'duration_ms', e.duration_ms,
    'created_at', e.created_at,
    'inputs', CASE
      WHEN pg_catalog.octet_length(e.inputs::text) > p_max_field_bytes
      THEN pg_catalog.jsonb_build_object(
        'truncated', true,
        'reason', 'legacy_payload_exceeded_limit',
        'original_bytes', pg_catalog.octet_length(e.inputs::text)
      )
      ELSE e.inputs
    END,
    'outputs', CASE
      WHEN pg_catalog.octet_length(
        COALESCE(e.outputs, 'null'::jsonb)::text
      ) > p_max_field_bytes
      THEN pg_catalog.jsonb_build_object(
        'truncated', true,
        'reason', 'legacy_payload_exceeded_limit',
        'original_bytes', pg_catalog.octet_length(
          COALESCE(e.outputs, 'null'::jsonb)::text
        )
      )
      ELSE e.outputs
    END,
    'error', CASE
      WHEN pg_catalog.octet_length(
        COALESCE(e.error, 'null'::jsonb)::text
      ) > p_max_field_bytes
      THEN pg_catalog.jsonb_build_object(
        'truncated', true,
        'reason', 'legacy_payload_exceeded_limit',
        'original_bytes', pg_catalog.octet_length(
          COALESCE(e.error, 'null'::jsonb)::text
        )
      )
      ELSE e.error
    END,
    'simulated_effects', CASE
      WHEN pg_catalog.octet_length(e.simulated_effects::text)
        > p_max_field_bytes
      THEN pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'truncated', true,
        'reason', 'legacy_payload_exceeded_limit',
        'original_bytes',
        pg_catalog.octet_length(e.simulated_effects::text)
      ))
      ELSE e.simulated_effects
    END,
    'metadata', CASE
      WHEN pg_catalog.octet_length(e.metadata::text) > p_max_field_bytes
      THEN pg_catalog.jsonb_build_object(
        'truncated', true,
        'reason', 'legacy_payload_exceeded_limit',
        'original_bytes', pg_catalog.octet_length(e.metadata::text)
      )
      ELSE e.metadata
    END
  )
  FROM public.flow_debug_node_executions e
  JOIN public.flow_debug_sessions s ON s.id = e.session_id
  WHERE e.id = p_execution_id
    AND e.session_id = p_session_id
    AND e.flow_id = p_flow_id
    AND s.id = p_session_id
    AND s.flow_id = p_flow_id
    AND s.created_by = p_created_by
    AND s.status = 'active'
    AND s.expires_at > pg_catalog.now()
    AND p_max_field_bytes BETWEEN 1024 AND 32768;
$$;

REVOKE ALL ON FUNCTION read_flow_debug_execution_detail(
  UUID, UUID, UUID, UUID, INTEGER
) FROM PUBLIC;
REVOKE ALL ON FUNCTION read_flow_debug_execution_detail(
  UUID, UUID, UUID, UUID, INTEGER
) FROM authenticated;
GRANT EXECUTE ON FUNCTION read_flow_debug_execution_detail(
  UUID, UUID, UUID, UUID, INTEGER
) TO service_role;

CREATE OR REPLACE FUNCTION read_flow_production_execution_detail(
  p_flow_id UUID,
  p_execution_id UUID,
  p_created_by UUID,
  p_max_field_bytes INTEGER DEFAULT 61440
)
RETURNS TABLE(execution_json JSONB)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'id', e.id,
    'flow_run_id', e.flow_run_id,
    'flow_version_id', e.flow_version_id,
    'node_key', e.node_key,
    'node_type', e.node_type,
    'status', e.status,
    'duration_ms', e.duration_ms,
    'attempt', e.attempt,
    'started_at', e.started_at,
    'completed_at', e.completed_at,
    'inputs', CASE
      WHEN pg_catalog.octet_length(e.inputs::text) > p_max_field_bytes
      THEN pg_catalog.jsonb_build_object(
        'truncated', true,
        'reason', 'legacy_payload_exceeded_limit',
        'original_bytes', pg_catalog.octet_length(e.inputs::text)
      )
      ELSE e.inputs
    END,
    'outputs', CASE
      WHEN pg_catalog.octet_length(
        COALESCE(e.outputs, 'null'::jsonb)::text
      ) > p_max_field_bytes
      THEN pg_catalog.jsonb_build_object(
        'truncated', true,
        'reason', 'legacy_payload_exceeded_limit',
        'original_bytes', pg_catalog.octet_length(
          COALESCE(e.outputs, 'null'::jsonb)::text
        )
      )
      ELSE e.outputs
    END,
    'error', CASE
      WHEN pg_catalog.octet_length(
        COALESCE(e.error, 'null'::jsonb)::text
      ) > p_max_field_bytes
      THEN pg_catalog.jsonb_build_object(
        'truncated', true,
        'reason', 'legacy_payload_exceeded_limit',
        'original_bytes', pg_catalog.octet_length(
          COALESCE(e.error, 'null'::jsonb)::text
        )
      )
      ELSE e.error
    END,
    'metadata', CASE
      WHEN pg_catalog.octet_length(e.metadata::text) > p_max_field_bytes
      THEN pg_catalog.jsonb_build_object(
        'truncated', true,
        'reason', 'legacy_payload_exceeded_limit',
        'original_bytes', pg_catalog.octet_length(e.metadata::text)
      )
      ELSE e.metadata
    END
  )
  FROM public.flow_node_executions e
  JOIN public.flow_runs r ON e.flow_run_id = r.id
  JOIN public.flows f ON f.id = r.flow_id
  WHERE e.id = p_execution_id
    AND r.flow_id = p_flow_id
    AND f.id = p_flow_id
    AND f.user_id = p_created_by
    AND r.account_id = f.account_id
    AND p_max_field_bytes BETWEEN 1024 AND 61440;
$$;

REVOKE ALL ON FUNCTION read_flow_production_execution_detail(
  UUID, UUID, UUID, INTEGER
) FROM PUBLIC;
REVOKE ALL ON FUNCTION read_flow_production_execution_detail(
  UUID, UUID, UUID, INTEGER
) FROM authenticated;
GRANT EXECUTE ON FUNCTION read_flow_production_execution_detail(
  UUID, UUID, UUID, INTEGER
) TO service_role;
