-- ============================================================
-- 075_product_price_options.sql
--
-- Migration 053 explicitly scoped products/quotes WITHOUT variants
-- ("sin categorías/variantes — fuera de alcance por decisión
-- explícita"). Angel now wants exactly that for pricing: the same
-- product can have up to two additional priced options beyond its
-- base price (e.g. a size/color that costs more), each optionally
-- carrying its own installation cost and its own extra photos — three
-- distinct prices total per product (base + 2 options), all optional
-- beyond the base price that already existed.
--
-- `product_price_options` is a child table (not columns on `products`)
-- so a product can have zero, one, or two of these — the app caps it
-- at 2 client-side (product-form.tsx), not enforced here at the DB
-- level, same style as other soft caps in this codebase (e.g.
-- MAX_SCREENSHOTS on support tickets).
--
-- `quote_items.product_price_option_id` records which option (if any)
-- a quote line actually used, for traceability — nullable, SET NULL on
-- delete so removing a price option later never breaks quote history.
--
-- Same tenancy pattern as `products` itself: own `account_id` column
-- for direct RLS (not only via the `product_id` FK), agent+ writes,
-- any account member reads.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS product_price_options (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL,
  installation_cost NUMERIC(12,2),
  image_urls TEXT[] NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_price_options_product ON product_price_options(product_id);
CREATE INDEX IF NOT EXISTS idx_product_price_options_account ON product_price_options(account_id);

ALTER TABLE product_price_options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_price_options_select ON product_price_options;
DROP POLICY IF EXISTS product_price_options_insert ON product_price_options;
DROP POLICY IF EXISTS product_price_options_update ON product_price_options;
DROP POLICY IF EXISTS product_price_options_delete ON product_price_options;
CREATE POLICY product_price_options_select ON product_price_options FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY product_price_options_insert ON product_price_options FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY product_price_options_update ON product_price_options FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY product_price_options_delete ON product_price_options FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON product_price_options;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON product_price_options
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE quote_items
  ADD COLUMN IF NOT EXISTS product_price_option_id UUID REFERENCES product_price_options(id) ON DELETE SET NULL;
