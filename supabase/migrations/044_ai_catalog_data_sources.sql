-- ============================================================
-- 044_ai_catalog_data_sources.sql — Data Sources + Catalog Integrations
-- for the AI agent's tool-calling loop.
--
-- Extends the AI agent's grounding beyond the existing singleton
-- "inventory" Knowledge Base document (migration 039/040) with:
--
--   ai_data_sources    — account-scoped, MULTIPLE named Google Sheets /
--                         remote CSV / uploaded CSV connections, each
--                         independently configured for `usage`:
--                           knowledge — parsed text feeds the existing
--                                       ai_knowledge_documents/chunks
--                                       RAG path (retrieveKnowledge),
--                                       tagged type='data_source' and
--                                       linked via data_source_id so a
--                                       refresh only replaces its own
--                                       document — the legacy singleton
--                                       type='inventory' document from
--                                       /api/ai/knowledge/{upload,sheet}
--                                       is untouched.
--                           catalog   — parsed rows are additionally
--                                       upserted into ai_catalog_products
--                                       for structured search by the
--                                       search_catalog/get_product/
--                                       get_availability/get_product_media
--                                       tools. Catalog data is NEVER
--                                       written to the KB — it must stay
--                                       reachable only through tool calls
--                                       so the LLM cannot see a price
--                                       without a genuine tool round trip.
--                           both      — does both of the above.
--
--   ai_catalog_products — structured product cache populated by
--                         refreshing a catalog/both data source. Queried
--                         by the generic catalog tools via ILIKE/FTS,
--                         never dumped into a prompt wholesale.
--
--   catalog_integrations — external Catalog API providers (Budun ERP is
--                         the first). Multiple integrations per account
--                         are allowed (multi-provider architecture per
--                         docs/integrations/budun-erp/WACRM_ERP_CATALOG_
--                         INTEGRATION_SPEC_v4.md), with `is_primary`
--                         marking the one the agent uses by default.
--                         `encrypted_secret` reuses the existing
--                         AES-256-GCM encrypt()/decrypt() from
--                         src/lib/whatsapp/encryption.ts — same pattern
--                         as whatsapp_config.access_token / ai_configs.
--                         api_key / webhook_endpoints.secret. No new
--                         crypto is introduced.
--
-- RLS follows the settings-class convention used by ai_configs /
-- whatsapp_config / webhook_endpoints: any account member (viewer+) may
-- read, only admin+ may write. `ai_catalog_products` is written by the
-- service-role client from the refresh route (admin-gated at the route
-- level) but keeps the same RLS shape for defense in depth on direct
-- dashboard reads.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- ai_data_sources
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_data_sources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_type       text NOT NULL CHECK (source_type IN ('google_sheets', 'remote_csv', 'uploaded_csv')),
  display_name      text NOT NULL,
  -- Populated for google_sheets/remote_csv (the fetchable URL). Null for
  -- uploaded_csv — those are parsed once at upload time, same as the
  -- legacy /api/ai/knowledge/upload route; "refreshing" one means
  -- re-uploading, so no raw-file storage is introduced here.
  source_url        text,
  source_filename   text,
  usage             text NOT NULL DEFAULT 'knowledge' CHECK (usage IN ('knowledge', 'catalog', 'both')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error')),
  -- Lower number = higher priority, matching the resolver's ORDER BY.
  priority          integer NOT NULL DEFAULT 100,
  is_primary        boolean NOT NULL DEFAULT false,
  fallback_policy   text NOT NULL DEFAULT 'fallback_on_not_found'
                       CHECK (fallback_policy IN ('primary_only', 'fallback_on_not_found', 'search_all_active')),
  currency          text NOT NULL DEFAULT 'USD',
  -- Detected/selected column map from the parser (sku/name/price/stock/
  -- category/color/brand/model/image), for the settings UI preview.
  column_mapping    jsonb,
  row_count         integer,
  -- The KB document this source's `knowledge`/`both` content was written
  -- to (ai_knowledge_documents.type = 'data_source'). Null when usage is
  -- catalog-only.
  knowledge_document_id uuid REFERENCES ai_knowledge_documents(id) ON DELETE SET NULL,
  last_synced_at    timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_data_sources_account_id_idx ON ai_data_sources (account_id);
CREATE INDEX IF NOT EXISTS ai_data_sources_account_usage_idx ON ai_data_sources (account_id, usage, status);

ALTER TABLE ai_data_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_data_sources_select ON ai_data_sources;
CREATE POLICY ai_data_sources_select ON ai_data_sources FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_data_sources_insert ON ai_data_sources;
CREATE POLICY ai_data_sources_insert ON ai_data_sources FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_data_sources_update ON ai_data_sources;
CREATE POLICY ai_data_sources_update ON ai_data_sources FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_data_sources_delete ON ai_data_sources;
CREATE POLICY ai_data_sources_delete ON ai_data_sources FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- ai_catalog_products — structured cache for catalog/both data sources.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_catalog_products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  data_source_id    uuid NOT NULL REFERENCES ai_data_sources(id) ON DELETE CASCADE,
  -- Stable-ish key within the source (the detected SKU column, or a
  -- row-index fallback when no SKU column was found). Combined with the
  -- provider key at the resolver layer to build the composite id handed
  -- to the LLM (e.g. "ds:<data_source_id>:<source_product_id>") so a
  -- follow-up get_availability/get_product_media call routes back to
  -- this exact row without a second free-text search.
  source_product_id text NOT NULL,
  sku               text,
  name              text NOT NULL,
  brand             text,
  model             text,
  description       text,
  color             text,
  variant_label     text,
  capacity          text,
  size              text,
  price             numeric,
  currency          text,
  available         boolean NOT NULL DEFAULT true,
  available_quantity integer,
  primary_image_url text,
  images            jsonb NOT NULL DEFAULT '[]'::jsonb,
  fts               tsvector GENERATED ALWAYS AS (
                       to_tsvector('simple',
                         coalesce(name, '') || ' ' ||
                         coalesce(sku, '') || ' ' ||
                         coalesce(brand, '') || ' ' ||
                         coalesce(model, '') || ' ' ||
                         coalesce(color, '') || ' ' ||
                         coalesce(variant_label, '')
                       )
                     ) STORED,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_catalog_products_account_id_idx ON ai_catalog_products (account_id);
CREATE INDEX IF NOT EXISTS ai_catalog_products_data_source_id_idx ON ai_catalog_products (data_source_id);
CREATE INDEX IF NOT EXISTS ai_catalog_products_sku_idx ON ai_catalog_products (account_id, lower(sku));
CREATE INDEX IF NOT EXISTS ai_catalog_products_fts_idx ON ai_catalog_products USING gin (fts);

ALTER TABLE ai_catalog_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_catalog_products_select ON ai_catalog_products;
CREATE POLICY ai_catalog_products_select ON ai_catalog_products FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_catalog_products_insert ON ai_catalog_products;
CREATE POLICY ai_catalog_products_insert ON ai_catalog_products FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_catalog_products_update ON ai_catalog_products;
CREATE POLICY ai_catalog_products_update ON ai_catalog_products FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_catalog_products_delete ON ai_catalog_products;
CREATE POLICY ai_catalog_products_delete ON ai_catalog_products FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- catalog_integrations — external Catalog API providers (Budun ERP first).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_integrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Generic on purpose (docs/integrations/budun-erp/WACRM_ERP_CATALOG_
  -- INTEGRATION_SPEC_v4.md §16): the Inventory/Catalog API concept must
  -- not be coupled to a single ERP brand. Budun is the first, and only,
  -- authorized provider value for this execution.
  provider          text NOT NULL CHECK (provider IN ('budun')),
  display_name      text NOT NULL,
  base_url          text NOT NULL,
  -- Public identifier (NOT a secret) — sent alongside the Bearer secret
  -- so the ERP can tell integrations apart; never sufficient to
  -- authenticate on its own.
  app_key           text,
  -- AES-256-GCM ciphertext via src/lib/whatsapp/encryption.ts — the
  -- Application Secret / Catalog API access credential, in the same
  -- reversible format as whatsapp_config.access_token.
  encrypted_secret  text NOT NULL,
  scopes            text[] NOT NULL DEFAULT ARRAY['catalog:read', 'catalog:availability:read', 'catalog:media:read'],
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error')),
  priority          integer NOT NULL DEFAULT 100,
  is_primary        boolean NOT NULL DEFAULT true,
  last_test_at      timestamptz,
  last_test_ok      boolean,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_integrations_account_id_idx ON catalog_integrations (account_id);

ALTER TABLE catalog_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_integrations_select ON catalog_integrations;
CREATE POLICY catalog_integrations_select ON catalog_integrations FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS catalog_integrations_insert ON catalog_integrations;
CREATE POLICY catalog_integrations_insert ON catalog_integrations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS catalog_integrations_update ON catalog_integrations;
CREATE POLICY catalog_integrations_update ON catalog_integrations FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS catalog_integrations_delete ON catalog_integrations;
CREATE POLICY catalog_integrations_delete ON catalog_integrations FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- Extend ai_knowledge_documents so a data source's `knowledge`/`both`
-- content can be traced back to (and replaced by) its own refresh,
-- without touching the legacy singleton type='inventory' document or
-- manually-pasted entries. Purely additive — nullable FK, new allowed
-- `type` value enforced in application code (the column has no CHECK
-- constraint to relax).
-- ------------------------------------------------------------
ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS data_source_id uuid REFERENCES ai_data_sources(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS ai_knowledge_documents_data_source_id_idx
  ON ai_knowledge_documents (data_source_id) WHERE data_source_id IS NOT NULL;

-- ------------------------------------------------------------
-- Shared updated_at trigger for the three new tables (mirrors the
-- per-table function style already used for ai_knowledge_documents).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_ai_catalog_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

DROP TRIGGER IF EXISTS ai_data_sources_set_updated_at ON ai_data_sources;
CREATE TRIGGER ai_data_sources_set_updated_at
  BEFORE UPDATE ON ai_data_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_ai_catalog_updated_at();

DROP TRIGGER IF EXISTS ai_catalog_products_set_updated_at ON ai_catalog_products;
CREATE TRIGGER ai_catalog_products_set_updated_at
  BEFORE UPDATE ON ai_catalog_products
  FOR EACH ROW EXECUTE FUNCTION public.set_ai_catalog_updated_at();

DROP TRIGGER IF EXISTS catalog_integrations_set_updated_at ON catalog_integrations;
CREATE TRIGGER catalog_integrations_set_updated_at
  BEFORE UPDATE ON catalog_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_ai_catalog_updated_at();

-- ------------------------------------------------------------
-- Search RPC — ILIKE/FTS hybrid, mirrors match_ai_knowledge_fts
-- (migration 041) but over the structured catalog table. SECURITY
-- INVOKER + explicit account_id filter, called from the service-role
-- client by the tool executor (never from the browser).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_ai_catalog_products(
  p_account_id    uuid,
  p_data_source_ids uuid[],
  p_query         text,
  p_color         text,
  p_match_count   integer
)
RETURNS SETOF ai_catalog_products AS $$
  SELECT p.*
  FROM ai_catalog_products p
  WHERE p.account_id = p_account_id
    AND (p_data_source_ids IS NULL OR p.data_source_id = ANY(p_data_source_ids))
    AND (
      p_query IS NULL OR trim(p_query) = '' OR
      p.fts @@ plainto_tsquery('simple', p_query) OR
      p.name ILIKE '%' || p_query || '%' OR
      p.sku ILIKE '%' || p_query || '%'
    )
    AND (p_color IS NULL OR trim(p_color) = '' OR p.color ILIKE '%' || p_color || '%')
  ORDER BY
    CASE WHEN p_query IS NULL OR trim(p_query) = '' THEN 0
         ELSE ts_rank(p.fts, plainto_tsquery('simple', p_query)) END DESC,
    p.name ASC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.search_ai_catalog_products(uuid, uuid[], text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_ai_catalog_products(uuid, uuid[], text, text, integer) TO authenticated, service_role;
