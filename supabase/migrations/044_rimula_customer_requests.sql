-- ============================================================
-- 044_rimula_customer_requests.sql — CustomerRequest (§9.0/§9.1, §12)
--
-- The entry point of the funnel's second half: `CustomerRequest` can
-- originate from demo WhatsApp, real WhatsApp, product pages,
-- campaigns, manual entry, or a Flows `collect_input`/`condition`
-- branch (§12). All of those are represented by `source`, not a
-- second table per origin.
--
-- `type` and the `status` progression follow §9.1's field set exactly.
-- `status` here is intentionally a smaller lifecycle than `Lead`
-- (`deals`, extended in a later phase) — a CustomerRequest is the raw
-- enquiry; once it's qualified it becomes (or attaches to) a Lead.
--
-- Operational data (mirrors `deals` / `conversations` from migration
-- 017): agent+ (BA) writes, any member reads. Per §14, a BA is meant
-- to see only their *own* assigned requests — that per-row narrowing
-- is applied in the application query layer (the same way
-- `conversations.assigned_agent_id` / `deals.assigned_to` are scoped
-- today: RLS enforces account membership, and "mine" filtering is a
-- WHERE clause the API adds, not a second RLS predicate). This keeps
-- the policy shape consistent with every other assignment column in
-- the schema rather than introducing a one-off owner-scoped policy.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN (
    'PRODUCT_INFORMATION',
    'PRODUCT_SUITABILITY',
    'TRIAL_REQUEST',
    'BA_CALL_REQUEST',
    'PRODUCT_QUESTION',
    'FEEDBACK',
    'PURCHASE_REQUEST',
    'CONVERSION_REQUEST',
    'GENERAL_ENQUIRY'
  )),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN (
    'demo_whatsapp', 'whatsapp', 'product_page', 'campaign', 'manual', 'flow'
  )),
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN (
    'NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'
  )),
  assigned_ba_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_requests_account ON customer_requests(account_id);
CREATE INDEX IF NOT EXISTS idx_customer_requests_account_status ON customer_requests(account_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_requests_contact ON customer_requests(contact_id);
CREATE INDEX IF NOT EXISTS idx_customer_requests_assigned_ba ON customer_requests(assigned_ba_id);
CREATE INDEX IF NOT EXISTS idx_customer_requests_campaign ON customer_requests(campaign_id);

ALTER TABLE customer_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_requests_select ON customer_requests;
CREATE POLICY customer_requests_select ON customer_requests FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS customer_requests_insert ON customer_requests;
CREATE POLICY customer_requests_insert ON customer_requests FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS customer_requests_update ON customer_requests;
CREATE POLICY customer_requests_update ON customer_requests FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS customer_requests_delete ON customer_requests;
CREATE POLICY customer_requests_delete ON customer_requests FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON customer_requests;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON customer_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
