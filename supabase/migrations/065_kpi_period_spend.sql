-- ============================================================
-- 065_kpi_period_spend.sql — manually-entered acquisition spend,
-- per account per period, powering the "Costo de Adquisición del
-- Cliente" (CAC) KPI.
--
-- The CRM has no expense/marketing-spend tracking anywhere, so CAC
-- (inversión total ÷ clientes adquiridos) can't be computed
-- automatically. The KPIs page (src/app/(dashboard)/kpis) lets an
-- admin type in what they spent for the date range currently on
-- screen; this table persists that entry (upserted per
-- account+period) so CAC becomes a real trackable-over-time metric
-- instead of a one-off calculator that forgets itself on every visit.
--
-- Settings-class RLS (mirrors ai_configs, migration 029): any member
-- may read (the KPI charts need it), only admin+ may write — a spend
-- figure is financial information, same sensitivity tier as the AI
-- provider config.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.kpi_period_spend (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_kpi_period_spend_account
  ON public.kpi_period_spend(account_id, period_start);

ALTER TABLE public.kpi_period_spend ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kpi_period_spend_select ON public.kpi_period_spend;
CREATE POLICY kpi_period_spend_select ON public.kpi_period_spend FOR SELECT
  USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS kpi_period_spend_insert ON public.kpi_period_spend;
CREATE POLICY kpi_period_spend_insert ON public.kpi_period_spend FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS kpi_period_spend_update ON public.kpi_period_spend;
CREATE POLICY kpi_period_spend_update ON public.kpi_period_spend FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS kpi_period_spend_delete ON public.kpi_period_spend;
CREATE POLICY kpi_period_spend_delete ON public.kpi_period_spend FOR DELETE
  USING (public.is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON public.kpi_period_spend;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.kpi_period_spend
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
