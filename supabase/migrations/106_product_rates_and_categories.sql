-- ============================================================
-- 106_product_rates_and_categories.sql — hotel vertical: catalog
-- categories + per-date room rates
--
-- The `hotel` industry vertical (migration 105) needs two things the
-- flat `products` table can't express:
--
--   1. product_categories — group rooms / spa / activities / packages.
--      A nullable `products.category_id` (SET NULL on delete) so
--      generic accounts simply never set it.
--
--   2. product_rates — a room's price depends on the night. Villa San
--      Ricardo's rule: Mon–Thu (`weekday`) is cheaper than Fri–Sun
--      (`weekend`), and a couple rate differs from the standard rate.
--      Optional `date_from`/`date_to` gives a seasonal override that
--      wins over the always-on row for nights inside the range.
--      `src/lib/products/rates.ts` resolves a nightly rate + a stay
--      total from these rows.
--
-- Same tenancy + RLS shape as product_price_options (migration 075):
-- own `account_id` column, member reads, agent+ writes, `set_updated_at`
-- trigger. Idempotent — safe to re-run.
-- ============================================================

-- 1. product_categories ---------------------------------------

CREATE TABLE IF NOT EXISTS product_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_categories_account ON product_categories(account_id);

ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_categories_select ON product_categories;
DROP POLICY IF EXISTS product_categories_insert ON product_categories;
DROP POLICY IF EXISTS product_categories_update ON product_categories;
DROP POLICY IF EXISTS product_categories_delete ON product_categories;
CREATE POLICY product_categories_select ON product_categories FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY product_categories_insert ON product_categories FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY product_categories_update ON product_categories FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY product_categories_delete ON product_categories FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON product_categories;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON product_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

-- 2. product_rates ------------------------------------------------

CREATE TABLE IF NOT EXISTS product_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  weekday_group TEXT NOT NULL CHECK (weekday_group IN ('weekday', 'weekend')),
  occupancy TEXT NOT NULL DEFAULT 'standard' CHECK (occupancy IN ('standard', 'couple')),
  price NUMERIC(12,2) NOT NULL,
  -- NULL/NULL = the always-on rate. A row with both set is a seasonal
  -- override that wins for nights within [date_from, date_to].
  date_from DATE,
  date_to DATE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((date_from IS NULL) = (date_to IS NULL)),
  CHECK (date_from IS NULL OR date_to >= date_from)
);

CREATE INDEX IF NOT EXISTS idx_product_rates_product ON product_rates(product_id);
CREATE INDEX IF NOT EXISTS idx_product_rates_account ON product_rates(account_id);

ALTER TABLE product_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_rates_select ON product_rates;
DROP POLICY IF EXISTS product_rates_insert ON product_rates;
DROP POLICY IF EXISTS product_rates_update ON product_rates;
DROP POLICY IF EXISTS product_rates_delete ON product_rates;
CREATE POLICY product_rates_select ON product_rates FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY product_rates_insert ON product_rates FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY product_rates_update ON product_rates FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY product_rates_delete ON product_rates FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON product_rates;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON product_rates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
