-- ============================================================
-- Verify and Fix RLS Policies for accounts table
-- ============================================================

-- Step 1: Check current policies on accounts table
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'accounts';

-- Step 2: Drop ALL existing policies on accounts
DROP POLICY IF EXISTS accounts_select ON accounts;
DROP POLICY IF EXISTS accounts_update ON accounts;
DROP POLICY IF EXISTS accounts_select_member ON accounts;
DROP POLICY IF EXISTS "Users can view own account" ON accounts;
DROP POLICY IF EXISTS "Users can update own account" ON accounts;

-- Step 3: Create simple, working policies
-- Allow users to select accounts where they are the owner
CREATE POLICY accounts_select_by_owner ON accounts 
  FOR SELECT 
  USING (owner_user_id = auth.uid());

-- Allow users to select accounts where they are members (via profiles)
CREATE POLICY accounts_select_by_membership ON accounts 
  FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.account_id = accounts.id 
        AND profiles.user_id = auth.uid()
    )
  );

-- Allow account admins to update (requires account membership with admin role)
CREATE POLICY accounts_update_by_admin ON accounts 
  FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.account_id = accounts.id 
        AND profiles.user_id = auth.uid()
        AND profiles.account_role IN ('owner', 'admin')
    )
  );

-- Step 4: Verify new policies were created
SELECT 
  policyname,
  cmd,
  CASE 
    WHEN qual IS NOT NULL THEN 'Has USING clause'
    ELSE 'No USING clause'
  END as using_clause,
  CASE 
    WHEN with_check IS NOT NULL THEN 'Has WITH CHECK clause'
    ELSE 'No WITH CHECK clause'
  END as with_check_clause
FROM pg_policies 
WHERE tablename = 'accounts'
ORDER BY policyname;

-- Step 5: Test if the current user can see accounts
-- (This will only work if run as an authenticated user)
SELECT COUNT(*) as account_count FROM accounts;
