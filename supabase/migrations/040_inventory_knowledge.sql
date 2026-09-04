-- ============================================================
-- 039_inventory_knowledge.sql — Inventory file support for AI
-- knowledge base
--
-- Adds `type` and `metadata` columns to ai_knowledge_documents
-- so inventory uploads (CSV / Excel / Google Sheets) can be
-- distinguished from manually-pasted documents and replaced
-- atomically without touching the user's manual entries.
-- ============================================================

ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS metadata JSONB;

CREATE INDEX IF NOT EXISTS ai_knowledge_documents_type_idx
  ON ai_knowledge_documents (account_id, type);
