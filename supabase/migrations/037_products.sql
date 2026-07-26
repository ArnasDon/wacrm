-- ============================================================
-- 037_products.sql ? Products (commerce layer)
-- Idempotent ? safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  product_type TEXT NOT NULL DEFAULT 'digital_file'
    CHECK (product_type IN ('digital_file', 'link', 'service')),
  delivery_url TEXT,
  image_url TEXT,
  trigger_keyword TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, trigger_keyword)
);

CREATE INDEX IF NOT EXISTS idx_products_account_id ON products(account_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(account_id) WHERE status = 'active';

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view products" ON products;
CREATE POLICY "Members can view products" ON products FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Agents can manage products" ON products;
CREATE POLICY "Agents can manage products" ON products FOR ALL
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON products;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();