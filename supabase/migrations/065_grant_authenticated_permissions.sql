-- ============================================================
-- Migration 065 — Grant table permissions to authenticated role
--
-- Issue: RLS policies control row-level access, but we also need
-- to grant base table permissions (SELECT, INSERT, UPDATE, DELETE)
-- to the authenticated role. Without these grants, users get
-- "permission denied" errors even with correct RLS policies.
-- ============================================================

-- Core tables
GRANT SELECT, INSERT, UPDATE, DELETE ON accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON contact_tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON custom_fields TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON contact_custom_values TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON contact_notes TO authenticated;

-- Pipeline tables
GRANT SELECT, INSERT, UPDATE, DELETE ON pipelines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON pipeline_stages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON deals TO authenticated;

-- Broadcast tables
GRANT SELECT, INSERT, UPDATE, DELETE ON broadcasts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON broadcast_recipients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON message_templates TO authenticated;

-- Automation tables
GRANT SELECT, INSERT, UPDATE, DELETE ON automations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON automation_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON automation_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON automation_pending_executions TO authenticated;

-- Flow tables
GRANT SELECT, INSERT, UPDATE, DELETE ON flows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON flow_nodes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON flow_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON flow_run_events TO authenticated;

-- Other tables (only grant if they exist)
DO $$
BEGIN
  -- Tables that should exist
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'member_presence') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON member_presence TO authenticated;
  END IF;
  
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'account_invitations') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON account_invitations TO authenticated;
  END IF;
  
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'message_reactions') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON message_reactions TO authenticated;
  END IF;
  
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'api_keys') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys TO authenticated;
  END IF;
  
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'notifications') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO authenticated;
  END IF;
  
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'webhook_endpoints') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_endpoints TO authenticated;
  END IF;
  
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'webhook_deliveries') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_deliveries TO authenticated;
  END IF;
  
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_configurations') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ai_configurations TO authenticated;
  END IF;
  
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_configs') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ai_configs TO authenticated;
  END IF;
  
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_knowledge_entries') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ai_knowledge_entries TO authenticated;
  END IF;
  
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_knowledge_documents') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ai_knowledge_documents TO authenticated;
  END IF;
  
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_knowledge_chunks') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ai_knowledge_chunks TO authenticated;
  END IF;
  
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_usage_logs') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ai_usage_logs TO authenticated;
  END IF;
  
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_usage_log') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ai_usage_log TO authenticated;
  END IF;
  
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'quick_replies') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON quick_replies TO authenticated;
  END IF;
END $$;

-- Note: RLS policies still control which rows users can actually access.
-- These grants just allow authenticated users to execute queries on the tables.
