-- ============================================================
-- 088_observability_heartbeats_and_alerts.sql
--
-- Two platform-level tables for operational monitoring:
--
--   system_heartbeats — one row per background job (cron). Each cron
--     route stamps its row on every run. A stale row (last_run_at older
--     than ~2x its expected interval) means the scheduler stopped
--     firing it — something an HTTP monitor hitting /api/health can't
--     see on its own.
--
--   system_alerts — a deduplicated sink for "something is wrong"
--     signals (dead credential, stale cron, health check failing, AI
--     spend anomaly, …). One active row per `dedup_key`; repeats bump
--     `occurrences` instead of spamming. `dispatchSystemAlert()` in
--     src/lib/observability/alerts.ts is the only writer; it also fans
--     the alert out to Telegram / email.
--
-- Neither table is tenant data. RLS is on with NO write policy (only
-- the service-role backend writes). `system_alerts` is readable by a
-- platform admin (the /admin panel and the future triage bot).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_heartbeats (
  name                       TEXT PRIMARY KEY,
  last_run_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_status                TEXT NOT NULL DEFAULT 'ok' CHECK (last_status IN ('ok', 'error')),
  last_detail                TEXT,
  expected_interval_seconds  INTEGER NOT NULL DEFAULT 300 CHECK (expected_interval_seconds > 0),
  runs_total                 BIGINT NOT NULL DEFAULT 0,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.system_heartbeats ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (which bypasses RLS) reads/writes.
REVOKE ALL ON TABLE public.system_heartbeats FROM anon, authenticated;


CREATE TABLE IF NOT EXISTS public.system_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  severity      TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  source        TEXT NOT NULL,
  title         TEXT NOT NULL,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedup_key     TEXT NOT NULL,
  account_id    UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurrences   INTEGER NOT NULL DEFAULT 1,
  notified_at   TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ
);

-- At most one UNRESOLVED alert per dedup_key. dispatchSystemAlert()
-- upserts against this; resolveSystemAlert() clears resolved_at so a
-- later recurrence opens a fresh row.
CREATE UNIQUE INDEX IF NOT EXISTS system_alerts_active_dedup
  ON public.system_alerts (dedup_key) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS system_alerts_open_recent
  ON public.system_alerts (last_seen_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_alerts_select ON public.system_alerts;
CREATE POLICY system_alerts_select ON public.system_alerts
  FOR SELECT USING (public.is_platform_admin());
-- No INSERT/UPDATE/DELETE policy: only the service-role backend writes.

REVOKE ALL ON TABLE public.system_alerts FROM anon;
GRANT SELECT ON TABLE public.system_alerts TO authenticated;


-- Atomic heartbeat upsert (bumps runs_total on conflict). service-role
-- only — called from every cron route via recordHeartbeat().
CREATE OR REPLACE FUNCTION public.record_heartbeat(
  p_name text,
  p_status text DEFAULT 'ok',
  p_detail text DEFAULT NULL,
  p_interval_seconds integer DEFAULT 300
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.system_heartbeats (name, last_run_at, last_status, last_detail, expected_interval_seconds, runs_total, updated_at)
  VALUES (p_name, now(), COALESCE(NULLIF(p_status,''),'ok'), p_detail, GREATEST(p_interval_seconds, 1), 1, now())
  ON CONFLICT (name) DO UPDATE SET
    last_run_at = now(),
    last_status = COALESCE(NULLIF(EXCLUDED.last_status,''),'ok'),
    last_detail = EXCLUDED.last_detail,
    expected_interval_seconds = EXCLUDED.expected_interval_seconds,
    runs_total = public.system_heartbeats.runs_total + 1,
    updated_at = now();
$$;
ALTER FUNCTION public.record_heartbeat(text, text, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_heartbeat(text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_heartbeat(text, text, text, integer) TO service_role;
