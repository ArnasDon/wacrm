-- Check user roles and permissions
SELECT 
  u.id as user_id,
  u.email,
  p.account_id,
  p.account_role,
  a.name as account_name,
  a.owner_user_id,
  CASE 
    WHEN p.account_role = 'owner' THEN '✅ Owner (can do everything)'
    WHEN p.account_role = 'admin' THEN '✅ Admin (can manage settings)'
    WHEN p.account_role = 'agent' THEN '✅ Agent (can create flows)'
    WHEN p.account_role = 'viewer' THEN '⚠️ Viewer (read-only)'
    ELSE '❌ No role assigned'
  END as role_status
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
LEFT JOIN public.accounts a ON a.id = p.account_id
ORDER BY u.created_at DESC
LIMIT 5;

-- Check if flow_nodes table has proper permissions
SELECT 
  tablename,
  tableowner,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename IN ('flows', 'flow_nodes')
ORDER BY tablename;

-- Grant INSERT permissions for flows and flow_nodes
GRANT INSERT ON flow_nodes TO authenticated;
GRANT INSERT ON flow_run_events TO authenticated;
