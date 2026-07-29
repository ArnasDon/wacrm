-- ============================================================
-- 044_billing_foundation.sql — schema foundation for billing
-- (Asaas), NOT the integration itself
--
-- The platform operator plans to eventually charge stores a monthly
-- fee via Asaas, but decided not to wire that up yet. This migration
-- only adds the columns a future billing integration will need —
-- see src/lib/billing/README.md for exactly where that integration
-- will plug in later.
--
-- IMPORTANT — these columns are NOT read by any access-control rule
-- yet. `organizations.status` (migration 042: 'active'/'suspended')
-- remains the ONLY column that blocks a member's access today —
-- is_account_member() and is_organization_suspended() (042) don't
-- know these new columns exist. Nothing about login, RLS, or the
-- suspended-organization screen changes because of this migration.
-- When billing is actually wired up later, the natural design is for
-- a `past_due`/`canceled` billing_status to eventually flip
-- `organizations.status` to 'suspended' (via the same admin-route
-- pattern already used for manual suspension) — not to duplicate a
-- second, parallel access-control check on billing_status directly.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'trial'
    CHECK (billing_status IN ('trial', 'active', 'past_due', 'canceled'));

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plan TEXT;
