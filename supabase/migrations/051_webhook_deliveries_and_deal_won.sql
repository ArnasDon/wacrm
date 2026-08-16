-- ============================================================
-- 051_webhook_deliveries_and_deal_won.sql
--
-- Two additive, unrelated-but-shipped-together changes for Chat
-- Sandía Bloque 2 (webhooks empresariales + n8n):
--
--   1. `webhook_deliveries` — a persisted log of every outbound
--      webhook attempt (not just the aggregate `failure_count` already
--      on `webhook_endpoints`), so an admin can see delivery history
--      and so a failed delivery can be retried with backoff instead of
--      the previous single-attempt fire-and-forget model
--      (src/lib/webhooks/deliver.ts). Written only by the service role
--      (deliverer + `/api/webhooks/cron`), readable by account members
--      for the Settings UI — same split as `rate_limit_buckets`
--      (migration 048) except SELECT is opened up here since the log
--      is meant to be seen, not hidden.
--
--   2. `pipeline_stages.is_won` — a boolean flag an admin sets on
--      whichever stage represents "Venta cerrada" for their pipeline.
--      Without it there was no way to know a deal was won except the
--      AI action explicitly marking it (`deals.status='won'`) — a
--      human dragging a card to a "won"-looking column never touched
--      `status` at all. `deal.won` (new webhook event) fires when a
--      deal lands on an `is_won` stage, from either path.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. pipeline_stages.is_won
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS is_won BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pipeline_stages.is_won IS
  'Marks this stage as "Venta cerrada" — a deal landing here sets deals.status=''won'' and fires the deal.won webhook event.';

-- 2. webhook_deliveries
CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id      UUID NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  account_id       UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  event            TEXT NOT NULL,
  payload          JSONB NOT NULL,
  -- 'processing' is a transient claim state the cron sweep uses so two
  -- overlapping invocations can't both retry the same row — see
  -- src/app/api/webhooks/cron/route.ts.
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  next_retry_at    TIMESTAMPTZ,
  last_attempt_at  TIMESTAMPTZ,
  response_status  INTEGER,
  response_snippet TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The cron sweep's query: due retries across all accounts.
CREATE INDEX IF NOT EXISTS webhook_deliveries_retry_idx
  ON public.webhook_deliveries (status, next_retry_at)
  WHERE status = 'pending';

-- The per-endpoint delivery log view, newest first.
CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_idx
  ON public.webhook_deliveries (endpoint_id, created_at DESC);

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the account can see the delivery log (same
-- visibility as the endpoint roster itself — webhook_endpoints_select,
-- migration 028).
DROP POLICY IF EXISTS webhook_deliveries_select ON public.webhook_deliveries;
CREATE POLICY webhook_deliveries_select ON public.webhook_deliveries FOR SELECT
  USING (is_account_member(account_id));

-- No INSERT/UPDATE/DELETE policies for authenticated/anon — only the
-- deliverer and the cron route (both service-role) write here, same
-- as rate_limit_buckets (migration 048). A "Retry now" button in the
-- UI goes through an admin-gated API route, not a direct table write.
REVOKE INSERT, UPDATE, DELETE ON public.webhook_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.webhook_deliveries TO service_role;
