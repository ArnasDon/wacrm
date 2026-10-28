ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS delivery_lease_until TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.replace_flow_graph(
  p_flow_id UUID,
  p_nodes JSONB,
  p_flow JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cancelled INTEGER;
BEGIN
  IF p_flow IS NULL OR jsonb_typeof(p_flow) <> 'object' THEN
    RAISE EXCEPTION 'p_flow must be a JSON object' USING ERRCODE = '22023';
  END IF;

  v_cancelled := replace_flow_nodes(p_flow_id, p_nodes);

  UPDATE flows
  SET name = CASE WHEN p_flow ? 'name' THEN p_flow->>'name' ELSE name END,
      description = CASE WHEN p_flow ? 'description' THEN p_flow->>'description' ELSE description END,
      trigger_type = CASE WHEN p_flow ? 'trigger_type' THEN p_flow->>'trigger_type' ELSE trigger_type END,
      trigger_config = CASE WHEN p_flow ? 'trigger_config' THEN p_flow->'trigger_config' ELSE trigger_config END,
      entry_node_id = CASE WHEN p_flow ? 'entry_node_id' THEN p_flow->>'entry_node_id' ELSE entry_node_id END,
      fallback_policy = CASE WHEN p_flow ? 'fallback_policy' THEN p_flow->'fallback_policy' ELSE fallback_policy END,
      updated_at = NOW()
  WHERE id = p_flow_id;

  RETURN v_cancelled;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_flow_graph(UUID, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_flow_graph(UUID, JSONB, JSONB) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_timed_out_flow_runs(
  p_now TIMESTAMPTZ,
  p_limit INTEGER
) RETURNS TABLE (
  id UUID,
  last_advanced_at TIMESTAMPTZ,
  fallback_policy JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.last_advanced_at, f.fallback_policy
  FROM flow_runs r
  LEFT JOIN flows f ON f.id = r.flow_id
  WHERE r.status = 'active'
    AND r.last_advanced_at <= p_now - make_interval(secs => 3600 * (
      CASE
        WHEN jsonb_typeof(f.fallback_policy->'on_timeout_hours') = 'number'
          AND (f.fallback_policy->>'on_timeout_hours')::NUMERIC > 0
        THEN LEAST((f.fallback_policy->>'on_timeout_hours')::NUMERIC, 87600)
        ELSE 24
      END
    )::DOUBLE PRECISION)
  ORDER BY r.last_advanced_at, r.id
  LIMIT GREATEST(p_limit, 0);
$$;

REVOKE ALL ON FUNCTION public.list_timed_out_flow_runs(TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_timed_out_flow_runs(TIMESTAMPTZ, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.acquire_broadcast_delivery_lease(
  p_broadcast_id UUID
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease TIMESTAMPTZ;
BEGIN
  UPDATE broadcasts b
  SET delivery_lease_until = now() + INTERVAL '5 minutes'
  WHERE b.id = p_broadcast_id
    AND is_account_member(b.account_id, 'agent')
    AND (b.delivery_lease_until IS NULL OR b.delivery_lease_until < now())
    AND (b.delivery_locked_at IS NULL OR b.delivery_locked_at < now() - INTERVAL '30 minutes')
  RETURNING b.delivery_lease_until INTO v_lease;
  RETURN v_lease;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_broadcast_delivery_lease(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acquire_broadcast_delivery_lease(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.renew_broadcast_delivery_lease(
  p_broadcast_id UUID,
  p_held TIMESTAMPTZ
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease TIMESTAMPTZ;
BEGIN
  UPDATE broadcasts b
  SET delivery_lease_until = now() + INTERVAL '5 minutes'
  WHERE b.id = p_broadcast_id
    AND is_account_member(b.account_id, 'agent')
    AND b.delivery_lease_until = p_held
  RETURNING b.delivery_lease_until INTO v_lease;
  RETURN v_lease;
END;
$$;

REVOKE ALL ON FUNCTION public.renew_broadcast_delivery_lease(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_broadcast_delivery_lease(UUID, TIMESTAMPTZ) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.broadcast_delivery_in_flight(
  p_broadcast_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT b.delivery_locked_at > now() - INTERVAL '30 minutes'
      OR b.delivery_lease_until > now()
    FROM broadcasts b
    WHERE b.id = p_broadcast_id
  ), FALSE)
$$;

REVOKE ALL ON FUNCTION public.broadcast_delivery_in_flight(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.broadcast_delivery_in_flight(UUID) TO authenticated, service_role;
