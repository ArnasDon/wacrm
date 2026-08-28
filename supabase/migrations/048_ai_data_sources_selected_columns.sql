-- ============================================================
-- 048_ai_data_sources_selected_columns.sql
--
-- ai_data_sources.selected_columns (jsonb array of strings, nullable)
--   The raw header names the user chose to keep for THIS source, out
--   of everything actually detected in its CSV/Sheet/Excel file — the
--   "pick which columns to use" step the legacy single-inventory
--   upload flow already had (AiKnowledgeCard's InventoryUploader), now
--   ported to the unified Data Sources system.
--
--   null means "no explicit selection was made" — every existing
--   source created before this migration falls into this case, and is
--   treated as "use every detected column" (the exact behavior these
--   sources already had), so nothing already synced changes meaning.
--
--   Both the flattened knowledge-base text (content) and the
--   structured catalog rows (ai_catalog_products) are now filtered by
--   this set when it's present — see src/lib/ai/inventory-parser.ts
--   and src/lib/ai/data-sources/service.ts. column_mapping (existing,
--   migration 044) still records the ROLE detection (which raw column
--   is "the price column", etc.) among the SELECTED columns only —
--   unaffected by this migration's shape, just narrower going forward
--   for sources that use a selection.
--
-- Additive only — nullable, no backfill, no data rewritten. Safe to
-- run multiple times.
-- ============================================================

ALTER TABLE ai_data_sources
  ADD COLUMN IF NOT EXISTS selected_columns jsonb;
