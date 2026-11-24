-- ============================================================
-- Migration 064 — Final fix for accounts RLS policies
--
-- Issue: Previous migrations created policies with circular
-- dependencies. This migration replaces them with working policies.
-- ============================================================

-- Drop ALL existing policies on accounts
DROP POLICY IF EXISTS accounts_select ON accounts;
DROP POLICY IF EXISTS accounts_update ON accounts;
DROP POLICY IF EXISTS accounts_select_member ON accounts;
DROP POLICY IF EXISTS "Users can view own account" ON accounts;
DROP POLICY IF EXISTS "Users can update own account" ON accounts;
DROP POLICY IF EXISTS accounts_select_by_owner ON accounts;
DROP POLICY IF EXISTS accounts_select_by_membership ON accounts;
DROP POLICY IF EXISTS accounts_update_by_admin ON accounts;

-- Create simple, working policies
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
