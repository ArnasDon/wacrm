-- ============================================================
-- 064_deals_won_at.sql — precise "when did this deal become won"
--
-- `deals.updated_at` bumps on ANY field change (title edit, value
-- correction, etc.), not just the won transition, so using it as a
-- proxy for "won in this date range" (needed by the new KPIs page's
-- "tasa de conversión" / funnel charts) can drift — editing a
-- long-won deal's title later would make it look like it was won
-- today. `won_at` is set once, at the exact moment `status` flips to
-- 'won', by the two call sites that ever do that:
--   - src/lib/pipelines/move-deal.ts's moveDeal() (the shared path —
--     human Kanban drag, the `move_deal` AI action, `mark_deal_won`
--     when the pipeline has an `is_won` stage configured)
--   - src/lib/ai/business-actions.ts's `mark_deal_won` fallback
--     (pipelines with no `is_won` stage configured)
--
-- Backfilled from `updated_at` for existing won deals — an
-- approximation, but the best available signal for historical data,
-- and no worse than what every KPI dashboard would have shown before
-- this column existed.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS won_at TIMESTAMPTZ;

UPDATE public.deals
SET won_at = updated_at
WHERE status = 'won' AND won_at IS NULL;
