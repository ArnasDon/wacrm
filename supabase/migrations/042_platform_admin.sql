-- ============================================================
-- 042_platform_admin.sql — Platform admin (SaaS foundation, Phase 1)
--
-- The wacrm operator is starting to resell this CRM to unrelated
-- stores, each paying a flat monthly fee (billing itself is a later
-- phase — this migration only adds the "see and manage every store"
-- foundation). This is a NEW, separate privilege axis, one level above
-- an organization's own owner (migration 041):
--
--   account_role      — per-account (owner/admin/agent/viewer).
--   organization owner — one step up: sees their OWN store + its
--                        linked seller accounts (migration 041).
--   platform admin     — one step further up: sees EVERY account/
--                        organization on the whole deployment, across
--                        completely unrelated stores.
--
-- Nobody is a platform admin by default. The very first one must be
-- inserted by hand via SQL after this migration runs (there is
-- deliberately no self-promotion path anywhere in the app) — see the
-- deploy notes in the PR/commit this ships in.
--
-- This migration is purely additive:
--   - platform_admins starts empty, so is_platform_admin() returns
--     false for everyone until a row is inserted by hand.
--   - organizations.status defaults to 'active', so every existing
--     organization (and every independent, non-organization account,
--     which never reads this column at all) is completely unaffected.
--   - is_account_member() gains one extra AND'ed condition that is
--     trivially true for all data that exists today.
--
-- Security model
--   - Platform admins get READ-ONLY cross-account/cross-organization
--     RLS grants (accounts, organizations, conversations, contacts,
--     messages) — mirroring is_organization_owner's _org_select
--     policies from migration 041, just unconditional on organization
--     instead of scoped to one. No INSERT/UPDATE/DELETE policy is
--     added anywhere for platform admins — every privileged write
--     (creating a store, suspending an organization) goes through a
--     dedicated, auditable API route using the service-role client,
--     never a broad RLS write grant.
--   - platform_admins itself has no INSERT/UPDATE/DELETE policy at
--     all — the only way onto (or off) that table is a manual SQL
--     statement run by whoever operates the database. Its one SELECT
--     policy only ever lets a user see their OWN row (so any signed-in
--     user can cheaply self-check "am I a platform admin", without the
--     table ever revealing the full admin roster to anyone but that
--     query returning their own membership check).
--   - Suspending an organization (organizations.status = 'suspended')
--     blocks read+write access for every one of its member accounts —
--     enforced centrally in is_account_member(), which every existing
--     business-table policy already calls, so this one change reaches
--     every table without touching each policy individually. Platform
--     admins are NOT routed through is_account_member() at all for
--     this — their cross-account access always comes from the
--     dedicated _platform_select policies below, which are
--     unconditional on suspension, satisfying "the platform admin can
--     always get in to investigate."
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

-- Self-check only — never exposes the full admin roster to a caller
-- who isn't already in the table.
DROP POLICY IF EXISTS platform_admins_select_self ON platform_admins;
CREATE POLICY platform_admins_select_self ON platform_admins FOR SELECT USING (
  user_id = auth.uid()
);

-- ============================================================
-- is_platform_admin()
--
-- SECURITY DEFINER for the same reason is_account_member() /
-- is_organization_owner() are — policies need to read platform_admins
-- without recursive RLS evaluation.
-- ============================================================
CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform_admins WHERE user_id = auth.uid()
  );
$$;

ALTER FUNCTION is_platform_admin() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_platform_admin() TO authenticated, service_role;

-- ============================================================
-- organizations.status — active by default. A suspended organization
-- blocks its members (see is_account_member() below); only a platform
-- admin can flip this, via a dedicated API route (never a client-
-- writable RLS policy — see the security model note above).
-- ============================================================
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended'));

-- ============================================================
-- is_organization_suspended(target_account_id)
--
-- True iff target_account_id belongs to an organization (as the
-- store account itself OR one of its linked sellers) whose status is
-- 'suspended'. False for any account with organization_id IS NULL
-- (every independent, non-organization account — unaffected by this
-- feature, exactly as before this migration).
-- ============================================================
CREATE OR REPLACE FUNCTION is_organization_suspended(target_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM accounts a
    JOIN organizations o ON o.id = a.organization_id
    WHERE a.id = target_account_id
      AND o.status = 'suspended'
  );
$$;

ALTER FUNCTION is_organization_suspended(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_organization_suspended(UUID) TO authenticated, service_role;

-- ============================================================
-- my_account_suspended()
--
-- Callable by any authenticated user to honestly check whether THEIR
-- OWN account is currently blocked — independent of whatever RLS
-- already hides from them (accounts_select itself is gated by
-- is_account_member(), so a suspended member can no longer read their
-- own accounts row; this function bypasses that via SECURITY DEFINER
-- so the app can show a clear "access suspended" message instead of
-- data just silently disappearing). Platform admins always get false
-- here — they must always be able to sign in to investigate, even in
-- the edge case where their own account happens to sit inside a
-- suspended organization.
-- ============================================================
CREATE OR REPLACE FUNCTION my_account_suspended()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN is_platform_admin() THEN false
    ELSE COALESCE(
      (
        SELECT is_organization_suspended(p.account_id)
        FROM profiles p
        WHERE p.user_id = auth.uid()
      ),
      false
    )
  END;
$$;

ALTER FUNCTION my_account_suspended() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION my_account_suspended() TO authenticated, service_role;

-- ============================================================
-- is_account_member() — add the suspension gate.
--
-- Identical body to migration 017's definition, plus one AND'ed
-- condition. Every policy on every business table already calls this
-- function (for both read and write), so this one redefinition blocks
-- a suspended organization's members everywhere at once, without
-- editing each table's policies individually. Trivially true (i.e. a
-- no-op) for every account that exists today, since
-- is_organization_suspended() only ever returns true for an
-- organization explicitly set to 'suspended' — none exist yet.
--
-- Deliberately does NOT special-case platform admins here — their
-- cross-account access is granted separately below via
-- unconditional _platform_select policies, never by widening this
-- membership check (which also gates WRITE policies elsewhere; a
-- platform admin bypassing THIS function would silently grant them
-- write access to every account's operational data through ordinary
-- CRUD RLS, which the security model above explicitly rules out).
-- ============================================================
CREATE OR REPLACE FUNCTION is_account_member(
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
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND NOT is_organization_suspended(target_account_id)
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

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

-- ============================================================
-- RLS — platform-admin cross-account SELECT grants
--
-- Additive, same shape as migration 041's _org_select policies:
-- Postgres ORs multiple permissive policies together, so every
-- existing policy on these tables (is_account_member-based,
-- is_organization_owner-based) keeps working unchanged for everyone
-- who isn't a platform admin. is_platform_admin() is unconditional —
-- no organization/account scoping — by design: a platform admin can
-- read literally any store's data on the deployment.
-- ============================================================
DROP POLICY IF EXISTS accounts_platform_select ON accounts;
CREATE POLICY accounts_platform_select ON accounts FOR SELECT USING (
  is_platform_admin()
);

DROP POLICY IF EXISTS organizations_platform_select ON organizations;
CREATE POLICY organizations_platform_select ON organizations FOR SELECT USING (
  is_platform_admin()
);

DROP POLICY IF EXISTS conversations_platform_select ON conversations;
CREATE POLICY conversations_platform_select ON conversations FOR SELECT USING (
  is_platform_admin()
);

DROP POLICY IF EXISTS contacts_platform_select ON contacts;
CREATE POLICY contacts_platform_select ON contacts FOR SELECT USING (
  is_platform_admin()
);

DROP POLICY IF EXISTS messages_platform_select ON messages;
CREATE POLICY messages_platform_select ON messages FOR SELECT USING (
  is_platform_admin()
);
