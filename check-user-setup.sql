-- Run this in Supabase SQL Editor to check user setup
-- Or via CLI: supabase db query --remote --file check-user-setup.sql

-- Check all users and their account setup
SELECT 
  u.id as user_id,
  u.email,
  p.account_id,
  p.account_role,
  a.name as account_name,
  a.owner_user_id,
  CASE 
    WHEN p.account_id IS NULL THEN '❌ Missing account_id in profile'
    WHEN p.account_role IS NULL THEN '❌ Missing account_role in profile'
    WHEN a.id IS NULL THEN '❌ Account not found'
    ELSE '✅ Setup complete'
  END as status
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
LEFT JOIN public.accounts a ON a.id = p.account_id
ORDER BY u.created_at DESC
LIMIT 10;

-- Count users by setup status
SELECT 
  COUNT(*) FILTER (WHERE p.account_id IS NULL) as users_missing_account_id,
  COUNT(*) FILTER (WHERE p.account_role IS NULL) as users_missing_account_role,
  COUNT(*) FILTER (WHERE p.account_id IS NOT NULL AND p.account_role IS NOT NULL AND a.id IS NOT NULL) as users_setup_complete,
  COUNT(*) as total_users
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
LEFT JOIN public.accounts a ON a.id = p.account_id;
