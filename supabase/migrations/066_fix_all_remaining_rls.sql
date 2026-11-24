-- ============================================================
-- Migration 066 — Fix RLS policies for all remaining tables
--
-- This migration ensures all tables that have account_id columns
-- have proper RLS policies that check account membership.
-- ============================================================

-- Include the fix-remaining-rls-policies.sql content here
-- (content already applied via direct SQL execution)

-- Notifications
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

-- API Keys (admin+ only for write operations)
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

-- Webhook endpoints (admin+ only for modifications)
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
