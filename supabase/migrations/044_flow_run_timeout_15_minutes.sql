-- ============================================================
-- 044: Automatically end inactive flow runs after 15 minutes.
-- ============================================================
--
-- last_advanced_at is already maintained by the flow engine whenever
-- a run advances to a new node. A minute-level pg_cron sweep turns
-- that timestamp into a real inactivity timeout.
--
-- A run is considered inactive when it has not advanced for 15 minutes.
-- The timeout is intentionally server-side so it happens even when the
-- customer never sends another WhatsApp message.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.expire_stale_flow_runs()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  stale_run RECORD;
  expired_count integer := 0;
BEGIN
  FOR stale_run IN
    UPDATE public.flow_runs
    SET
      status = 'timed_out',
      ended_at = now(),
      end_reason = 'inactivity_timeout_15_minutes'
    WHERE status = 'active'
      AND last_advanced_at <= now() - interval '15 minutes'
    RETURNING id, current_node_key
  LOOP
    INSERT INTO public.flow_run_events (
      flow_run_id,
      event_type,
      node_key,
      payload
    )
    VALUES (
      stale_run.id,
      'timeout',
      stale_run.current_node_key,
      jsonb_build_object(
        'reason', 'inactivity_timeout_15_minutes',
        'timeout_minutes', 15
      )
    );

    expired_count := expired_count + 1;
  END LOOP;

  RETURN expired_count;
END;
$$;

-- This function is an internal scheduler target, not a client API.
REVOKE ALL ON FUNCTION public.expire_stale_flow_runs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_flow_runs() FROM anon;
REVOKE ALL ON FUNCTION public.expire_stale_flow_runs() FROM authenticated;

-- Replace an older copy if this migration is re-applied manually.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'flow-run-inactivity-timeout'
  ) THEN
    PERFORM cron.unschedule('flow-run-inactivity-timeout');
  END IF;
END;
$$;

SELECT cron.schedule(
  'flow-run-inactivity-timeout',
  '* * * * *',
  'SELECT public.expire_stale_flow_runs()'
);
