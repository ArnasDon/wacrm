-- ============================================================
-- Migration 068: Fix Profile Creation on Signup
-- ============================================================
--
-- Issue: When users sign up and try to accept invitations, they get
-- "Caller has no profile" error. This happens because:
-- 1. handle_new_user trigger swallows exceptions silently
-- 2. Profile creation might fail due to RLS or permissions
-- 3. No recovery mechanism exists for missing profiles
--
-- Solution:
-- 1. Create a function users can call to bootstrap their profile
-- 2. Improve handle_new_user to be more robust
-- 3. Grant proper permissions for profile creation
--
-- ============================================================

-- First, ensure authenticated users can insert their own profiles
-- (they might not have this permission, causing silent failures)
GRANT INSERT ON profiles TO authenticated;
GRANT INSERT ON accounts TO authenticated;

-- Create a function that users can call to bootstrap their profile
-- if it's missing (useful for fixing already-broken accounts)
CREATE OR REPLACE FUNCTION public.ensure_user_profile()
RETURNS UUID  -- Returns the account_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_user_email TEXT;
  v_user_name TEXT;
  v_account_id UUID;
  v_existing_profile profiles%ROWTYPE;
BEGIN
  -- Must be authenticated
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Check if profile already exists
  SELECT * INTO v_existing_profile
  FROM profiles
  WHERE user_id = v_user_id;

  IF FOUND THEN
    -- Profile exists, return the account_id
    RETURN v_existing_profile.account_id;
  END IF;

  -- Profile doesn't exist - create it
  -- Get user metadata from auth.users
  SELECT email, raw_user_meta_data->>'full_name'
  INTO v_user_email, v_user_name
  FROM auth.users
  WHERE id = v_user_id;

  -- Create account first
  INSERT INTO accounts (name, owner_user_id)
  VALUES (
    COALESCE(NULLIF(v_user_name, ''), v_user_email, 'My Account'),
    v_user_id
  )
  RETURNING id INTO v_account_id;

  -- Create profile
  INSERT INTO profiles (user_id, full_name, email, account_id, account_role)
  VALUES (
    v_user_id,
    COALESCE(v_user_name, ''),
    v_user_email,
    v_account_id,
    'owner'
  );

  RETURN v_account_id;
END;
$$;

ALTER FUNCTION public.ensure_user_profile() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.ensure_user_profile() TO authenticated;

COMMENT ON FUNCTION public.ensure_user_profile() IS 
  'Creates profile and account for the current user if missing. Idempotent - safe to call multiple times.';

-- Improve handle_new_user to be more explicit about failures
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  -- Create account
  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  -- Create profile
  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log the actual error so we can debug
  RAISE WARNING 'Failed to bootstrap account/profile for user % (email: %): % (SQLSTATE: %)', 
    NEW.id, NEW.email, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- Update redeem_invitation to auto-create profile if missing
-- (defensive programming - shouldn't happen but handles the edge case)
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
  v_has_other_members BOOLEAN;
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
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  -- Try to get profile - if missing, create it first
  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  -- If profile doesn't exist, create it now
  IF v_old_account_id IS NULL THEN
    -- Call ensure_user_profile to create the missing profile
    v_old_account_id := ensure_user_profile();
    
    -- Re-fetch to get the owner info
    SELECT a.owner_user_id
    INTO v_old_account_owner
    FROM accounts a
    WHERE a.id = v_old_account_id
    FOR UPDATE OF a;
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role,
      updated_at = NOW()
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by = v_caller_id
  WHERE token_hash = p_token_hash;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

-- Backfill: Fix any existing users who are missing profiles
-- (this handles users who signed up before this fix)
DO $$
DECLARE
  v_user RECORD;
  v_account_id UUID;
BEGIN
  FOR v_user IN 
    SELECT u.id, u.email, u.raw_user_meta_data->>'full_name' as full_name
    FROM auth.users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE p.user_id IS NULL
  LOOP
    -- Create account
    INSERT INTO accounts (name, owner_user_id)
    VALUES (
      COALESCE(NULLIF(v_user.full_name, ''), v_user.email, 'My Account'),
      v_user.id
    )
    RETURNING id INTO v_account_id;

    -- Create profile
    INSERT INTO profiles (user_id, full_name, email, account_id, account_role)
    VALUES (
      v_user.id,
      COALESCE(v_user.full_name, ''),
      v_user.email,
      v_account_id,
      'owner'
    );

    RAISE NOTICE 'Created profile and account for user % (email: %)', v_user.id, v_user.email;
  END LOOP;
END $$;
