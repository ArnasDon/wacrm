-- Platform administration for Chat Sandía.
-- Intentionally grants visibility only into companies and profiles;
-- business data remains isolated by the existing tenant RLS policies.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_platform_admin = true
  );
$$;

ALTER FUNCTION public.is_platform_admin() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;

DROP POLICY IF EXISTS platform_admin_accounts_select ON public.accounts;
CREATE POLICY platform_admin_accounts_select ON public.accounts FOR SELECT
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS platform_admin_profiles_select ON public.profiles;
CREATE POLICY platform_admin_profiles_select ON public.profiles FOR SELECT
  USING (public.is_platform_admin());

CREATE TABLE IF NOT EXISTS public.platform_company_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name TEXT NOT NULL CHECK (length(btrim(company_name)) > 0),
  invited_email TEXT NOT NULL CHECK (length(btrim(invited_email)) > 0),
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_company_invites_pending_email
  ON public.platform_company_invitations (lower(invited_email))
  WHERE accepted_at IS NULL;

ALTER TABLE public.platform_company_invitations ENABLE ROW LEVEL SECURITY;

-- New Supabase projects no longer expose public tables to the Data API by
-- default. This table is accessed only by trusted server routes.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.platform_company_invitations TO service_role;

DROP POLICY IF EXISTS platform_company_invitations_admin_all
  ON public.platform_company_invitations;
CREATE POLICY platform_company_invitations_admin_all
  ON public.platform_company_invitations FOR ALL
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
  v_invitation public.platform_company_invitations%ROWTYPE;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  SELECT * INTO v_invitation
  FROM public.platform_company_invitations
  WHERE lower(invited_email) = lower(COALESCE(NEW.email, ''))
    AND accepted_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (
    CASE WHEN v_invitation.id IS NOT NULL
      THEN v_invitation.company_name
      ELSE COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account')
    END,
    NEW.id
  )
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (
    user_id, full_name, email, account_id, account_role
  ) VALUES (
    NEW.id, v_full_name, NEW.email, v_account_id, 'owner'
  );

  IF v_invitation.id IS NOT NULL THEN
    UPDATE public.platform_company_invitations
    SET accepted_at = now(), account_id = v_account_id
    WHERE id = v_invitation.id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
