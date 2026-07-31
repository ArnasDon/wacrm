-- ============================================================
-- 041_ai_knowledge_google_docs
--
-- Lets a knowledge-base document (migration 030) be backed by a
-- public Google Doc instead of pasted text. `source_type='google_doc'`
-- rows store the doc's URL and get their `content` refreshed by
-- fetching `https://docs.google.com/document/d/{id}/export?format=txt`
-- (works with no auth when the doc is shared "Anyone with the link"),
-- then re-ingested through the existing `ingestDocument()` chunk/embed
-- pipeline — retrieval doesn't need to know the difference.
--
-- Sync is manual (a "Sync now" button) in this first version, not a
-- background cron.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'google_doc'));

ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS source_url text;

ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
