-- ============================================================
-- 045_ai_catalog_context_and_legacy_unification.sql
--
-- Two small, additive changes for AI_Catalog_Fix_Kit:
--
--   conversations.ai_catalog_context (jsonb, nullable)
--     Structured "what product/family/variant are we talking about"
--     state, persisted per conversation and re-fed into the system
--     prompt on the NEXT turn (src/lib/ai/catalog/context.ts). This is
--     what makes "¿y el morado?" resolvable after "¿cuánto cuesta el
--     negro de 64?" without depending on the LLM re-reading its own
--     prior prose — and is the fix for the reported Playground
--     discontinuity (a turn resolves a product, the next turn says "no
--     confirmed info"). It is advisory context for DISAMBIGUATION only
--     — the prompt still requires a fresh tool call before stating a
--     price/stock, so it cannot itself become a source of stale data.
--
--   ai_data_sources.is_legacy_default (boolean, default false)
--     Marks the ONE data source that the legacy single-inventory
--     upload UI (AiKnowledgeCard's InventoryUploader, and the
--     /api/ai/knowledge/{upload,sheet} routes kept for compatibility)
--     creates-or-replaces, so re-uploading a file/sheet from that UI
--     keeps behaving like the old "there is only one inventory" model
--     while actually writing through the unified ai_data_sources /
--     ai_catalog_products pipeline (docs/integrations/ai-data-
--     integration → AI_Catalog_Fix_Kit, FASE 3). A partial unique
--     index enforces at most one such row per account.
--
-- migration 044 is NOT modified — this only adds new, nullable/
-- defaulted columns to existing tables. No data is deleted or
-- rewritten. Safe to run multiple times.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_catalog_context jsonb;

ALTER TABLE ai_data_sources
  ADD COLUMN IF NOT EXISTS is_legacy_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS ai_data_sources_one_legacy_default_per_account
  ON ai_data_sources (account_id)
  WHERE is_legacy_default = true;
