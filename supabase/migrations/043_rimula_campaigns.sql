-- ============================================================
-- 043_rimula_campaigns.sql — Campaigns (§9.0/§9.1, §13)
--
-- A Campaign groups content + broadcasts + a product for attribution
-- (§13's PRODUCT → CAMPAIGN → CONTENT → CUSTOMER → LEAD → TRIAL →
-- CONVERSION funnel). `audience` is JSONB rather than a normalized
-- filter table — it mirrors `broadcasts.audience_filter` (migration
-- 001), which already uses the same free-form-JSONB approach for
-- "who is this campaign/broadcast targeting".
--
-- Operational data (like `deals` / `broadcasts`), not settings —
-- agent+ (BA) can create and run a campaign, not just admins. Mirrors
-- the `deals` / `broadcasts` policy tier from migration 017.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_name TEXT NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  start_date DATE,
  end_date DATE,
  objective TEXT,
  content TEXT,
  audience JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  -- Cost is optional and account-currency-denominated (accounts.default_currency,
  -- migration 021) rather than carrying its own currency column — §13
  -- says show cost metrics "only when real cost data exists" and never
  -- hardcode a currency; NULL here means exactly "no cost data".
  cost NUMERIC(12,2),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_account ON campaigns(account_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_account_status ON campaigns(account_id, status);
CREATE INDEX IF NOT EXISTS idx_campaigns_product ON campaigns(product_id);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaigns_select ON campaigns;
CREATE POLICY campaigns_select ON campaigns FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS campaigns_insert ON campaigns;
CREATE POLICY campaigns_insert ON campaigns FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS campaigns_update ON campaigns;
CREATE POLICY campaigns_update ON campaigns FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS campaigns_delete ON campaigns;
CREATE POLICY campaigns_delete ON campaigns FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON campaigns;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
