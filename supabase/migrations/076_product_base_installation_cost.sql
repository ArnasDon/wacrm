-- ============================================================
-- 076_product_base_installation_cost.sql
--
-- Migration 075 added an optional installation_cost to each
-- product_price_option, but not to the product's own base price —
-- Angel wants it there too, so ALL three possible prices per product
-- (base + 2 options) can carry their own optional installation cost,
-- not just the two additional ones.
--
-- Nullable, same as product_price_options.installation_cost — most
-- products never set it.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS installation_cost NUMERIC(12,2);

COMMENT ON COLUMN public.products.installation_cost IS
  'Optional flat installation fee for the product''s base price (migration 076) — shown as a separate quote line, same treatment as product_price_options.installation_cost for the additional price options.';
