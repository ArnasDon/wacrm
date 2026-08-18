-- ============================================================
-- 042_rimula_vehicles.sql — Vehicles + verified compatibility (§11)
--
--   1. vehicles         — Vehicle Type / Manufacturer / Model / Engine
--      tuples an account has entered.
--   2. product_vehicles — the join table recording a *verified*
--      Product↔Vehicle compatibility, i.e. the only source of truth
--      the app may show a customer as fact (§2, §11: "AI must never
--      invent a compatibility match"). `verified_by` / `verified_at`
--      exist so the product page and any future audit view can show
--      who confirmed the match, not just that a row exists.
--
-- Both settings-class (admin+ writes only), same posture as
-- `product_categories` / `products` in migration 041 — compatibility
-- data is exactly the kind of "administrator-approved fact" §2's
-- data-integrity rule is protecting.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. vehicles
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  vehicle_type TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  -- NOT NULL DEFAULT '' (rather than nullable) so the composite
  -- UNIQUE below behaves predictably — Postgres treats every NULL as
  -- distinct, which would silently defeat dedup on vehicles with no
  -- engine variant recorded.
  engine TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, vehicle_type, manufacturer, model, engine)
);

CREATE INDEX IF NOT EXISTS idx_vehicles_account ON vehicles(account_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_account_type ON vehicles(account_id, vehicle_type);

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicles_select ON vehicles;
CREATE POLICY vehicles_select ON vehicles FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS vehicles_insert ON vehicles;
CREATE POLICY vehicles_insert ON vehicles FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS vehicles_update ON vehicles;
CREATE POLICY vehicles_update ON vehicles FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS vehicles_delete ON vehicles;
CREATE POLICY vehicles_delete ON vehicles FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON vehicles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. product_vehicles — verified compatibility join
-- ============================================================
CREATE TABLE IF NOT EXISTS product_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_product_vehicles_product ON product_vehicles(product_id);
CREATE INDEX IF NOT EXISTS idx_product_vehicles_vehicle ON product_vehicles(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_product_vehicles_account ON product_vehicles(account_id);

ALTER TABLE product_vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_vehicles_select ON product_vehicles;
CREATE POLICY product_vehicles_select ON product_vehicles FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS product_vehicles_insert ON product_vehicles;
CREATE POLICY product_vehicles_insert ON product_vehicles FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS product_vehicles_update ON product_vehicles;
CREATE POLICY product_vehicles_update ON product_vehicles FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS product_vehicles_delete ON product_vehicles;
CREATE POLICY product_vehicles_delete ON product_vehicles FOR DELETE
  USING (is_account_member(account_id, 'admin'));
