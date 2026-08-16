-- ============================================================
-- 044_cron_heartbeats.sql, generic "last successful run" tracker for
-- the app's internal cron endpoints (currently:
-- /api/eter-agent/aisdr-approvals/cron; intended to be reused by the
-- other x-cron-secret-gated crons — /api/eter-agent/cron,
-- /api/automations/cron, /api/flows/cron — as they adopt the same
-- liveness signal).
--
-- Context: /api/eter-agent/aisdr-approvals/cron existed with no
-- scheduling documentation and no liveness signal — nothing recorded
-- whether it had EVER run successfully, so a scheduler that was never
-- provisioned (or silently stopped firing) looked identical to one
-- working fine. This table is the minimal fix: one row per cron name,
-- updated on every successful sweep, checked by the cron itself (see
-- checkCronStaleness in the eter-agent repo layer) to alert when the
-- gap since the last recorded success crosses a threshold.
--
-- Design notes
--   - `cron_name` is a free-text identifier chosen by each cron route
--     (e.g. 'aisdr-approvals-reprocess'), not a foreign key — this is
--     an operational table with no per-account tenancy, one row per
--     distinct cron job across the whole deployment.
--   - `last_result` is a small JSON snapshot of the sweep's own return
--     value (attempted/recovered/stillFailing/gaveUp counts, etc.),
--     purely for a human glancing at the row to see what happened
--     without digging through logs.
--   - No RLS-scoped read policy tied to accounts (there is no account
--     to scope to) — this table is internal/operational, read and
--     written only by server code under the service-role client, the
--     same trust boundary every cron route already operates under.
--
-- Idempotent, safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS cron_heartbeats (
  cron_name        text PRIMARY KEY,
  last_success_at  timestamptz NOT NULL,
  last_result      jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.update_cron_heartbeats_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cron_heartbeats_updated_at ON cron_heartbeats;
CREATE TRIGGER cron_heartbeats_updated_at
  BEFORE UPDATE ON cron_heartbeats
  FOR EACH ROW
  EXECUTE FUNCTION public.update_cron_heartbeats_updated_at();
