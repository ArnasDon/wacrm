-- ============================================================
-- 037_drop_ai.sql - remove AI reply assistant
--
-- Destructive and irreversible for deployed instances: AI provider
-- configuration, knowledge base content, usage records, conversation
-- auto-reply state, and AI message badges are dropped. The pgvector
-- extension is intentionally left installed because it is low-cost and
-- may be shared by other features.
--
-- Idempotent - safe to run more than once.
-- ============================================================

DROP TABLE IF EXISTS ai_usage_log, ai_knowledge_chunks, ai_knowledge_documents, ai_configs CASCADE;

ALTER TABLE conversations
  DROP COLUMN IF EXISTS ai_autoreply_disabled,
  DROP COLUMN IF EXISTS ai_reply_count,
  DROP COLUMN IF EXISTS ai_handoff_summary;

ALTER TABLE messages
  DROP COLUMN IF EXISTS ai_generated;

DROP FUNCTION IF EXISTS public.claim_ai_reply_slot(uuid, integer);
DROP FUNCTION IF EXISTS public.match_ai_knowledge_fts(uuid, text, integer);
DROP FUNCTION IF EXISTS public.match_ai_knowledge_semantic(uuid, text, integer);
DROP FUNCTION IF EXISTS public.update_ai_configs_updated_at();
DROP FUNCTION IF EXISTS public.update_ai_knowledge_documents_updated_at();
