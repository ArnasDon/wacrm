-- ============================================================
-- 041_organizations.sql — Multi-account organizations (store + sellers)
--
-- Adds an OPTIONAL layer on top of the existing single-account model
-- (migration 017): a group of independent `accounts` that all belong
-- to one "store" account, whose owner can read (never write) across
-- every account in the group from one login. Every account that never
-- opts into this (organization_id stays NULL) behaves identically to
-- today — this is additive, not a replacement for the account model.
--
-- Model
--   organizations: one row per store. `owner_account_id` is the
--   "mãe" account — the one whose owner sees the consolidated view.
--
--   accounts.organization_id: nullable FK. NULL = independent account
--   (today's behavior, unchanged). Set = this account belongs to a
--   store's organization — either as the store account itself
--   (organization_id = its own org, whose owner_account_id = this
--   account's id) or as one of its linked seller accounts.
--
-- Security model (see is_organization_owner() below and the
-- accompanying senior security review in the PR/commit this ships in)
--   - Only a profile with account_role = 'owner' on the organization's
--     owner_account_id gets the cross-account grant — NOT 'admin' or
--     any other role. This is deliberately the strictest option: the
--     capability being granted is "read every seller's private
--     conversations", which is sensitive enough that "the store's
--     single accountable owner" is the only reasonable holder.
--   - The grant is SELECT-only. No INSERT/UPDATE/DELETE policy is
--     added anywhere in this migration — the store owner can look,
--     never act as a seller's account. Sending a message "as" a
--     seller requires the application layer to explicitly switch
--     into that seller's own authenticated context (out of scope for
--     this round — not built, not promised anywhere in the UI).
--   - The check is scoped to the SAME organization by construction:
--     is_organization_owner(target_account_id) joins target_account_id
--     → its organization → that organization's owner_account_id →
--     profiles or auth.uid(). A caller who owns Organization A's store
--     account can never satisfy this for an Organization B account,
--     because the join chain requires target's organization_id to
--     match the org whose owner_account_id is the caller's own
--     account — a different organization's row fails that join.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  owner_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One organization per store account — an account can be the "mãe"
-- of at most one organization (it can still separately be a *member*
-- account of a DIFFERENT organization via accounts.organization_id,
-- though the application never builds that UI in this round).
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_one_per_owner_account
  ON organizations(owner_account_id);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON organizations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_organization ON accounts(organization_id);

-- ============================================================
-- is_organization_owner(target_account_id)
--
-- True iff auth.uid() is an 'owner'-role member of the account that
-- owns the organization `target_account_id` belongs to. SECURITY
-- DEFINER for the same reason is_account_member() is (migration
-- 017) — the policy body needs to read `profiles`/`accounts` without
-- recursive RLS evaluation.
--
-- Deliberately does NOT special-case "is target_account_id the store
-- account itself" — is_account_member() already grants the store
-- owner access to their own account's data, so this function only
-- ever needs to prove the CROSS-account case (a seller account whose
-- organization_id matches an org the caller owns).
-- ============================================================
CREATE OR REPLACE FUNCTION is_organization_owner(target_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM accounts target
    JOIN organizations o ON o.id = target.organization_id
    JOIN profiles p ON p.account_id = o.owner_account_id
    WHERE target.id = target_account_id
      AND p.user_id = auth.uid()
      AND p.account_role = 'owner'
  );
$$;

ALTER FUNCTION is_organization_owner(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_organization_owner(UUID) TO authenticated, service_role;

-- ============================================================
-- RLS — organizations
--
-- Readable by any member of the owner account (so a future teammate
-- with visibility into the org concept can at least see its name);
-- only the owner account's own 'owner' can create/update it (an
-- an org names itself after the store, and only the accountable
-- owner should be able to rename it or hand it to a different
-- account — not built in this round, but the policy allows it).
-- ============================================================
DROP POLICY IF EXISTS organizations_select ON organizations;
CREATE POLICY organizations_select ON organizations FOR SELECT USING (
  is_account_member(owner_account_id)
);

DROP POLICY IF EXISTS organizations_insert ON organizations;
CREATE POLICY organizations_insert ON organizations FOR INSERT WITH CHECK (
  is_account_member(owner_account_id, 'owner')
);

DROP POLICY IF EXISTS organizations_update ON organizations;
CREATE POLICY organizations_update ON organizations FOR UPDATE USING (
  is_account_member(owner_account_id, 'owner')
) WITH CHECK (
  is_account_member(owner_account_id, 'owner')
);

-- ============================================================
-- RLS — cross-account SELECT grants
--
-- Additive: these are NEW, separate policies alongside the existing
-- is_account_member(...)-based ones from migration 017 (Postgres ORs
-- multiple permissive policies for the same command together), so a
-- seller account's own access — and every existing single-account
-- deployment with organization_id always NULL — is completely
-- unaffected. is_organization_owner() only ever returns true for a
-- DIFFERENT account than the caller's own (see the function's own
-- comment), so this never widens what the store owner can do to
-- their OWN account beyond what is_account_member() already grants.
-- ============================================================
DROP POLICY IF EXISTS conversations_org_select ON conversations;
CREATE POLICY conversations_org_select ON conversations FOR SELECT USING (
  is_organization_owner(account_id)
);

DROP POLICY IF EXISTS contacts_org_select ON contacts;
CREATE POLICY contacts_org_select ON contacts FOR SELECT USING (
  is_organization_owner(account_id)
);

DROP POLICY IF EXISTS messages_org_select ON messages;
CREATE POLICY messages_org_select ON messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id AND is_organization_owner(c.account_id)
  )
);

-- accounts: the store owner needs to be able to SELECT the seller
-- accounts' own `accounts` rows (name, id) to render the consolidated
-- view's account picker — accounts_select (migration 017) only ever
-- allowed is_account_member(id), which a store owner fails for a
-- seller's account.
DROP POLICY IF EXISTS accounts_org_select ON accounts;
CREATE POLICY accounts_org_select ON accounts FOR SELECT USING (
  is_organization_owner(id)
);
