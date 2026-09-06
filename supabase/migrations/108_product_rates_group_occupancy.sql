-- ============================================================
-- 108_product_rates_group_occupancy.sql — hotel vertical: add a
-- "group" (3+ guests) occupancy tier to product_rates.
--
-- Migration 106 modelled occupancy as standard | couple (1 vs 2
-- guests). Villa San Ricardo also prices 3+ guests differently, so
-- widen the CHECK to allow a third tier. `src/lib/products/rates.ts`
-- resolves 'group' with the same optional-tier fallback as 'couple'
-- (fall back to the standard rate when no group row is set).
--
-- Widening a CHECK never rewrites existing rows; no data migration.
-- Idempotent.
-- ============================================================

ALTER TABLE public.product_rates
  DROP CONSTRAINT IF EXISTS product_rates_occupancy_check;

ALTER TABLE public.product_rates
  ADD CONSTRAINT product_rates_occupancy_check
  CHECK (occupancy IN ('standard', 'couple', 'group'));
