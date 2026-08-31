-- ============================================================
-- 037_platform_admin.sql — Platform-admin foundation
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_platform_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid());
$$;
ALTER FUNCTION is_platform_admin() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_platform_admin() TO authenticated, service_role;

-- Platform admins can read the platform_admins table
CREATE POLICY platform_admins_select ON platform_admins FOR SELECT
  USING (is_platform_admin());
