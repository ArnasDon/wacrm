-- Durable entry triggers for immutable flow version graphs.
-- Trigger ingress is accepted into Postgres first; workers then claim rows
-- with leases so manual, webhook and schedule starts do not depend on
-- request-lifetime background work.

CREATE TABLE IF NOT EXISTS public.flow_webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  trigger_node_key TEXT NOT NULL CHECK (char_length(trigger_node_key) BETWEEN 1 AND 200),
  endpoint_key TEXT NOT NULL UNIQUE CHECK (char_length(endpoint_key) BETWEEN 24 AND 120),
  status TEXT NOT NULL DEFAULT 'unprovisioned'
    CHECK (status IN ('unprovisioned', 'active', 'revoked')),
  secret_ciphertext TEXT,
  previous_secret_ciphertext TEXT,
  secret_fingerprint TEXT,
  previous_secret_fingerprint TEXT,
  provisioned_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flow_id, trigger_node_key),
  CHECK (
    status <> 'active'
    OR (secret_ciphertext IS NOT NULL AND secret_fingerprint IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.flow_trigger_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  flow_version_id UUID NOT NULL REFERENCES public.flow_versions(id) ON DELETE RESTRICT,
  trigger_node_key TEXT NOT NULL CHECK (char_length(trigger_node_key) BETWEEN 1 AND 200),
  cron_expr TEXT NOT NULL CHECK (char_length(cron_expr) BETWEEN 9 AND 120),
  timezone TEXT NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 100),
  misfire_policy TEXT NOT NULL DEFAULT 'skip'
    CHECK (misfire_policy IN ('skip', 'fire_once')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'revoked')),
  next_fire_at TIMESTAMPTZ NOT NULL,
  last_scheduled_for TIMESTAMPTZ,
  claim_token UUID,
  claimed_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flow_id, trigger_node_key),
  CHECK (next_fire_at >= created_at - INTERVAL '1 minute')
);

CREATE TABLE IF NOT EXISTS public.flow_trigger_invocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  flow_version_id UUID NOT NULL REFERENCES public.flow_versions(id) ON DELETE RESTRICT,
  trigger_node_key TEXT NOT NULL CHECK (char_length(trigger_node_key) BETWEEN 1 AND 200),
  source TEXT NOT NULL CHECK (source IN ('manual', 'webhook', 'schedule')),
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 240),
  body_hash TEXT CHECK (body_hash IS NULL OR char_length(body_hash) = 64),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'running', 'completed', 'failed')),
  flow_run_id UUID,
  webhook_endpoint_id UUID REFERENCES public.flow_webhook_endpoints(id) ON DELETE SET NULL,
  schedule_id UUID REFERENCES public.flow_trigger_schedules(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ,
  response_mode TEXT NOT NULL DEFAULT 'async' CHECK (response_mode IN ('async', 'sync')),
  response_status INTEGER CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  response_body JSONB,
  error_code TEXT CHECK (error_code IS NULL OR char_length(error_code) <= 120),
  claim_token UUID,
  claimed_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (account_id, source, idempotency_key),
  UNIQUE (schedule_id, scheduled_for),
  CHECK (
    (source = 'schedule' AND schedule_id IS NOT NULL AND scheduled_for IS NOT NULL)
    OR (source <> 'schedule' AND schedule_id IS NULL AND scheduled_for IS NULL)
  )
);

ALTER TABLE public.flow_runs
  ADD COLUMN IF NOT EXISTS trigger_invocation_id UUID
  REFERENCES public.flow_trigger_invocations(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_flow_runs_trigger_invocation
  ON public.flow_runs(trigger_invocation_id)
  WHERE trigger_invocation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_flow_webhook_endpoints_lookup
  ON public.flow_webhook_endpoints(endpoint_key)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_flow_trigger_schedules_due
  ON public.flow_trigger_schedules(next_fire_at, id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_flow_trigger_invocations_claim
  ON public.flow_trigger_invocations(created_at, id)
  WHERE status IN ('pending', 'claimed');
CREATE INDEX IF NOT EXISTS idx_flow_trigger_invocations_account_created
  ON public.flow_trigger_invocations(account_id, created_at DESC);

ALTER TABLE public.flow_webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_trigger_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_trigger_invocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flow_webhook_endpoints_select ON public.flow_webhook_endpoints;
CREATE POLICY flow_webhook_endpoints_select
  ON public.flow_webhook_endpoints FOR SELECT
  USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS flow_trigger_schedules_select ON public.flow_trigger_schedules;
CREATE POLICY flow_trigger_schedules_select
  ON public.flow_trigger_schedules FOR SELECT
  USING (public.is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS flow_trigger_invocations_select ON public.flow_trigger_invocations;
CREATE POLICY flow_trigger_invocations_select
  ON public.flow_trigger_invocations FOR SELECT
  USING (public.is_account_member(account_id, 'viewer'));

REVOKE ALL ON TABLE public.flow_webhook_endpoints FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.flow_trigger_schedules FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.flow_trigger_invocations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.flow_webhook_endpoints TO service_role;
GRANT ALL ON TABLE public.flow_trigger_schedules TO service_role;
GRANT ALL ON TABLE public.flow_trigger_invocations TO service_role;
GRANT SELECT ON TABLE public.flow_trigger_schedules TO authenticated;
GRANT SELECT ON TABLE public.flow_trigger_invocations TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_flow_trigger_invocation(
  p_account_id UUID,
  p_flow_id UUID,
  p_trigger_node_key TEXT,
  p_source TEXT,
  p_idempotency_key TEXT,
  p_body_hash TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb,
  p_variables JSONB DEFAULT '{}'::jsonb,
  p_webhook_endpoint_id UUID DEFAULT NULL,
  p_response_mode TEXT DEFAULT 'async'
)
RETURNS SETOF public.flow_trigger_invocations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_flow public.flows%ROWTYPE;
  v_version public.flow_versions%ROWTYPE;
  v_existing public.flow_trigger_invocations%ROWTYPE;
BEGIN
  IF p_source NOT IN ('manual', 'webhook')
     OR NULLIF(BTRIM(p_idempotency_key), '') IS NULL
     OR char_length(p_idempotency_key) > 240
     OR (p_body_hash IS NOT NULL AND char_length(p_body_hash) <> 64)
     OR p_response_mode NOT IN ('async', 'sync')
  THEN
    RAISE EXCEPTION 'invalid_flow_trigger_invocation';
  END IF;

  SELECT * INTO v_flow
  FROM public.flows
  WHERE id = p_flow_id
    AND account_id = p_account_id
    AND status = 'active'
    AND published_version_id IS NOT NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'flow_trigger_not_found';
  END IF;

  SELECT * INTO v_version
  FROM public.flow_versions
  WHERE id = v_flow.published_version_id
    AND flow_id = v_flow.id
    AND account_id = v_flow.account_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'flow_trigger_version_not_found';
  END IF;

  INSERT INTO public.flow_trigger_invocations (
    account_id, flow_id, flow_version_id, trigger_node_key, source,
    idempotency_key, body_hash, payload, variables, webhook_endpoint_id,
    response_mode
  )
  VALUES (
    p_account_id, p_flow_id, v_version.id, p_trigger_node_key, p_source,
    BTRIM(p_idempotency_key), p_body_hash,
    COALESCE(p_payload, '{}'::jsonb), COALESCE(p_variables, '{}'::jsonb),
    p_webhook_endpoint_id, p_response_mode
  )
  ON CONFLICT (account_id, source, idempotency_key) DO NOTHING
  RETURNING * INTO v_existing;

  IF NOT FOUND THEN
    SELECT * INTO v_existing
    FROM public.flow_trigger_invocations
    WHERE account_id = p_account_id
      AND source = p_source
      AND idempotency_key = BTRIM(p_idempotency_key)
    FOR UPDATE;
    IF NOT FOUND
       OR v_existing.flow_id IS DISTINCT FROM p_flow_id
       OR v_existing.trigger_node_key IS DISTINCT FROM p_trigger_node_key
       OR v_existing.body_hash IS DISTINCT FROM p_body_hash
       OR v_existing.payload IS DISTINCT FROM COALESCE(p_payload, '{}'::jsonb)
       OR v_existing.variables IS DISTINCT FROM COALESCE(p_variables, '{}'::jsonb)
       OR v_existing.response_mode IS DISTINCT FROM p_response_mode
    THEN
      RAISE EXCEPTION 'flow_trigger_idempotency_conflict';
    END IF;
  END IF;

  RETURN NEXT v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_due_flow_trigger_schedules(
  p_now TIMESTAMPTZ DEFAULT NOW(),
  p_limit INTEGER DEFAULT 100
)
RETURNS SETOF public.flow_trigger_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_flow_trigger_schedule_claim_limit';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT schedule.id
    FROM public.flow_trigger_schedules schedule
    WHERE schedule.status = 'active'
      AND schedule.next_fire_at <= p_now
      AND (
        schedule.lease_expires_at IS NULL
        OR schedule.lease_expires_at <= p_now
      )
    ORDER BY schedule.next_fire_at, schedule.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.flow_trigger_schedules schedule
  SET claim_token = uuid_generate_v4(),
      claimed_at = p_now,
      lease_expires_at = p_now + INTERVAL '5 minutes',
      updated_at = NOW()
  FROM due
  WHERE schedule.id = due.id
  RETURNING schedule.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_flow_trigger_schedule_fired(
  p_schedule_id UUID,
  p_claim_token UUID,
  p_scheduled_for TIMESTAMPTZ,
  p_next_fire_at TIMESTAMPTZ,
  p_idempotency_key TEXT
)
RETURNS SETOF public.flow_trigger_invocations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_schedule public.flow_trigger_schedules%ROWTYPE;
  v_invocation public.flow_trigger_invocations%ROWTYPE;
BEGIN
  SELECT * INTO v_schedule
  FROM public.flow_trigger_schedules
  WHERE id = p_schedule_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_schedule.claim_token IS DISTINCT FROM p_claim_token
     OR v_schedule.status <> 'active'
     OR p_scheduled_for < v_schedule.next_fire_at - INTERVAL '24 hours'
     OR p_next_fire_at <= p_scheduled_for
  THEN
    RAISE EXCEPTION 'invalid_flow_trigger_schedule_fire';
  END IF;

  INSERT INTO public.flow_trigger_invocations (
    account_id, flow_id, flow_version_id, trigger_node_key, source,
    idempotency_key, payload, variables, schedule_id, scheduled_for
  )
  VALUES (
    v_schedule.account_id, v_schedule.flow_id, v_schedule.flow_version_id,
    v_schedule.trigger_node_key, 'schedule', BTRIM(p_idempotency_key),
    jsonb_build_object('scheduled_for', p_scheduled_for), '{}'::jsonb,
    v_schedule.id, p_scheduled_for
  )
  ON CONFLICT (schedule_id, scheduled_for) DO UPDATE
  SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING * INTO v_invocation;

  UPDATE public.flow_trigger_schedules
  SET last_scheduled_for = p_scheduled_for,
      next_fire_at = p_next_fire_at,
      claim_token = NULL,
      claimed_at = NULL,
      lease_expires_at = NULL,
      updated_at = NOW()
  WHERE id = v_schedule.id
    AND claim_token = p_claim_token;

  RETURN NEXT v_invocation;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_flow_trigger_invocations(
  p_now TIMESTAMPTZ DEFAULT NOW(),
  p_limit INTEGER DEFAULT 100
)
RETURNS SETOF public.flow_trigger_invocations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_flow_trigger_invocation_claim_limit';
  END IF;

  RETURN QUERY
  WITH claimable AS (
    SELECT invocation.id
    FROM public.flow_trigger_invocations invocation
    WHERE invocation.status IN ('pending', 'claimed')
      AND (
        invocation.lease_expires_at IS NULL
        OR invocation.lease_expires_at <= p_now
      )
    ORDER BY invocation.created_at, invocation.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.flow_trigger_invocations invocation
  SET status = 'claimed',
      claim_token = uuid_generate_v4(),
      claimed_at = p_now,
      lease_expires_at = p_now + INTERVAL '5 minutes'
  FROM claimable
  WHERE invocation.id = claimable.id
  RETURNING invocation.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_flow_trigger_invocation(
  p_invocation_id UUID,
  p_claim_token UUID,
  p_status TEXT,
  p_flow_run_id UUID DEFAULT NULL,
  p_response_status INTEGER DEFAULT NULL,
  p_response_body JSONB DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_invocation public.flow_trigger_invocations%ROWTYPE;
BEGIN
  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'invalid_flow_trigger_completion';
  END IF;

  SELECT * INTO v_invocation
  FROM public.flow_trigger_invocations
  WHERE id = p_invocation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  IF v_invocation.status = p_status
     AND v_invocation.flow_run_id IS NOT DISTINCT FROM p_flow_run_id
  THEN
    RETURN TRUE;
  END IF;
  IF v_invocation.status <> 'claimed'
     OR v_invocation.claim_token IS DISTINCT FROM p_claim_token
  THEN
    RETURN FALSE;
  END IF;

  UPDATE public.flow_trigger_invocations
  SET status = p_status,
      flow_run_id = p_flow_run_id,
      response_status = p_response_status,
      response_body = p_response_body,
      error_code = p_error_code,
      completed_at = NOW(),
      lease_expires_at = NULL
  WHERE id = p_invocation_id
    AND claim_token = p_claim_token;

  IF p_flow_run_id IS NOT NULL THEN
    UPDATE public.flow_runs
    SET trigger_invocation_id = p_invocation_id
    WHERE id = p_flow_run_id
      AND trigger_invocation_id IS NULL;
  END IF;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_flow_trigger_invocation(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_due_flow_trigger_schedules(
  TIMESTAMPTZ, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_flow_trigger_schedule_fired(
  UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_flow_trigger_invocations(
  TIMESTAMPTZ, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_flow_trigger_invocation(
  UUID, UUID, TEXT, UUID, INTEGER, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.accept_flow_trigger_invocation(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, UUID, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_flow_trigger_schedules(
  TIMESTAMPTZ, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_flow_trigger_schedule_fired(
  UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_flow_trigger_invocations(
  TIMESTAMPTZ, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_flow_trigger_invocation(
  UUID, UUID, TEXT, UUID, INTEGER, JSONB, TEXT
) TO service_role;
