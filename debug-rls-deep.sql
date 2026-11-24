-- ============================================================
-- Deep RLS Debugging for accounts table
-- ============================================================

-- 1. Check if RLS is enabled on accounts
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename = 'accounts';

-- 2. Check all policies on accounts with their definitions
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual::text as using_expression,
  with_check::text as with_check_expression
FROM pg_policies 
WHERE tablename = 'accounts';

-- 3. Check if profiles table has proper data
SELECT 
  p.user_id,
  p.account_id,
  p.account_role,
  a.id as account_exists,
  a.owner_user_id,
  CASE 
    WHEN a.owner_user_id = p.user_id THEN '✅ User owns this account'
    ELSE '❌ User does not own this account'
  END as ownership_status
FROM profiles p
LEFT JOIN accounts a ON a.id = p.account_id
LIMIT 5;

-- 4. Test the policy conditions manually
-- Check if any user can see their account via owner_user_id
SELECT 
  COUNT(*) as accounts_with_owner,
  COUNT(DISTINCT owner_user_id) as unique_owners
FROM accounts;

-- 5. Grant explicit SELECT permission to authenticated role (bypass RLS test)
GRANT SELECT ON accounts TO authenticated;
GRANT SELECT ON profiles TO authenticated;
GRANT SELECT ON contacts TO authenticated;
GRANT SELECT ON conversations TO authenticated;
GRANT SELECT ON messages TO authenticated;
GRANT SELECT ON whatsapp_config TO authenticated;
GRANT SELECT ON tags TO authenticated;
GRANT SELECT ON custom_fields TO authenticated;
GRANT SELECT ON contact_notes TO authenticated;
GRANT SELECT ON pipelines TO authenticated;
GRANT SELECT ON pipeline_stages TO authenticated;
GRANT SELECT ON deals TO authenticated;
GRANT SELECT ON broadcasts TO authenticated;
GRANT SELECT ON broadcast_recipients TO authenticated;
GRANT SELECT ON message_templates TO authenticated;
GRANT SELECT ON automations TO authenticated;
GRANT SELECT ON automation_steps TO authenticated;
GRANT SELECT ON automation_logs TO authenticated;
GRANT SELECT ON flows TO authenticated;
GRANT SELECT ON flow_nodes TO authenticated;
GRANT SELECT ON flow_runs TO authenticated;
GRANT SELECT ON member_presence TO authenticated;

SELECT 'Granted SELECT permissions to authenticated role' as status;
