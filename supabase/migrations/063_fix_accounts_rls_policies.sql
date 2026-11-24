-- ============================================================
-- Migration 063 — Fix accounts table RLS policies
--
-- Issue: The accounts_select policy uses is_account_member(id),
-- which creates a circular dependency:
--   - To read accounts, you need is_account_member()
--   - is_account_member() reads from profiles
--   - profiles contains account_id from accounts
--   - Circular dependency causes "permission denied"
--
-- Solution: Allow users to directly SELECT accounts where they
-- are the owner, without going through is_account_member().
-- This breaks the circular dependency.
-- ============================================================

-- Drop existing policies
DROP POLICY IF EXISTS accounts_select ON accounts;
DROP POLICY IF EXISTS accounts_update ON accounts;

-- Allow users to select their own account (by owner_user_id)
-- This avoids the circular dependency with is_account_member()
CREATE POLICY accounts_select ON accounts FOR SELECT
  USING (owner_user_id = auth.uid());

-- Allow admins to update account settings
-- Note: This still uses is_account_member, but UPDATE operations
-- happen AFTER the user has already loaded their account via SELECT
CREATE POLICY accounts_update ON accounts FOR UPDATE
  USING (is_account_member(id, 'admin'))
  WITH CHECK (is_account_member(id, 'admin'));

-- Also allow users to view accounts where they are members
-- This is for future multi-account support
CREATE POLICY accounts_select_member ON accounts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.account_id = accounts.id
        AND p.user_id = auth.uid()
    )
  );
