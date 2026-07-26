-- Exact, retry-aware production funnel facts for immutable flow versions.
-- Existing attempts intentionally keep a NULL visit_id: there is no safe way
-- to infer loop boundaries or retry ownership from historical timestamps.

ALTER TABLE public.flow_node_executions ADD COLUMN IF NOT EXISTS visit_id UUID;

CREATE INDEX IF NOT EXISTS idx_flow_node_executions_visit
  ON public.flow_node_executions(flow_run_id, flow_version_id, visit_id)
  WHERE visit_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.flow_node_visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  flow_run_id UUID NOT NULL REFERENCES public.flow_runs(id) ON DELETE CASCADE,
  flow_version_id UUID NOT NULL
    REFERENCES public.flow_versions(id) ON DELETE RESTRICT,
  visit_id UUID NOT NULL,
  node_key TEXT NOT NULL CHECK (char_length(node_key) BETWEEN 1 AND 200),
  node_type TEXT NOT NULL CHECK (char_length(node_type) BETWEEN 1 AND 100),
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  outcome TEXT CHECK (outcome IN (
    'advanced', 'completed', 'handed_off', 'failed', 'timed_out',
    'paused_by_agent'
  )),
  next_flow_version_id UUID REFERENCES public.flow_versions(id)
    ON DELETE RESTRICT,
  next_node_key TEXT CHECK (
    next_node_key IS NULL OR char_length(next_node_key) BETWEEN 1 AND 200
  ),
  next_visit_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flow_run_id, flow_version_id, visit_id),
  CHECK (
    (resolved_at IS NULL AND outcome IS NULL)
    OR (resolved_at IS NOT NULL AND outcome IS NOT NULL)
  ),
  CHECK (
    outcome = 'advanced'
    OR (
      next_flow_version_id IS NULL
      AND next_node_key IS NULL
      AND next_visit_id IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_flow_node_visits_version_entered
  ON public.flow_node_visits(flow_version_id, entered_at, node_key);
CREATE INDEX IF NOT EXISTS idx_flow_node_visits_run_entered
  ON public.flow_node_visits(flow_run_id, entered_at);
CREATE INDEX IF NOT EXISTS idx_flow_node_visits_open
  ON public.flow_node_visits(flow_run_id, flow_version_id, visit_id)
  WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS public.flow_analytics_coverage (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.flow_analytics_coverage(singleton)
VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.flow_node_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flow_node_visits_select ON public.flow_node_visits;
CREATE POLICY flow_node_visits_select
  ON public.flow_node_visits FOR SELECT
  USING (public.is_account_member(account_id, 'viewer'));

REVOKE ALL ON TABLE public.flow_node_visits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.flow_node_visits TO authenticated;
GRANT ALL ON TABLE public.flow_node_visits TO service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.flow_node_executions
  FROM authenticated;
GRANT ALL ON TABLE public.flow_node_executions TO service_role;
REVOKE ALL ON TABLE public.flow_analytics_coverage
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.flow_analytics_coverage TO service_role;

CREATE OR REPLACE FUNCTION public.flow_version_node_type(
  p_flow_version_id UUID,
  p_node_key TEXT
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT node->>'node_type'
  FROM public.flow_versions version,
       LATERAL pg_catalog.jsonb_array_elements(version.graph->'nodes') node
  WHERE version.id = p_flow_version_id
    AND node->>'node_key' = p_node_key
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.flow_version_node_type(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flow_version_node_type(UUID, TEXT)
  TO service_role;

-- Scheduling a durable wait suspends the current visit. The visit only
-- advances when prepare_flow_wait_resume commits the next cursor.
CREATE OR REPLACE FUNCTION public.schedule_flow_wait(
  p_run_id UUID,
  p_flow_version_id UUID,
  p_node_key TEXT,
  p_next_node_key TEXT,
  p_wake_at TIMESTAMPTZ
)
RETURNS SETOF public.flow_waits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_run public.flow_runs%ROWTYPE;
  v_updated INTEGER;
BEGIN
  SELECT *
  INTO v_run
  FROM public.flow_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND
     OR COALESCE(v_run.active_flow_version_id, v_run.flow_version_id)
        IS DISTINCT FROM p_flow_version_id
  THEN
    RAISE EXCEPTION 'flow run is not eligible for wait';
  END IF;

  IF v_run.status = 'waiting' THEN
    RETURN QUERY
    SELECT wait.*
    FROM public.flow_waits wait
    WHERE wait.flow_run_id = p_run_id
      AND wait.flow_version_id = p_flow_version_id
      AND wait.node_key = p_node_key
      AND wait.next_node_key = p_next_node_key
      AND wait.status IN ('pending', 'claimed');
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  IF v_run.status NOT IN ('active', 'resuming', 'needs_recovery')
     OR v_run.current_node_key IS DISTINCT FROM p_node_key
     OR v_run.current_visit_id IS NULL
     OR p_wake_at <= NOW()
     OR NULLIF(BTRIM(p_next_node_key), '') IS NULL
  THEN
    RAISE EXCEPTION 'invalid flow wait';
  END IF;

  INSERT INTO public.flow_waits (
    flow_run_id, flow_version_id, node_key, next_node_key, wake_at,
    status, claim_token, claimed_at, resumed_at, resume_id, updated_at
  ) VALUES (
    p_run_id, p_flow_version_id, p_node_key, p_next_node_key, p_wake_at,
    'pending', NULL, NULL, NULL, public.uuid_generate_v4(), NOW()
  )
  ON CONFLICT (flow_run_id) DO UPDATE
  SET flow_version_id = EXCLUDED.flow_version_id,
      node_key = EXCLUDED.node_key,
      next_node_key = EXCLUDED.next_node_key,
      wake_at = EXCLUDED.wake_at,
      status = 'pending',
      claim_token = NULL,
      claimed_at = NULL,
      resumed_at = NULL,
      resume_id = public.uuid_generate_v4(),
      updated_at = NOW();

  UPDATE public.flow_runs
  SET status = 'waiting',
      current_node_key = p_node_key,
      continuation_id = NULL,
      continuation_phase = 'idle',
      continuation_step = 0,
      wake_at = p_wake_at,
      last_advanced_at = NOW()
  WHERE id = p_run_id
    AND COALESCE(active_flow_version_id, flow_version_id)
        = p_flow_version_id
    AND current_node_key = p_node_key
    AND current_visit_id = v_run.current_visit_id
    AND status IN ('active', 'resuming', 'needs_recovery');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'flow wait cursor changed while scheduling';
  END IF;

  RETURN QUERY
  SELECT wait.*
  FROM public.flow_waits wait
  WHERE wait.flow_run_id = p_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_flow_wait(
  UUID, UUID, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_flow_wait(
  UUID, UUID, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

CREATE OR REPLACE FUNCTION public.record_flow_node_visit_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_old_version UUID;
  v_new_version UUID;
  v_old_flow UUID;
  v_new_flow UUID;
  v_node_type TEXT;
  v_cursor_changed BOOLEAN;
  v_entering_child BOOLEAN := FALSE;
  v_frame public.flow_call_frames%ROWTYPE;
  v_outcome TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.current_node_key IS NULL OR NEW.current_visit_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_new_version := COALESCE(NEW.active_flow_version_id, NEW.flow_version_id);
    v_new_flow := COALESCE(NEW.active_flow_id, NEW.flow_id);
    v_node_type := public.flow_version_node_type(
      v_new_version, NEW.current_node_key
    );
    IF v_node_type IS NULL THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.flow_node_visits (
      account_id, flow_id, flow_run_id, flow_version_id, visit_id,
      node_key, node_type, entered_at
    ) VALUES (
      NEW.account_id, v_new_flow, NEW.id, v_new_version,
      NEW.current_visit_id, NEW.current_node_key, v_node_type,
      COALESCE(NEW.started_at, NOW())
    )
    ON CONFLICT (flow_run_id, flow_version_id, visit_id) DO NOTHING;
    RETURN NEW;
  END IF;

  v_old_version := COALESCE(OLD.active_flow_version_id, OLD.flow_version_id);
  v_new_version := COALESCE(NEW.active_flow_version_id, NEW.flow_version_id);
  v_old_flow := COALESCE(OLD.active_flow_id, OLD.flow_id);
  v_new_flow := COALESCE(NEW.active_flow_id, NEW.flow_id);
  v_cursor_changed :=
    OLD.current_visit_id IS DISTINCT FROM NEW.current_visit_id
    OR OLD.current_node_key IS DISTINCT FROM NEW.current_node_key
    OR v_old_version IS DISTINCT FROM v_new_version;

  -- Durable waits and approval requests own the same visit until a resume
  -- transaction commits a different cursor.
  IF NOT v_cursor_changed AND NEW.status = 'waiting' THEN
    RETURN NEW;
  END IF;
  IF NOT v_cursor_changed
     AND NEW.status = 'paused_by_agent'
     AND EXISTS (
       SELECT 1
       FROM public.flow_approval_requests request
       WHERE request.flow_run_id = NEW.id
         AND request.flow_version_id = v_new_version
         AND request.node_key = NEW.current_node_key
         AND request.visit_id = NEW.current_visit_id
         AND request.status IN (
           'pending', 'resolved', 'resuming', 'completed'
         )
     )
  THEN
    RETURN NEW;
  END IF;

  IF v_cursor_changed THEN
    -- Entering a child graph does not finish its parent sub-flow visit.
    SELECT EXISTS (
      SELECT 1
      FROM public.flow_call_frames frame
      WHERE frame.flow_run_id = NEW.id
        AND frame.parent_flow_version_id = v_old_version
        AND frame.parent_node_key = OLD.current_node_key
        AND frame.parent_visit_id = OLD.current_visit_id
        AND frame.child_flow_version_id = v_new_version
        AND frame.state IN ('active', 'returning')
    ) INTO v_entering_child;

    SELECT frame.* INTO v_frame
    FROM public.flow_call_frames frame
    WHERE frame.flow_run_id = NEW.id
      AND frame.child_flow_version_id = v_old_version
      AND frame.parent_flow_version_id = v_new_version
      AND frame.completed_child_visit_id = OLD.current_visit_id
      AND frame.state IN ('completed', 'failed')
    ORDER BY frame.depth DESC
    LIMIT 1;

    IF NOT v_entering_child
       AND OLD.current_visit_id IS NOT NULL
       AND OLD.current_node_key IS NOT NULL
    THEN
      v_outcome := CASE
        WHEN v_frame.id IS NOT NULL AND v_frame.state = 'completed'
          THEN 'completed'
        WHEN v_frame.id IS NOT NULL AND v_frame.state = 'failed'
          THEN 'failed'
        WHEN NEW.status IN (
          'completed', 'handed_off', 'failed', 'timed_out', 'paused_by_agent'
        ) THEN NEW.status
        ELSE 'advanced'
      END;
      UPDATE public.flow_node_visits
      SET resolved_at = COALESCE(resolved_at, NOW()),
          outcome = COALESCE(outcome, v_outcome),
          next_flow_version_id = CASE
            WHEN v_outcome = 'advanced' THEN v_new_version ELSE NULL
          END,
          next_node_key = CASE
            WHEN v_outcome = 'advanced' THEN NEW.current_node_key ELSE NULL
          END,
          next_visit_id = CASE
            WHEN v_outcome = 'advanced' THEN NEW.current_visit_id ELSE NULL
          END
      WHERE flow_run_id = OLD.id
        AND flow_version_id = v_old_version
        AND visit_id = OLD.current_visit_id
        AND resolved_at IS NULL;
    END IF;

    -- Returning or failing a child is the durable completion boundary for
    -- the parent sub-flow visit that remained open while the child ran.
    IF v_frame.id IS NOT NULL THEN
      v_outcome := CASE
        WHEN v_frame.state = 'failed' AND NEW.status = 'failed' THEN 'failed'
        ELSE 'advanced'
      END;
      UPDATE public.flow_node_visits
      SET resolved_at = COALESCE(resolved_at, NOW()),
          outcome = COALESCE(outcome, v_outcome),
          next_flow_version_id = CASE
            WHEN v_outcome = 'advanced' THEN v_new_version ELSE NULL
          END,
          next_node_key = CASE
            WHEN v_outcome = 'advanced' THEN NEW.current_node_key ELSE NULL
          END,
          next_visit_id = CASE
            WHEN v_outcome = 'advanced' THEN NEW.current_visit_id ELSE NULL
          END
      WHERE flow_run_id = NEW.id
        AND flow_version_id = v_frame.parent_flow_version_id
        AND visit_id = v_frame.parent_visit_id
        AND resolved_at IS NULL;
    END IF;

    IF NEW.current_visit_id IS NOT NULL
       AND NEW.current_node_key IS NOT NULL
       AND NEW.status NOT IN (
         'completed', 'handed_off', 'failed', 'timed_out'
       )
    THEN
      v_node_type := public.flow_version_node_type(
        v_new_version, NEW.current_node_key
      );
      IF v_node_type IS NOT NULL THEN
        INSERT INTO public.flow_node_visits (
          account_id, flow_id, flow_run_id, flow_version_id, visit_id,
          node_key, node_type, entered_at
        ) VALUES (
          NEW.account_id, v_new_flow, NEW.id, v_new_version,
          NEW.current_visit_id, NEW.current_node_key, v_node_type, NOW()
        )
        ON CONFLICT (flow_run_id, flow_version_id, visit_id) DO NOTHING;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IN (
    'completed', 'handed_off', 'failed', 'timed_out', 'paused_by_agent'
  )
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.current_visit_id IS NOT NULL
  THEN
    UPDATE public.flow_node_visits
    SET resolved_at = COALESCE(resolved_at, NOW()),
        outcome = COALESCE(outcome, NEW.status),
        next_flow_version_id = NULL,
        next_node_key = NULL,
        next_visit_id = NULL
    WHERE flow_run_id = NEW.id
      AND flow_version_id = v_new_version
      AND visit_id = NEW.current_visit_id
      AND resolved_at IS NULL;

    IF NEW.status IN ('handed_off', 'timed_out', 'paused_by_agent') THEN
      UPDATE public.flow_node_visits visit
      SET resolved_at = COALESCE(visit.resolved_at, NOW()),
          outcome = COALESCE(visit.outcome, NEW.status),
          next_flow_version_id = NULL,
          next_node_key = NULL,
          next_visit_id = NULL
      FROM public.flow_call_frames frame
      WHERE frame.flow_run_id = NEW.id
        AND frame.state IN ('active', 'returning')
        AND visit.flow_run_id = NEW.id
        AND visit.flow_version_id = frame.parent_flow_version_id
        AND visit.visit_id = frame.parent_visit_id
        AND visit.resolved_at IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_flow_node_visit_transition()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_flow_node_visit_transition()
  TO service_role;

DROP TRIGGER IF EXISTS record_flow_node_visit_transition
  ON public.flow_runs;
CREATE TRIGGER record_flow_node_visit_transition
AFTER INSERT OR UPDATE ON public.flow_runs
FOR EACH ROW EXECUTE FUNCTION public.record_flow_node_visit_transition();

CREATE OR REPLACE FUNCTION public.get_flow_node_analytics(
  p_flow_id UUID,
  p_version_id UUID DEFAULT NULL,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_flow public.flows%ROWTYPE;
  v_version public.flow_versions%ROWTYPE;
  v_from TIMESTAMPTZ := COALESCE(p_from, NOW() - INTERVAL '30 days');
  v_to TIMESTAMPTZ := COALESCE(p_to, NOW());
  v_coverage_started_at TIMESTAMPTZ;
  v_legacy_attempts_excluded BIGINT;
  v_available_versions JSONB;
  v_nodes JSONB;
  v_biggest JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'analytics_unauthorized';
  END IF;
  IF v_to <= v_from OR v_to - v_from > INTERVAL '366 days' THEN
    RAISE EXCEPTION 'analytics_invalid_window';
  END IF;

  SELECT * INTO v_flow
  FROM public.flows flow
  WHERE flow.id = p_flow_id
    AND public.is_account_member(flow.account_id, 'viewer');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'analytics_not_found';
  END IF;

  SELECT * INTO v_version
  FROM public.flow_versions version
  WHERE version.id = COALESCE(p_version_id, v_flow.published_version_id)
    AND version.flow_id = v_flow.id
    AND version.account_id = v_flow.account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'analytics_not_found';
  END IF;
  IF pg_catalog.jsonb_array_length(v_version.graph->'nodes') > 500 THEN
    RAISE EXCEPTION 'analytics_node_limit';
  END IF;

  SELECT coverage.started_at INTO v_coverage_started_at
  FROM public.flow_analytics_coverage coverage
  WHERE coverage.singleton = TRUE;

  SELECT COUNT(*) INTO v_legacy_attempts_excluded
  FROM public.flow_node_executions execution
  WHERE execution.flow_version_id = v_version.id
    AND execution.visit_id IS NULL
    AND execution.started_at >= v_from
    AND execution.started_at < v_to;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', available.id,
        'version', available.version,
        'label', available.label
      )
      ORDER BY available.version DESC
    ),
    '[]'::jsonb
  )
  INTO v_available_versions
  FROM (
    SELECT version.id, version.version, version.label
    FROM public.flow_versions version
    WHERE version.flow_id = v_flow.id
      AND version.account_id = v_flow.account_id
    ORDER BY version.version DESC
    LIMIT 500
  ) available;

  WITH graph_nodes AS (
    SELECT
      ordinality::INTEGER AS ordinal,
      node->>'node_key' AS node_key,
      node->>'node_type' AS node_type
    FROM pg_catalog.jsonb_array_elements(v_version.graph->'nodes')
      WITH ORDINALITY AS graph(node, ordinality)
    LIMIT 500
  ),
  selected_visits AS (
    SELECT visit.*
    FROM public.flow_node_visits visit
    WHERE visit.flow_version_id = v_version.id
      AND visit.entered_at >= v_from
      AND visit.entered_at < v_to
  ),
  attempt_totals AS (
    SELECT
      visit.node_key,
      visit.visit_id,
      COALESCE(SUM(execution.duration_ms), 0)::NUMERIC AS processing_ms
    FROM selected_visits visit
    LEFT JOIN public.flow_node_executions execution
      ON execution.flow_run_id = visit.flow_run_id
     AND execution.flow_version_id = visit.flow_version_id
     AND execution.visit_id = visit.visit_id
     AND execution.node_key = visit.node_key
    GROUP BY visit.node_key, visit.visit_id
  ),
  processing AS (
    SELECT node_key, AVG(processing_ms) AS avg_processing_ms
    FROM attempt_totals
    GROUP BY node_key
  ),
  visit_stats AS (
    SELECT
      visit.node_key,
      COUNT(DISTINCT visit.visit_id)::BIGINT AS entries,
      COUNT(DISTINCT visit.flow_run_id)::BIGINT AS unique_runs,
      COUNT(*) FILTER (WHERE visit.resolved_at IS NULL)::BIGINT AS open_count,
      COUNT(*) FILTER (WHERE visit.resolved_at IS NOT NULL)::BIGINT
        AS resolved,
      COUNT(*) FILTER (WHERE visit.outcome = 'advanced')::BIGINT AS advanced,
      COUNT(*) FILTER (
        WHERE visit.outcome IN ('failed', 'timed_out', 'paused_by_agent')
      )::BIGINT AS dropoff,
      COUNT(*) FILTER (WHERE visit.outcome = 'completed')::BIGINT
        AS completed,
      COUNT(*) FILTER (WHERE visit.outcome = 'handed_off')::BIGINT
        AS handed_off,
      AVG(
        EXTRACT(EPOCH FROM (visit.resolved_at - visit.entered_at)) * 1000
      ) FILTER (WHERE visit.resolved_at IS NOT NULL) AS avg_duration_ms
    FROM selected_visits visit
    GROUP BY visit.node_key
  ),
  branch_counts AS (
    SELECT
      visit.node_key,
      visit.next_flow_version_id,
      visit.next_node_key,
      COUNT(*)::BIGINT AS branch_count
    FROM selected_visits visit
    WHERE visit.outcome = 'advanced'
    GROUP BY
      visit.node_key, visit.next_flow_version_id, visit.next_node_key
  ),
  branches AS (
    SELECT
      branch.node_key,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'flow_version_id', branch.next_flow_version_id,
          'node_key', branch.next_node_key,
          'count', branch.branch_count
        )
        ORDER BY branch.branch_count DESC, branch.next_node_key
      ) AS next_nodes
    FROM branch_counts branch
    GROUP BY branch.node_key
  ),
  metrics AS (
    SELECT
      graph.ordinal,
      graph.node_key,
      graph.node_type,
      COALESCE(stats.entries, 0)::BIGINT AS entries,
      COALESCE(stats.unique_runs, 0)::BIGINT AS unique_runs,
      COALESCE(stats.open_count, 0)::BIGINT AS open_count,
      COALESCE(stats.resolved, 0)::BIGINT AS resolved,
      COALESCE(stats.advanced, 0)::BIGINT AS advanced,
      COALESCE(stats.dropoff, 0)::BIGINT AS dropoff,
      COALESCE(stats.completed, 0)::BIGINT AS completed,
      COALESCE(stats.handed_off, 0)::BIGINT AS handed_off,
      CASE
        WHEN COALESCE(stats.resolved, 0) = 0 THEN NULL
        ELSE stats.advanced::NUMERIC / NULLIF(stats.resolved, 0)
      END AS advance_rate,
      CASE
        WHEN COALESCE(stats.resolved, 0) = 0 THEN NULL
        ELSE stats.dropoff::NUMERIC / NULLIF(stats.resolved, 0)
      END AS dropoff_rate,
      ROUND(stats.avg_duration_ms, 2) AS avg_duration_ms,
      ROUND(processing.avg_processing_ms, 2) AS avg_processing_ms,
      COALESCE(branches.next_nodes, '[]'::jsonb) AS next_nodes
    FROM graph_nodes graph
    LEFT JOIN visit_stats stats ON stats.node_key = graph.node_key
    LEFT JOIN processing ON processing.node_key = graph.node_key
    LEFT JOIN branches ON branches.node_key = graph.node_key
  )
  SELECT
    COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'node_key', metric.node_key,
          'node_type', metric.node_type,
          'entries', metric.entries,
          'unique_runs', metric.unique_runs,
          'open', metric.open_count,
          'resolved', metric.resolved,
          'advanced', metric.advanced,
          'dropoff', metric.dropoff,
          'completed', metric.completed,
          'handed_off', metric.handed_off,
          'advance_rate', metric.advance_rate,
          'dropoff_rate', metric.dropoff_rate,
          'avg_duration_ms', metric.avg_duration_ms,
          'avg_processing_ms', metric.avg_processing_ms,
          'next_nodes', metric.next_nodes
        )
        ORDER BY metric.ordinal
      ),
      '[]'::jsonb
    )
  INTO v_nodes
  FROM metrics metric;

  WITH expanded AS (
    SELECT
      node,
      node->>'node_key' AS node_key,
      node->>'node_type' AS node_type,
      COALESCE((node->>'entries')::BIGINT, 0) AS entries,
      COALESCE((node->>'dropoff')::BIGINT, 0) AS dropoff,
      COALESCE((node->>'dropoff_rate')::NUMERIC, 0) AS dropoff_rate
    FROM pg_catalog.jsonb_array_elements(v_nodes) node
  )
  SELECT node INTO v_biggest
  FROM expanded
  WHERE node_type NOT IN ('end', 'handoff')
    AND dropoff > 0
  ORDER BY dropoff DESC, dropoff_rate DESC, entries DESC, node_key
  LIMIT 1;

  RETURN pg_catalog.jsonb_build_object(
    'flow', pg_catalog.jsonb_build_object(
      'id', v_flow.id,
      'name', v_flow.name
    ),
    'version', pg_catalog.jsonb_build_object(
      'id', v_version.id,
      'version', v_version.version,
      'label', v_version.label
    ),
    'available_versions', v_available_versions,
    'window', pg_catalog.jsonb_build_object(
      'from', v_from,
      'to', v_to
    ),
    'coverage_started_at', v_coverage_started_at,
    'legacy_attempts_excluded', v_legacy_attempts_excluded,
    'biggest_dropoff', v_biggest,
    'nodes', v_nodes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_flow_node_analytics(
  UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_flow_node_analytics(
  UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ
) TO authenticated, service_role;
