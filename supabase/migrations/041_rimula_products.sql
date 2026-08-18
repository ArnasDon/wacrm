-- ============================================================
-- 041_rimula_products.sql — Product catalog (§9.0/§9.1, §11)
--
-- Five net-new tables backing the Products area:
--
--   1. product_categories — flat category list per account.
--   2. products           — the catalog entry itself. `key_features`
--      and `benefits` are JSONB arrays of strings (free-form bullet
--      lists that don't warrant their own child tables). `vehicle_types`
--      / `recommended_vehicles` / `engine_types` are TEXT[] summaries
--      for quick display; the *verified* Vehicle↔Product compatibility
--      relationship lives in `product_vehicles` (migration 042), which
--      is the source of truth for anything shown to a customer as fact
--      (§11: "AI must never invent a compatibility match").
--   3. product_images     — one row per uploaded image, account-scoped
--      storage path (no bucket created here — reuses the existing
--      `chat-media` convention per the corrected §9.0 map).
--   4. product_applications — structured "used in X application" rows,
--      separate from the summary text on `products` so each entry can
--      carry its own notes and be individually added/removed.
--   5. product_claims     — each claim has its own approval lifecycle
--      (§2 "only administrator-approved data may be shown as fact"),
--      which a single JSONB column on `products` couldn't express
--      (who approved which claim, and when).
--
-- All five are settings-class (mirrors `tags` / `whatsapp_config` from
-- migration 017): any account member reads; only admin+ writes. This
-- matches §11 — product/claim data is administrator-curated, not
-- something any agent can edit ad hoc.
--
-- `account_id` is denormalized onto every child table (not resolved by
-- joining through `products`) so RLS and hot-path queries never need a
-- join — same choice migration 030 made for `ai_knowledge_chunks`.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. product_categories
-- ============================================================
CREATE TABLE IF NOT EXISTS product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_product_categories_account ON product_categories(account_id);

ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_categories_select ON product_categories;
CREATE POLICY product_categories_select ON product_categories FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS product_categories_insert ON product_categories;
CREATE POLICY product_categories_insert ON product_categories FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS product_categories_update ON product_categories;
CREATE POLICY product_categories_update ON product_categories FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS product_categories_delete ON product_categories;
CREATE POLICY product_categories_delete ON product_categories FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON product_categories;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON product_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. products
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  product_code TEXT,
  product_name TEXT NOT NULL,
  description TEXT,
  short_description TEXT,
  long_description TEXT,
  key_features JSONB NOT NULL DEFAULT '[]'::jsonb,
  benefits JSONB NOT NULL DEFAULT '[]'::jsonb,
  vehicle_types TEXT[] NOT NULL DEFAULT '{}',
  recommended_vehicles TEXT[] NOT NULL DEFAULT '{}',
  engine_types TEXT[] NOT NULL DEFAULT '{}',
  packaging TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'published', 'archived')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_account ON products(account_id);
CREATE INDEX IF NOT EXISTS idx_products_account_status ON products(account_id, status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

-- product_code is optional (a product can be entered before a SKU is
-- assigned) but must be unique per account when present. A plain
-- UNIQUE constraint would treat every NULL as distinct anyway, but
-- being explicit about the empty-string case too (CSV imports often
-- produce '' rather than NULL) keeps this from silently degrading.
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_account_code
  ON products(account_id, product_code)
  WHERE product_code IS NOT NULL AND product_code <> '';

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS products_select ON products;
CREATE POLICY products_select ON products FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS products_insert ON products;
CREATE POLICY products_insert ON products FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS products_update ON products;
CREATE POLICY products_update ON products FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS products_delete ON products;
CREATE POLICY products_delete ON products FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON products;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. product_images
-- ============================================================
CREATE TABLE IF NOT EXISTS product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- Storage object path within the existing `chat-media` bucket
  -- (account-<account_id>/... convention, migration 023), not a new
  -- bucket — see the corrected §9.0 map.
  storage_path TEXT NOT NULL,
  alt_text TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, position);
CREATE INDEX IF NOT EXISTS idx_product_images_account ON product_images(account_id);

ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_images_select ON product_images;
CREATE POLICY product_images_select ON product_images FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS product_images_insert ON product_images;
CREATE POLICY product_images_insert ON product_images FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS product_images_update ON product_images;
CREATE POLICY product_images_update ON product_images FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS product_images_delete ON product_images;
CREATE POLICY product_images_delete ON product_images FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- 4. product_applications
-- ============================================================
CREATE TABLE IF NOT EXISTS product_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  application TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_applications_product ON product_applications(product_id);
CREATE INDEX IF NOT EXISTS idx_product_applications_account ON product_applications(account_id);

ALTER TABLE product_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_applications_select ON product_applications;
CREATE POLICY product_applications_select ON product_applications FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS product_applications_insert ON product_applications;
CREATE POLICY product_applications_insert ON product_applications FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS product_applications_update ON product_applications;
CREATE POLICY product_applications_update ON product_applications FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS product_applications_delete ON product_applications;
CREATE POLICY product_applications_delete ON product_applications FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- 5. product_claims
-- ============================================================
CREATE TABLE IF NOT EXISTS product_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  claim_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_claims_product ON product_claims(product_id);
-- The AI Q&A grounding path (§11) and the product page both need
-- "give me this product's *approved* claims" fast.
CREATE INDEX IF NOT EXISTS idx_product_claims_product_status ON product_claims(product_id, status);
CREATE INDEX IF NOT EXISTS idx_product_claims_account ON product_claims(account_id);

ALTER TABLE product_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_claims_select ON product_claims;
CREATE POLICY product_claims_select ON product_claims FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS product_claims_insert ON product_claims;
CREATE POLICY product_claims_insert ON product_claims FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS product_claims_update ON product_claims;
CREATE POLICY product_claims_update ON product_claims FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS product_claims_delete ON product_claims;
CREATE POLICY product_claims_delete ON product_claims FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON product_claims;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON product_claims
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
