-- ============================================================
-- 111_product_rates_per_day.sql — hotel vertical: price rooms per
-- day of the week instead of a Mon–Thu / Fri–Sun split.
--
-- Migrations 106 + 108 modelled a room's nightly price as
-- weekday_group ∈ {weekday, weekend} × occupancy ∈ {standard, couple,
-- group}. Real demand (the DEMO hotel) is a distinct price for every
-- day — Monday ≠ Tuesday ≠ … ≠ Sunday — still crossed with the guest
-- tiers and the optional seasonal date range.
--
-- Rename `weekday_group` → `day_of_week` and swap the CHECK to the seven
-- ISO-ish day codes. `src/lib/products/rates.ts` resolves a nightly
-- rate from `dayOfWeekOf(date)` now; the seasonal-override and
-- couple/group→standard fallback rules are unchanged.
--
-- Safe: `product_rates` has no rows yet in any environment, so this is
-- a pure schema swap with no data to migrate. Idempotent — the rename
-- and CHECK swap both no-op on a second run.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_rates'
      AND column_name = 'weekday_group'
  ) THEN
    ALTER TABLE public.product_rates RENAME COLUMN weekday_group TO day_of_week;
  END IF;
END $$;

ALTER TABLE public.product_rates
  DROP CONSTRAINT IF EXISTS product_rates_weekday_group_check;
ALTER TABLE public.product_rates
  DROP CONSTRAINT IF EXISTS product_rates_day_of_week_check;

ALTER TABLE public.product_rates
  ADD CONSTRAINT product_rates_day_of_week_check
  CHECK (day_of_week IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'));
