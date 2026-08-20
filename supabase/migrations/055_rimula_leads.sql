-- ============================================================
-- 055_rimula_leads.sql — extend `deals` into `Lead` (§9.0/§9.1, §12,
-- Phase 6)
--
-- §9.0's correction on this table: today's `deals.status` is only
-- `CHECK (status IN ('open','won','lost'))` (migration 002). Getting
-- to Lead's 8-value status enum means dropping and recreating that
-- constraint — same pattern as migrations 002/014/016 — not just
-- adding values. Existing rows are remapped before the new
-- constraint lands so the ALTER never fails against live data:
--   'open' -> 'NEW'        (an open deal with no Lead-specific
--                            status yet is exactly a fresh lead)
--   'won'  -> 'CONVERTED'
--   'lost' -> 'LOST'
--
-- `assigned_to` (FK -> profiles, added in 002) already maps directly
-- to `assignedBA` — no new column needed for that. `source`,
-- `campaign_id`, `original_content_id`, `market_id`/`region_id`,
-- `next_follow_up`, `last_contacted`, `outcome` are all genuinely
-- net-new per §9.0. `routing_reason` isn't in §9.1's field list but
-- is required by §12 ("Record *why* a BA was chosen") — same column
-- name/shape added to `customer_requests` and `trials` in migration
-- 056, so the three assignable tables stay consistent.
--
-- `market_id`/`region_id` are FKs into the migration 049 lookup
-- tables, matching `contacts`/`profiles`'s own market/region columns
-- (050/051) rather than free text.
--
-- `original_content_id` links to `content` (migration 046) — the
-- specific post that produced the lead — rather than a free-text
-- "originalContent" column, since the actual content row is already
-- addressable and a text copy would drift from it.
--
-- No RLS changes: `deals_select/insert/update/delete` (migration 017)
-- are row-level, not column-level, so they already cover every column
-- added here.
--
-- Idempotent — safe to re-run (the status-remap UPDATE is a no-op
-- once no row has an old value left, and the ADD COLUMN /
-- constraint-drop-and-recreate calls are all guarded).
-- ============================================================

-- ------------------------------------------------------------
-- 1. New columns
-- ------------------------------------------------------------
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN (
    'demo_whatsapp', 'whatsapp', 'product_page', 'campaign', 'manual', 'flow', 'customer_request'
  )),
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_content_id UUID REFERENCES content(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS market_id UUID REFERENCES markets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS region_id UUID REFERENCES regions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS next_follow_up TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_contacted TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS routing_reason TEXT;

-- ------------------------------------------------------------
-- 2. Remap legacy status values, then widen the CHECK constraint.
--    Two-step, same idiom migration 002 itself used.
-- ------------------------------------------------------------
UPDATE deals SET status = 'NEW' WHERE status = 'open';
UPDATE deals SET status = 'CONVERTED' WHERE status = 'won';
UPDATE deals SET status = 'LOST' WHERE status = 'lost';

ALTER TABLE deals ALTER COLUMN status SET DEFAULT 'NEW';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_status_check' AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals DROP CONSTRAINT deals_status_check;
  END IF;
END $$;

ALTER TABLE deals
  ADD CONSTRAINT deals_status_check CHECK (status IN (
    'NEW', 'ASSIGNED', 'CONTACTED', 'INTERESTED',
    'TRIAL_REQUESTED', 'TRIAL_COMPLETED', 'CONVERTED', 'LOST'
  ));

-- ------------------------------------------------------------
-- 3. Indexes shaped for §12's dashboards (My New Leads / open leads /
--    overdue leads) and routing hot path.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_deals_account_status ON deals(account_id, status);
CREATE INDEX IF NOT EXISTS idx_deals_market ON deals(market_id);
CREATE INDEX IF NOT EXISTS idx_deals_region ON deals(region_id);
CREATE INDEX IF NOT EXISTS idx_deals_campaign ON deals(campaign_id);
-- Overdue-lead scan: assigned leads whose follow-up date has passed.
CREATE INDEX IF NOT EXISTS idx_deals_next_follow_up ON deals(account_id, next_follow_up)
  WHERE next_follow_up IS NOT NULL;
