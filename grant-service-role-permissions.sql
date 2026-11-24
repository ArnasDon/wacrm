-- Grant permissions to service_role (used by server-side API routes)
-- The authenticated role is for client-side queries
-- The service_role is for server-side API routes

GRANT ALL ON accounts TO service_role;
GRANT ALL ON profiles TO service_role;
GRANT ALL ON contacts TO service_role;
GRANT ALL ON conversations TO service_role;
GRANT ALL ON messages TO service_role;
GRANT ALL ON whatsapp_config TO service_role;
GRANT ALL ON tags TO service_role;
GRANT ALL ON contact_tags TO service_role;
GRANT ALL ON custom_fields TO service_role;
GRANT ALL ON contact_custom_values TO service_role;
GRANT ALL ON contact_notes TO service_role;
GRANT ALL ON pipelines TO service_role;
GRANT ALL ON pipeline_stages TO service_role;
GRANT ALL ON deals TO service_role;
GRANT ALL ON broadcasts TO service_role;
GRANT ALL ON broadcast_recipients TO service_role;
GRANT ALL ON message_templates TO service_role;
GRANT ALL ON automations TO service_role;
GRANT ALL ON automation_steps TO service_role;
GRANT ALL ON automation_logs TO service_role;
GRANT ALL ON automation_pending_executions TO service_role;
GRANT ALL ON flows TO service_role;
GRANT ALL ON flow_nodes TO service_role;
GRANT ALL ON flow_runs TO service_role;
GRANT ALL ON flow_run_events TO service_role;
GRANT ALL ON member_presence TO service_role;
GRANT ALL ON account_invitations TO service_role;
GRANT ALL ON message_reactions TO service_role;
GRANT ALL ON api_keys TO service_role;
GRANT ALL ON notifications TO service_role;
GRANT ALL ON webhook_endpoints TO service_role;

-- Tables that might not exist yet
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_configurations') THEN
    GRANT ALL ON ai_configurations TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_knowledge_entries') THEN
    GRANT ALL ON ai_knowledge_entries TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_usage_logs') THEN
    GRANT ALL ON ai_usage_logs TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'webhook_deliveries') THEN
    GRANT ALL ON webhook_deliveries TO service_role;
  END IF;
END $$;

SELECT 'Granted ALL permissions to service_role' as status;
