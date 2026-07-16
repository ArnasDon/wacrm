-- ============================================================
-- PRODUITS
-- ============================================================
CREATE TABLE IF NOT EXISTS produits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_produits_account ON produits(account_id);
CREATE INDEX IF NOT EXISTS idx_produits_name ON produits(account_id, name);

ALTER TABLE produits ENABLE ROW LEVEL SECURITY;

-- Read: any account member can see products
DROP POLICY IF EXISTS produits_select ON produits;
CREATE POLICY produits_select ON produits FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

-- Insert: agents and above can create products
DROP POLICY IF EXISTS produits_insert ON produits;
CREATE POLICY produits_insert ON produits FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

-- Update: agents and above can edit products
DROP POLICY IF EXISTS produits_update ON produits;
CREATE POLICY produits_update ON produits FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- Delete: admins and above can delete products
DROP POLICY IF EXISTS produits_delete ON produits;
CREATE POLICY produits_delete ON produits FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Auto-update updated_at on row change
DROP TRIGGER IF EXISTS set_updated_at ON produits;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON produits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
