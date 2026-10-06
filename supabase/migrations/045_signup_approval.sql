-- ============================================================
-- Migration 045: User Signup Approval System
--
-- Prevents unauthorized visitors from automatically creating new CRM
-- workspaces upon public sign-up.
--
-- 1. Adds approval_status column to profiles ('pending' | 'approved' | 'rejected')
--    Default is 'approved' for all existing team members.
-- 2. Makes profiles.account_id and account_role nullable for pending signups.
-- 3. Updates handle_new_user() trigger so public signups do NOT create
--    an accounts row automatically.
-- 4. Updates redeem_invitation() so invited teammates are immediately approved.
-- ============================================================

-- 1. Add approval_status to profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'approval_status'
  ) THEN
    ALTER TABLE public.profiles 
      ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'
      CHECK (approval_status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

-- 2. Make account_id and account_role nullable on profiles
ALTER TABLE public.profiles ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN account_role DROP NOT NULL;

-- 3. Replace handle_new_user() to prevent automatic account workspace creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  -- By default, new registrations require administrator approval.
  -- No accounts row is created.
  INSERT INTO public.profiles (user_id, full_name, email, approval_status, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, 'pending', NULL, NULL);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- 4. Ensure redeem_invitation stamps approval_status = 'approved'
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation already used' USING ERRCODE = '22023';
  END IF;

  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation expired' USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_old_account_id
  FROM profiles
  WHERE user_id = v_caller_id;

  IF v_old_account_id IS NOT NULL THEN
    SELECT owner_user_id INTO v_old_account_owner
    FROM accounts
    WHERE id = v_old_account_id;

    IF v_old_account_owner = v_caller_id THEN
      SELECT (
        EXISTS (SELECT 1 FROM contacts WHERE account_id = v_old_account_id) OR
        EXISTS (SELECT 1 FROM conversations WHERE account_id = v_old_account_id) OR
        EXISTS (SELECT 1 FROM pipelines WHERE account_id = v_old_account_id)
      ) INTO v_has_data;

      IF v_has_data THEN
        RAISE EXCEPTION 'Current account has data' USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  -- Join invited account and mark approved
  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role,
      approval_status = 'approved'
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  IF v_old_account_id IS NOT NULL AND v_old_account_owner = v_caller_id THEN
    DELETE FROM accounts WHERE id = v_old_account_id;
  END IF;

  RETURN v_inv.account_id;
END;
$$;

-- 5. Update remove_account_member to safely reuse existing personal account if one already exists
CREATE OR REPLACE FUNCTION public.remove_account_member(
  p_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
  v_target_name TEXT;
  v_target_email TEXT;
  v_new_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role, full_name, email
  INTO v_target_account_id, v_target_role, v_target_name, v_target_email
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  -- Reuse their existing personal account if one already exists, or spin up a fresh one
  SELECT id INTO v_new_account_id
  FROM accounts
  WHERE owner_user_id = p_user_id
  LIMIT 1;

  IF v_new_account_id IS NULL THEN
    INSERT INTO accounts (name, owner_user_id)
    VALUES (
      COALESCE(NULLIF(v_target_name, ''), v_target_email, 'My account'),
      p_user_id
    )
    RETURNING id INTO v_new_account_id;
  END IF;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner'
  WHERE user_id = p_user_id;

  RETURN v_new_account_id;
END;
$$;
