-- ============================================================
-- 045_rimula_trials.sql — Trial (§9.0/§9.1, §12)
--
-- `status` follows §9.1's exact progression: NEW → REQUESTED →
-- ASSIGNED → SCHEDULED → COMPLETED → CONVERTED / CANCELLED.
--
-- `name`/`phone`/`role`/`market`/`vehicle` are captured as plain
-- columns rather than always resolved through `contact_id` — §9.1
-- lists them as Trial's own fields because a trial request can arrive
-- before a `Member` record exists for that phone number (e.g. a
-- brand-new WhatsApp contact asking for a trial in their very first
-- message). `contact_id` is still there and should be populated
-- whenever a matching `Member` is known, so the two are not fighting
-- sources of truth — the plain columns are the point-in-time capture,
-- `contact_id` is the durable link once resolved.
--
-- `deal_id` and `customer_request_id` are nullable forward-links: a
-- trial converts into (or originates from) a Lead/CustomerRequest,
-- but a later phase owns creating those rows, so both are optional
-- here.
--
-- Operational data — agent+ writes, any member reads (same tier as
-- `customer_requests` in migration 044).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS trials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  customer_request_id UUID REFERENCES customer_requests(id) ON DELETE SET NULL,
  name TEXT,
  phone TEXT,
  role TEXT,
  market TEXT,
  vehicle TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN (
    'NEW', 'REQUESTED', 'ASSIGNED', 'SCHEDULED', 'COMPLETED', 'CONVERTED', 'CANCELLED'
  )),
  assigned_ba_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trials_account ON trials(account_id);
CREATE INDEX IF NOT EXISTS idx_trials_account_status ON trials(account_id, status);
CREATE INDEX IF NOT EXISTS idx_trials_contact ON trials(contact_id);
CREATE INDEX IF NOT EXISTS idx_trials_assigned_ba ON trials(assigned_ba_id);
CREATE INDEX IF NOT EXISTS idx_trials_product ON trials(product_id);

ALTER TABLE trials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trials_select ON trials;
CREATE POLICY trials_select ON trials FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS trials_insert ON trials;
CREATE POLICY trials_insert ON trials FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS trials_update ON trials;
CREATE POLICY trials_update ON trials FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS trials_delete ON trials;
CREATE POLICY trials_delete ON trials FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON trials;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON trials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
