-- ============================================================
-- Fix RLS policies for remaining tables
-- ============================================================

-- Notifications table policies
DROP POLICY IF EXISTS notifications_select ON notifications;
DROP POLICY IF EXISTS notifications_insert ON notifications;
DROP POLICY IF EXISTS notifications_update ON notifications;
DROP POLICY IF EXISTS notifications_delete ON notifications;

CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_id = notifications.account_id
    )
  );

CREATE POLICY notifications_insert ON notifications FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_id = notifications.account_id
    )
  );

CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_id = notifications.account_id
    )
  );

CREATE POLICY notifications_delete ON notifications FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_id = notifications.account_id
    )
  );

-- API Keys table policies (admin only)
DROP POLICY IF EXISTS api_keys_select ON api_keys;
DROP POLICY IF EXISTS api_keys_insert ON api_keys;
DROP POLICY IF EXISTS api_keys_update ON api_keys;
DROP POLICY IF EXISTS api_keys_delete ON api_keys;

CREATE POLICY api_keys_select ON api_keys FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_id = api_keys.account_id
    )
  );

CREATE POLICY api_keys_insert ON api_keys FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_id = api_keys.account_id
        AND profiles.account_role IN ('owner', 'admin')
    )
  );

CREATE POLICY api_keys_update ON api_keys FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_id = api_keys.account_id
        AND profiles.account_role IN ('owner', 'admin')
    )
  );

CREATE POLICY api_keys_delete ON api_keys FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_id = api_keys.account_id
        AND profiles.account_role IN ('owner', 'admin')
    )
  );

-- Webhook endpoints policies (admin only)
DROP POLICY IF EXISTS webhook_endpoints_select ON webhook_endpoints;
DROP POLICY IF EXISTS webhook_endpoints_insert ON webhook_endpoints;
DROP POLICY IF EXISTS webhook_endpoints_update ON webhook_endpoints;
DROP POLICY IF EXISTS webhook_endpoints_delete ON webhook_endpoints;

CREATE POLICY webhook_endpoints_select ON webhook_endpoints FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_id = webhook_endpoints.account_id
    )
  );

CREATE POLICY webhook_endpoints_insert ON webhook_endpoints FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_id = webhook_endpoints.account_id
        AND profiles.account_role IN ('owner', 'admin')
    )
  );

CREATE POLICY webhook_endpoints_update ON webhook_endpoints FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_id = webhook_endpoints.account_id
        AND profiles.account_role IN ('owner', 'admin')
    )
  );

CREATE POLICY webhook_endpoints_delete ON webhook_endpoints FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_id = webhook_endpoints.account_id
        AND profiles.account_role IN ('owner', 'admin')
    )
  );

-- Check AI tables and add policies if they exist
DO $$
BEGIN
  -- AI configurations
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ai_configurations') THEN
    DROP POLICY IF EXISTS ai_configurations_select ON ai_configurations;
    DROP POLICY IF EXISTS ai_configurations_insert ON ai_configurations;
    DROP POLICY IF EXISTS ai_configurations_update ON ai_configurations;
    DROP POLICY IF EXISTS ai_configurations_delete ON ai_configurations;
    
    EXECUTE 'CREATE POLICY ai_configurations_select ON ai_configurations FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.user_id = auth.uid()
            AND profiles.account_id = ai_configurations.account_id
        )
      )';
    
    EXECUTE 'CREATE POLICY ai_configurations_insert ON ai_configurations FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.user_id = auth.uid()
            AND profiles.account_id = ai_configurations.account_id
            AND profiles.account_role IN (''owner'', ''admin'')
        )
      )';
    
    EXECUTE 'CREATE POLICY ai_configurations_update ON ai_configurations FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.user_id = auth.uid()
            AND profiles.account_id = ai_configurations.account_id
            AND profiles.account_role IN (''owner'', ''admin'')
        )
      )';
  END IF;
  
  -- AI knowledge entries
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ai_knowledge_entries') THEN
    DROP POLICY IF EXISTS ai_knowledge_entries_select ON ai_knowledge_entries;
    DROP POLICY IF EXISTS ai_knowledge_entries_insert ON ai_knowledge_entries;
    DROP POLICY IF EXISTS ai_knowledge_entries_update ON ai_knowledge_entries;
    DROP POLICY IF EXISTS ai_knowledge_entries_delete ON ai_knowledge_entries;
    
    EXECUTE 'CREATE POLICY ai_knowledge_entries_select ON ai_knowledge_entries FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.user_id = auth.uid()
            AND profiles.account_id = ai_knowledge_entries.account_id
        )
      )';
    
    EXECUTE 'CREATE POLICY ai_knowledge_entries_insert ON ai_knowledge_entries FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.user_id = auth.uid()
            AND profiles.account_id = ai_knowledge_entries.account_id
            AND profiles.account_role IN (''owner'', ''admin'', ''agent'')
        )
      )';
    
    EXECUTE 'CREATE POLICY ai_knowledge_entries_update ON ai_knowledge_entries FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.user_id = auth.uid()
            AND profiles.account_id = ai_knowledge_entries.account_id
            AND profiles.account_role IN (''owner'', ''admin'', ''agent'')
        )
      )';
    
    EXECUTE 'CREATE POLICY ai_knowledge_entries_delete ON ai_knowledge_entries FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.user_id = auth.uid()
            AND profiles.account_id = ai_knowledge_entries.account_id
            AND profiles.account_role IN (''owner'', ''admin'', ''agent'')
        )
      )';
  END IF;
  
  -- AI usage logs
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ai_usage_logs') THEN
    DROP POLICY IF EXISTS ai_usage_logs_select ON ai_usage_logs;
    DROP POLICY IF EXISTS ai_usage_logs_insert ON ai_usage_logs;
    
    EXECUTE 'CREATE POLICY ai_usage_logs_select ON ai_usage_logs FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.user_id = auth.uid()
            AND profiles.account_id = ai_usage_logs.account_id
        )
      )';
    
    -- Insert is service-role only (via AI backend)
  END IF;
END $$;

SELECT 'Fixed RLS policies for notifications, api_keys, webhook_endpoints, and AI tables' as status;
