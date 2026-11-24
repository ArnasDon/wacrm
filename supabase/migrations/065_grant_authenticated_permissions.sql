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

-- Other tables
GRANT SELECT, INSERT, UPDATE, DELETE ON member_presence TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON account_invitations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON message_reactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_endpoints TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_deliveries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_configurations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_knowledge_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_usage_logs TO authenticated;

-- Note: RLS policies still control which rows users can actually access.
-- These grants just allow authenticated users to execute queries on the tables.
