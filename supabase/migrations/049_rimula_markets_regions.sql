-- ============================================================
-- 049_rimula_markets_regions.sql — Markets & Regions (§9.1, §15)
--
-- §9.1 lists `region`/`market` as plain fields on both `Member`
-- (extends `contacts`, migration 050) and `BA` (extends `profiles`,
-- migration 051). §15 additionally lists "Markets, Regions" as their
-- own manageable areas under Settings, alongside Product Categories —
-- which is why these land as proper lookup tables (mirroring
-- `product_categories`, migration 041) rather than free-text columns:
-- an admin needs to see and manage the canonical list of markets a
-- BA/Member can belong to, and §12's routing (`Market BA → Regional
-- BA → Unassigned`) needs a stable id to match on, not a
-- string that can drift between "Lahore" / "lahore" / "LHR".
--
-- A market optionally belongs to a region (regions are the coarser
-- grouping BA routing falls back to when no market-specific BA is
-- available, per §12). Both are settings-class: any account member
-- reads, only admin+ writes — same tier as `product_categories`.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. regions
-- ============================================================
CREATE TABLE IF NOT EXISTS regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_regions_account ON regions(account_id);

ALTER TABLE regions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS regions_select ON regions;
CREATE POLICY regions_select ON regions FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS regions_insert ON regions;
CREATE POLICY regions_insert ON regions FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS regions_update ON regions;
CREATE POLICY regions_update ON regions FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS regions_delete ON regions;
CREATE POLICY regions_delete ON regions FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON regions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON regions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. markets
-- ============================================================
CREATE TABLE IF NOT EXISTS markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  region_id UUID REFERENCES regions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_markets_account ON markets(account_id);
CREATE INDEX IF NOT EXISTS idx_markets_region ON markets(region_id);

ALTER TABLE markets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS markets_select ON markets;
CREATE POLICY markets_select ON markets FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS markets_insert ON markets;
CREATE POLICY markets_insert ON markets FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS markets_update ON markets;
CREATE POLICY markets_update ON markets FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS markets_delete ON markets;
CREATE POLICY markets_delete ON markets FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON markets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON markets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
