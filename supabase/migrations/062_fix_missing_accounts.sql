-- ============================================================
-- Migration 062 — Fix missing accounts for authenticated users
--
-- Issue: Users who signed up successfully may not have gotten an
-- account created if the handle_new_user trigger failed silently.
-- This leaves them authenticated but unable to access any data due
-- to RLS policies requiring account membership.
--
-- Solution: Backfill missing accounts and profiles for any
-- authenticated users that don't have them.
-- ============================================================

DO $$
BEGIN
  -- Create accounts for users who don't have one yet
  INSERT INTO public.accounts (name, owner_user_id)
  SELECT 
    COALESCE(
      NULLIF(u.raw_user_meta_data->>'full_name', ''),
      u.email,
      'My account'
    ),
    u.id
  FROM auth.users u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.accounts a WHERE a.owner_user_id = u.id
  );

  -- Create or update profiles for users who don't have proper account linkage
  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  SELECT 
    u.id,
    COALESCE(u.raw_user_meta_data->>'full_name', ''),
    COALESCE(u.email, ''),
    a.id,
    'owner'::account_role_enum
  FROM auth.users u
  JOIN public.accounts a ON a.owner_user_id = u.id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = u.id
  )
  ON CONFLICT (user_id) DO UPDATE SET
    account_id = EXCLUDED.account_id,
    account_role = EXCLUDED.account_role
  WHERE profiles.account_id IS NULL OR profiles.account_role IS NULL;

  -- Update existing profiles that have missing account_id or account_role
  UPDATE public.profiles p
  SET 
    account_id = a.id,
    account_role = 'owner'::account_role_enum
  FROM public.accounts a
  WHERE a.owner_user_id = p.user_id
    AND (p.account_id IS NULL OR p.account_role IS NULL);

  RAISE NOTICE 'Migration 062: Fixed missing accounts and profiles';
END $$;
