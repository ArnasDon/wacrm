-- Atomic, service-only commit boundary for native flow-code imports.
-- Parsing, resource resolution and secret binding happen in the application;
-- this RPC accepts only the already-compiled draft envelope and runtime nodes.

CREATE OR REPLACE FUNCTION public.import_flow_draft(
  p_actor_id UUID,
  p_account_id UUID,
  p_flow_id UUID,
  p_expected_revision BIGINT,
  p_name TEXT,
  p_description TEXT,
  p_trigger_type TEXT,
  p_trigger_config JSONB,
  p_entry_node_id TEXT,
  p_fallback_policy JSONB,
  p_variable_schema JSONB,
  p_nodes JSONB
)
RETURNS SETOF public.flows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_flow public.flows%ROWTYPE;
  v_runtime_node_types CONSTANT TEXT[] := ARRAY[
    'start',
    'send_message',
    'send_buttons',
    'send_list',
    'send_media',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'end',
    'wait',
    'http_request',
    'switch',
    'variable_set',
    'each',
    'loop',
    'sub_flow',
    'ai_reply',
    'approval'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.user_id = p_actor_id
      AND profile.account_id = p_account_id
      AND profile.account_role IN ('agent', 'admin', 'owner')
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'import_actor_forbidden',
      ERRCODE = '42501';
  END IF;

  IF NULLIF(pg_catalog.btrim(p_name), '') IS NULL
     OR pg_catalog.length(p_name) > 200
     OR p_trigger_type NOT IN ('keyword', 'first_inbound_message', 'manual')
     OR pg_catalog.jsonb_typeof(p_trigger_config) <> 'object'
     OR pg_catalog.jsonb_typeof(p_fallback_policy) <> 'object'
     OR pg_catalog.jsonb_typeof(p_variable_schema) <> 'array'
     OR pg_catalog.jsonb_typeof(p_nodes) <> 'array'
     OR pg_catalog.jsonb_array_length(p_nodes) > 500 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'import_payload_invalid',
      ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_nodes) AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
       OR NULLIF(item.value->>'node_key', '') IS NULL
       OR NULLIF(item.value->>'node_type', '') IS NULL
       OR pg_catalog.jsonb_typeof(item.value->'config') <> 'object'
       OR NOT ((item.value->>'node_type') = ANY(v_runtime_node_types))
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'import_node_invalid',
      ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_nodes) AS item(value)
    GROUP BY item.value->>'node_key'
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'import_duplicate_node_key',
      ERRCODE = '22023';
  END IF;

  -- Secret placeholders may not cross the persistence boundary.
  IF p_nodes::TEXT LIKE '%"$secret"%' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'import_secret_unbound',
      ERRCODE = '22023';
  END IF;

  IF p_flow_id IS NULL THEN
    INSERT INTO public.flows (
      account_id,
      user_id,
      name,
      description,
      status,
      trigger_type,
      trigger_config,
      entry_node_id,
      fallback_policy,
      variable_schema,
      draft_revision
    ) VALUES (
      p_account_id,
      p_actor_id,
      pg_catalog.btrim(p_name),
      p_description,
      'draft',
      p_trigger_type,
      p_trigger_config,
      p_entry_node_id,
      p_fallback_policy,
      p_variable_schema,
      0
    )
    RETURNING * INTO v_flow;
  ELSE
    SELECT *
    INTO v_flow
    FROM public.flows
    WHERE id = p_flow_id
      AND account_id = p_account_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        MESSAGE = 'import_flow_not_found',
        ERRCODE = 'P0002';
    END IF;
    IF p_expected_revision IS NULL
       OR v_flow.draft_revision <> p_expected_revision THEN
      RAISE EXCEPTION USING
        MESSAGE = 'draft_revision_conflict',
        ERRCODE = '40001';
    END IF;

    UPDATE public.flows
    SET name = pg_catalog.btrim(p_name),
        description = p_description,
        trigger_type = p_trigger_type,
        trigger_config = p_trigger_config,
        entry_node_id = p_entry_node_id,
        fallback_policy = p_fallback_policy,
        variable_schema = p_variable_schema,
        draft_revision = v_flow.draft_revision + 1,
        updated_at = pg_catalog.now()
    WHERE id = p_flow_id
    RETURNING * INTO v_flow;

    DELETE FROM public.flow_nodes
    WHERE flow_id = p_flow_id;
  END IF;

  INSERT INTO public.flow_nodes (
    flow_id,
    node_key,
    node_type,
    config,
    position_x,
    position_y
  )
  SELECT
    v_flow.id,
    node.node_key,
    node.node_type,
    node.config,
    COALESCE(node.position_x, 0),
    COALESCE(node.position_y, 0)
  FROM pg_catalog.jsonb_to_recordset(p_nodes) AS node(
    node_key TEXT,
    node_type TEXT,
    config JSONB,
    position_x INTEGER,
    position_y INTEGER
  );

  IF p_entry_node_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.flow_nodes
       WHERE flow_id = v_flow.id
         AND node_key = p_entry_node_id
     ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'import_entry_node_missing',
      ERRCODE = '22023';
  END IF;

  RETURN NEXT v_flow;
END;
$$;

REVOKE ALL ON FUNCTION public.import_flow_draft(
  UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT, JSONB, JSONB, JSONB
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_flow_draft(
  UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT, JSONB, JSONB, JSONB
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.import_flow_draft(
  UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT, JSONB, JSONB, JSONB
) TO service_role;
