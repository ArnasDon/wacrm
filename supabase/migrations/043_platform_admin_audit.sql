-- ============================================================
-- 043_platform_admin_audit.sql — audit trail + owner contact field
-- for the platform admin panel's write actions (Phase 1 continued)
--
-- /painel-plataforma is about to gain WRITE power over any store on
-- the deployment (edit store/account details, reset passwords,
-- remove sellers, delete a whole store) — until now it only ever
-- read data + flipped organizations.status. Every one of those new
-- writes goes through a dedicated /api/platform/* route using the
-- service-role client (never a broad RLS write grant — same model
-- migrations 041/042 already established), and every one of them
-- records a row here so a destructive action taken by mistake can
-- actually be investigated afterward.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_admin_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_log_admin
  ON platform_admin_audit_log(admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_log_target
  ON platform_admin_audit_log(target_type, target_id);

ALTER TABLE platform_admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Read-only for platform admins, exactly like every cross-account
-- grant in migration 042. No INSERT/UPDATE/DELETE policy at all —
-- every /api/platform/* route writes through the service-role
-- client, which bypasses RLS entirely by design; there is
-- deliberately no path for a client-side write to this table.
DROP POLICY IF EXISTS platform_admin_audit_log_select ON platform_admin_audit_log;
CREATE POLICY platform_admin_audit_log_select ON platform_admin_audit_log FOR SELECT USING (
  is_platform_admin()
);

-- ============================================================
-- profiles.phone — optional contact number for a store owner or
-- seller. Nothing in the signup or invite flow collects this yet;
-- it exists so the platform admin panel has somewhere to store one
-- when support needs it. NULL for every existing row.
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone TEXT;
