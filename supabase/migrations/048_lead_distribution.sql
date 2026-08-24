-- ============================================================
-- 048_lead_distribution.sql — Round-robin lead distribution for ads
--
-- A store running Meta/Google Ads with a single "click to WhatsApp"
-- link needs every lead spread evenly across its vendedores (seller
-- accounts, migration 041), not always landing on the same person.
--
-- Model: each seller account gets a `lead_redirect_phone` (the
-- WhatsApp number ads should send customers to) and a
-- `lead_rotation_enabled` flag (pause without unlinking/deactivating
-- the whole account). `last_lead_assigned_at` tracks turn order —
-- "whoever went longest without a lead is next" — so a paused/
-- reactivated seller naturally rejoins at the right spot instead of
-- needing a separate queue-position counter.
--
-- assign_next_seller() does the pick-lock-record-advance sequence in
-- one SECURITY DEFINER function call, so two ad clicks landing at the
-- same instant can't both grab the same seller (FOR UPDATE holds the
-- row lock for the duration of the function's implicit transaction —
-- a second concurrent call simply waits the few milliseconds for the
-- first to commit, then sees the updated last_lead_assigned_at and
-- picks the next one).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS lead_redirect_phone TEXT,
  ADD COLUMN IF NOT EXISTS lead_rotation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_lead_assigned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_accounts_org_last_lead
  ON accounts(organization_id, last_lead_assigned_at);

-- Store-wide fallback for when no seller is eligible (everyone
-- paused, or nobody has set a WhatsApp number yet) — an ad link must
-- never dead-end a real customer.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS fallback_lead_phone TEXT,
  ADD COLUMN IF NOT EXISTS lead_message_template TEXT;

CREATE TABLE IF NOT EXISTS ad_leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- SET NULL (not CASCADE): if a seller account is later removed, the
  -- historical lead record — and the fact it went out at all — stays,
  -- just without an assignee.
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  name TEXT,
  phone TEXT,
  origin TEXT,
  utm JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_leads_organization ON ad_leads(organization_id);
CREATE INDEX IF NOT EXISTS idx_ad_leads_account ON ad_leads(account_id);

ALTER TABLE ad_leads ENABLE ROW LEVEL SECURITY;

-- Readable by the assigned seller (is_account_member) or the store
-- owner (is_organization_owner, migration 041) — same shape as every
-- other org-scoped table. No INSERT/UPDATE/DELETE policy: rows are
-- only ever written by assign_next_seller() below, which runs as the
-- table owner and therefore bypasses RLS entirely, same precedent as
-- is_account_member()/is_organization_owner() themselves.
DROP POLICY IF EXISTS ad_leads_select ON ad_leads;
CREATE POLICY ad_leads_select ON ad_leads FOR SELECT USING (
  (account_id IS NOT NULL AND is_account_member(account_id))
  OR (account_id IS NOT NULL AND is_organization_owner(account_id))
);

-- ============================================================
-- assign_next_seller(org, lead name, lead phone, origin, utm)
--
-- Picks the eligible seller (active in rotation + has a WhatsApp
-- number set) who's gone longest without a lead, advances their
-- turn, and logs the lead — all inside one locked transaction.
-- Returns zero rows if nobody is eligible; the caller (the public
-- redirect route) is responsible for falling back to
-- organizations.fallback_lead_phone in that case.
-- ============================================================
CREATE OR REPLACE FUNCTION assign_next_seller(
  p_organization_id UUID,
  p_lead_name TEXT,
  p_lead_phone TEXT,
  p_origin TEXT,
  p_utm JSONB
)
RETURNS TABLE(assigned_account_id UUID, redirect_phone TEXT, lead_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_phone TEXT;
  v_lead_id UUID;
BEGIN
  SELECT id, lead_redirect_phone
    INTO v_account_id, v_phone
  FROM accounts
  WHERE organization_id = p_organization_id
    AND lead_rotation_enabled = TRUE
    AND lead_redirect_phone IS NOT NULL
    AND lead_redirect_phone <> ''
  ORDER BY last_lead_assigned_at ASC NULLS FIRST, id ASC
  LIMIT 1
  FOR UPDATE;

  IF v_account_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE accounts SET last_lead_assigned_at = NOW() WHERE id = v_account_id;

  INSERT INTO ad_leads (organization_id, account_id, name, phone, origin, utm)
  VALUES (p_organization_id, v_account_id, p_lead_name, p_lead_phone, p_origin, COALESCE(p_utm, '{}'::jsonb))
  RETURNING id INTO v_lead_id;

  RETURN QUERY SELECT v_account_id, v_phone, v_lead_id;
END;
$$;

ALTER FUNCTION assign_next_seller(UUID, TEXT, TEXT, TEXT, JSONB) OWNER TO postgres;
-- service_role only — called exclusively from the public redirect API
-- route via the admin client, never directly from a user session.
GRANT EXECUTE ON FUNCTION assign_next_seller(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;
