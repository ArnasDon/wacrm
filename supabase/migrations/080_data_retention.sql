-- ============================================================
-- 080_data_retention.sql — bounded, auditable data retention
--
-- Business records (contacts, messages, conversations, deals, quotes,
-- broadcasts and critical action audits) are deliberately excluded.
-- The function defaults to dry-run and deletes at most p_batch_size rows
-- from each eligible category per invocation.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_usage_monthly (
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  mode TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  calls BIGINT NOT NULL DEFAULT 0,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, month, mode, provider, model)
);

ALTER TABLE public.ai_usage_monthly ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_usage_monthly_select ON public.ai_usage_monthly;
CREATE POLICY ai_usage_monthly_select ON public.ai_usage_monthly FOR SELECT
  USING (public.is_account_member(account_id, 'admin'));
REVOKE INSERT, UPDATE, DELETE ON public.ai_usage_monthly FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_usage_monthly TO service_role;

CREATE TABLE IF NOT EXISTS public.data_retention_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dry_run BOOLEAN NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.data_retention_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_retention_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.data_retention_runs TO service_role;

CREATE INDEX IF NOT EXISTS notifications_retention_idx
  ON public.notifications (created_at, read_at);
CREATE INDEX IF NOT EXISTS webhook_deliveries_retention_idx
  ON public.webhook_deliveries (status, created_at);
CREATE INDEX IF NOT EXISTS automation_logs_retention_idx
  ON public.automation_logs (status, created_at);
CREATE INDEX IF NOT EXISTS automation_pending_retention_idx
  ON public.automation_pending_executions (status, created_at);
CREATE INDEX IF NOT EXISTS flow_runs_retention_idx
  ON public.flow_runs (status, ended_at);
CREATE INDEX IF NOT EXISTS ai_usage_log_retention_idx
  ON public.ai_usage_log (created_at);
CREATE INDEX IF NOT EXISTS account_invitations_retention_idx
  ON public.account_invitations (expires_at, accepted_at);
CREATE INDEX IF NOT EXISTS rate_limit_buckets_retention_idx
  ON public.rate_limit_buckets (reset_at);

CREATE OR REPLACE FUNCTION public.run_data_retention(
  p_dry_run BOOLEAN DEFAULT true,
  p_batch_size INTEGER DEFAULT 1000,
  p_now TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(p_batch_size, 1), 10000);
  v_summary JSONB := '{}'::jsonb;
  v_count INTEGER;
  v_ai_ids UUID[];
BEGIN
  -- Counts are capped just like execution, so dry-run predicts one sweep.
  SELECT count(*) INTO v_count FROM (
    SELECT 1 FROM notifications
    WHERE (read_at IS NOT NULL AND created_at < p_now - interval '30 days')
       OR (read_at IS NULL AND created_at < p_now - interval '90 days')
    LIMIT v_limit
  ) q;
  v_summary := v_summary || jsonb_build_object('notifications', v_count);

  SELECT count(*) INTO v_count FROM (
    SELECT 1 FROM webhook_deliveries
    WHERE (status = 'delivered' AND created_at < p_now - interval '30 days')
       OR (status = 'failed' AND created_at < p_now - interval '90 days')
    LIMIT v_limit
  ) q;
  v_summary := v_summary || jsonb_build_object('webhook_deliveries', v_count);

  SELECT count(*) INTO v_count FROM (
    SELECT 1 FROM automation_pending_executions
    WHERE (status = 'done' AND created_at < p_now - interval '30 days')
       OR (status = 'failed' AND created_at < p_now - interval '90 days')
    LIMIT v_limit
  ) q;
  v_summary := v_summary || jsonb_build_object('automation_pending_executions', v_count);

  SELECT count(*) INTO v_count FROM (
    SELECT 1 FROM automation_logs l
    WHERE ((l.status IN ('success', 'partial') AND l.created_at < p_now - interval '90 days')
       OR (l.status = 'failed' AND l.created_at < p_now - interval '180 days'))
      AND NOT EXISTS (
        SELECT 1 FROM automation_pending_executions p
        WHERE p.log_id = l.id AND p.status IN ('pending', 'running')
      )
    LIMIT v_limit
  ) q;
  v_summary := v_summary || jsonb_build_object('automation_logs', v_count);

  SELECT count(*) INTO v_count FROM (
    SELECT 1 FROM flow_runs
    WHERE status <> 'active' AND (
      (status = 'failed' AND COALESCE(ended_at, last_advanced_at) < p_now - interval '180 days')
      OR (status <> 'failed' AND COALESCE(ended_at, last_advanced_at) < p_now - interval '90 days')
    ) LIMIT v_limit
  ) q;
  v_summary := v_summary || jsonb_build_object('flow_runs', v_count);

  SELECT count(*) INTO v_count FROM (
    SELECT 1 FROM ai_usage_log WHERE created_at < p_now - interval '90 days' LIMIT v_limit
  ) q;
  v_summary := v_summary || jsonb_build_object('ai_usage_log', v_count);

  SELECT count(*) INTO v_count FROM (
    SELECT 1 FROM account_invitations
    WHERE (accepted_at IS NOT NULL AND accepted_at < p_now - interval '30 days')
       OR (accepted_at IS NULL AND expires_at < p_now - interval '30 days')
    LIMIT v_limit
  ) q;
  v_summary := v_summary || jsonb_build_object('account_invitations', v_count);

  SELECT count(*) INTO v_count FROM (
    SELECT 1 FROM rate_limit_buckets WHERE reset_at < p_now - interval '2 days' LIMIT v_limit
  ) q;
  v_summary := v_summary || jsonb_build_object('rate_limit_buckets', v_count);

  IF NOT p_dry_run THEN
    DELETE FROM notifications WHERE id IN (
      SELECT id FROM notifications
      WHERE (read_at IS NOT NULL AND created_at < p_now - interval '30 days')
         OR (read_at IS NULL AND created_at < p_now - interval '90 days')
      ORDER BY created_at LIMIT v_limit
    );
    DELETE FROM webhook_deliveries WHERE id IN (
      SELECT id FROM webhook_deliveries
      WHERE (status = 'delivered' AND created_at < p_now - interval '30 days')
         OR (status = 'failed' AND created_at < p_now - interval '90 days')
      ORDER BY created_at LIMIT v_limit
    );
    DELETE FROM automation_pending_executions WHERE id IN (
      SELECT id FROM automation_pending_executions
      WHERE (status = 'done' AND created_at < p_now - interval '30 days')
         OR (status = 'failed' AND created_at < p_now - interval '90 days')
      ORDER BY created_at LIMIT v_limit
    );
    DELETE FROM automation_logs WHERE id IN (
      SELECT l.id FROM automation_logs l
      WHERE ((l.status IN ('success', 'partial') AND l.created_at < p_now - interval '90 days')
         OR (l.status = 'failed' AND l.created_at < p_now - interval '180 days'))
        AND NOT EXISTS (SELECT 1 FROM automation_pending_executions p WHERE p.log_id = l.id AND p.status IN ('pending', 'running'))
      ORDER BY l.created_at LIMIT v_limit
    );
    DELETE FROM flow_runs WHERE id IN (
      SELECT id FROM flow_runs
      WHERE status <> 'active' AND (
        (status = 'failed' AND COALESCE(ended_at, last_advanced_at) < p_now - interval '180 days')
        OR (status <> 'failed' AND COALESCE(ended_at, last_advanced_at) < p_now - interval '90 days')
      ) ORDER BY COALESCE(ended_at, last_advanced_at) LIMIT v_limit
    );

    SELECT array_agg(id) INTO v_ai_ids FROM (
      SELECT id FROM ai_usage_log WHERE created_at < p_now - interval '90 days'
      ORDER BY created_at LIMIT v_limit
    ) old_ai;
    IF COALESCE(array_length(v_ai_ids, 1), 0) > 0 THEN
      INSERT INTO ai_usage_monthly (
        account_id, month, mode, provider, model, calls,
        prompt_tokens, completion_tokens, total_tokens
      )
      SELECT account_id, date_trunc('month', created_at)::date, mode, provider, model,
        count(*), sum(prompt_tokens), sum(completion_tokens), sum(total_tokens)
      FROM ai_usage_log WHERE id = ANY(v_ai_ids)
      GROUP BY account_id, date_trunc('month', created_at)::date, mode, provider, model
      ON CONFLICT (account_id, month, mode, provider, model) DO UPDATE SET
        calls = ai_usage_monthly.calls + EXCLUDED.calls,
        prompt_tokens = ai_usage_monthly.prompt_tokens + EXCLUDED.prompt_tokens,
        completion_tokens = ai_usage_monthly.completion_tokens + EXCLUDED.completion_tokens,
        total_tokens = ai_usage_monthly.total_tokens + EXCLUDED.total_tokens;
      DELETE FROM ai_usage_log WHERE id = ANY(v_ai_ids);
    END IF;

    DELETE FROM account_invitations WHERE id IN (
      SELECT id FROM account_invitations
      WHERE (accepted_at IS NOT NULL AND accepted_at < p_now - interval '30 days')
         OR (accepted_at IS NULL AND expires_at < p_now - interval '30 days')
      ORDER BY COALESCE(accepted_at, expires_at) LIMIT v_limit
    );
    DELETE FROM rate_limit_buckets WHERE bucket_key IN (
      SELECT bucket_key FROM rate_limit_buckets WHERE reset_at < p_now - interval '2 days'
      ORDER BY reset_at LIMIT v_limit
    );

    DELETE FROM data_retention_runs WHERE created_at < p_now - interval '180 days';
  END IF;

  INSERT INTO data_retention_runs (dry_run, summary) VALUES (p_dry_run, v_summary);
  RETURN v_summary;
END;
$$;

REVOKE ALL ON FUNCTION public.run_data_retention(BOOLEAN, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_data_retention(BOOLEAN, INTEGER, TIMESTAMPTZ)
  TO service_role;

COMMENT ON FUNCTION public.run_data_retention(BOOLEAN, INTEGER, TIMESTAMPTZ) IS
  'Prunes bounded technical history. Defaults to dry-run; never removes CRM business records or critical action audits.';
