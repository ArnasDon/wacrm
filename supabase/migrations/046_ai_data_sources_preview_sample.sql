-- ============================================================
-- 046_ai_data_sources_preview_sample.sql
--
-- ai_data_sources.preview_sample (jsonb, nullable)
--   A small snapshot — first 5 rows, keyed by their ORIGINAL header
--   names, plus the raw column list — captured at parse time
--   (src/lib/ai/inventory-parser.ts::ParsedInventory.preview) and now
--   persisted instead of being discarded once the create/refresh
--   request finishes. This is what "Ver datos" (GET /api/ai/data-
--   sources/[id]/preview) shows for a `usage: knowledge` source, which
--   has no structured ai_catalog_products rows to read back.
--
--   For `usage: catalog`/`both` sources the preview endpoint reads
--   live from ai_catalog_products instead (more authoritative — it's
--   literally what search_catalog/get_product return), so this column
--   is populated for every source type/usage uniformly but only ever
--   READ for knowledge-only ones. See docs/integrations/ai-data-
--   integration — inventory/data-sources unification pass.
--
-- Additive only — nullable, no backfill, no data rewritten. A source
-- created before this migration simply has preview_sample = null
-- until its next refresh. Safe to run multiple times.
-- ============================================================

ALTER TABLE ai_data_sources
  ADD COLUMN IF NOT EXISTS preview_sample jsonb;
