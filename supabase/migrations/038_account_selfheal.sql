-- ============================================================
-- 038 — Account link self-heal
--
-- Problem this fixes
-- ------------------
-- `handle_new_user` (001, replaced in 017) deliberately swallows
-- every exception so a failed bootstrap never blocks signup. The
-- flip side: any failure (partially applied migrations, a manual
-- user created from the Supabase dashboard, a race on the
-- one-account-per-owner unique index, the trigger simply missing
-- on the instance) leaves an auth.users row with no profile — or a
-- profile with account_id NULL. Every account-scoped API then
-- rejects the user with "Your profile is not linked to an
-- account." and WhatsApp connection is impossible.
--
-- What this migration does
--   1. Backfills a profile + personal account for every existing
--      auth user that is missing either (same convergence logic as
--      017's backfill, re-run keyed off auth.users).
--   2. Re-creates `handle_new_user` conflict-safe: it reuses an
--      account the user already owns and upserts the profile, so a
--      partially-bootstrapped user converges instead of erroring.
--   3. Re-creates the `on_auth_user_created` trigger in case it was
--      dropped or never installed on this instance.
--   4. Adds `ensure_account_for_current_user()` — a SECURITY DEFINER
--      RPC the app calls at runtime to repair the caller's own link
--      on demand. This heals users even when this migration file is
--      applied *before* their bootstrap breaks again for any reason.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- (1) Backfill: every auth user gets a profile and an account.
-- ------------------------------------------------------------
DO $$
BEGIN
  -- Profiles for auth users that have none (trigger failed entirely).
  -- full_name / email are NOT NULL on profiles, hence the COALESCEs.
  INSERT INTO public.profiles (user_id, full_name, email)
  SELECT u.id,
         COALESCE(u.raw_user_meta_data->>'full_name', ''),
         COALESCE(u.email, '')
  FROM auth.users u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = u.id
  );

  -- Personal account for every profile owner that doesn't have one.
  INSERT INTO public.accounts (name, owner_user_id)
  SELECT COALESCE(NULLIF(p.full_name, ''), NULLIF(p.email, ''), 'My account'),
         p.user_id
  FROM public.profiles p
  WHERE p.account_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.accounts a WHERE a.owner_user_id = p.user_id
    );

  -- Stamp the link for any profile still unlinked.
  UPDATE public.profiles p
  SET account_id   = a.id,
      account_role = COALESCE(p.account_role, 'owner')
  FROM public.accounts a
  WHERE a.owner_user_id = p.user_id
    AND p.account_id IS NULL;
END $$;

-- 017 skips its SET NOT NULL when orphans exist; now that the
-- backfill above has converged, try again (no-op where already set,
-- skipped with a notice if this instance still has orphaned rows we
-- can't see — never aborts the migration).
DO $$
BEGIN
  ALTER TABLE public.profiles ALTER COLUMN account_id   SET NOT NULL;
  ALTER TABLE public.profiles ALTER COLUMN account_role SET NOT NULL;
EXCEPTION WHEN not_null_violation OR check_violation THEN
  RAISE NOTICE 'profiles.account_id still contains NULLs; leaving column nullable';
END $$;

-- ------------------------------------------------------------
-- (2) + (3) Conflict-safe signup trigger, recreated.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

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

  -- Reuse an account this user already owns (retried signup, manual
  -- fix-ups); create one otherwise. ON CONFLICT covers the race where
  -- two inserts for the same user land together.
  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  ON CONFLICT (owner_user_id) DO NOTHING;

  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE owner_user_id = NEW.id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, COALESCE(NEW.email, ''), v_account_id, 'owner')
  ON CONFLICT (user_id) DO UPDATE
    SET account_id   = COALESCE(public.profiles.account_id, EXCLUDED.account_id),
        account_role = COALESCE(public.profiles.account_role, EXCLUDED.account_role);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the auth insert — the runtime RPC below is the
  -- recovery path when this bootstrap fails.
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------
-- (4) Runtime self-heal RPC.
--
-- Called by the app (server routes and the AuthProvider) whenever it
-- finds the caller's profile missing or unlinked. SECURITY DEFINER
-- because the caller can't insert an accounts row (no INSERT policy
-- by design) nor update profiles.account_id under RLS. Scope safety:
-- it only ever touches rows keyed to auth.uid(), and it never
-- re-points a profile that already has an account (so it can't be
-- used to hop accounts or escalate a role).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_account_for_current_user()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_account_id UUID;
  v_full_name TEXT;
  v_email TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ensure_account_for_current_user: not authenticated';
  END IF;

  -- Already linked → nothing to do.
  SELECT account_id INTO v_account_id
  FROM public.profiles
  WHERE user_id = v_uid;
  IF v_account_id IS NOT NULL THEN
    RETURN v_account_id;
  END IF;

  SELECT COALESCE(u.raw_user_meta_data->>'full_name', ''),
         COALESCE(u.email, '')
  INTO v_full_name, v_email
  FROM auth.users u
  WHERE u.id = v_uid;

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NULLIF(v_email, ''), 'My account'), v_uid)
  ON CONFLICT (owner_user_id) DO NOTHING;

  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE owner_user_id = v_uid;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (v_uid, v_full_name, v_email, v_account_id, 'owner')
  ON CONFLICT (user_id) DO UPDATE
    SET account_id   = COALESCE(public.profiles.account_id, EXCLUDED.account_id),
        account_role = COALESCE(public.profiles.account_role, EXCLUDED.account_role);

  RETURN v_account_id;
END;
$$;

ALTER FUNCTION public.ensure_account_for_current_user() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.ensure_account_for_current_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_account_for_current_user() FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_account_for_current_user() TO authenticated;
