-- Subscription suspension, isolated from the platform-admin migration.
-- A suspended company keeps read access to its own accounts row so the UI can
-- explain the state, while all business-data policies fail closed through
-- is_account_member().

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

CREATE OR REPLACE FUNCTION public.is_account_identity_member(
  target_account_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
  );
$$;

ALTER FUNCTION public.is_account_identity_member(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_account_identity_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_account_identity_member(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_account_identity_member(UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.accounts a ON a.id = p.account_id
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND a.suspended_at IS NULL
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

ALTER FUNCTION public.is_account_member(UUID, account_role_enum) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_account_member(UUID, account_role_enum)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_account_member(UUID, account_role_enum)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.is_account_member(UUID, account_role_enum)
  TO authenticated, service_role;

DROP POLICY IF EXISTS accounts_select ON public.accounts;
CREATE POLICY accounts_select ON public.accounts FOR SELECT
  USING (public.is_account_identity_member(id));

COMMENT ON COLUMN public.accounts.suspended_at IS
  'NULL when active; set by a platform administrator to block tenant business data.';
COMMENT ON COLUMN public.accounts.suspended_reason IS
  'Operator-facing reason shown to the suspended company; not a billing model.';
