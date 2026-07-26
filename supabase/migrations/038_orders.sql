-- ============================================================
-- 038_orders.sql ? Orders (commerce layer)
-- Idempotent ? safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL,
  total_amount NUMERIC(12,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'paid', 'delivered', 'failed', 'refunded')),
  payment_provider TEXT CHECK (payment_provider IN ('razorpay', 'stripe')),
  payment_link_id TEXT,
  payment_link_url TEXT,
  payment_id TEXT,
  delivery_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_account_id ON orders(account_id);
CREATE INDEX IF NOT EXISTS idx_orders_contact_id ON orders(contact_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(account_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_link_id ON orders(payment_link_id) WHERE payment_link_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_payment_id ON orders(payment_id) WHERE payment_id IS NOT NULL;

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view orders" ON orders;
CREATE POLICY "Members can view orders" ON orders FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Agents can manage orders" ON orders;
CREATE POLICY "Agents can manage orders" ON orders FOR ALL
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON orders;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();