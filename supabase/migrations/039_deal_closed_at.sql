-- ============================================================
-- 039_deal_closed_at
--
-- Add `deals.closed_at`, set exactly once when a deal is marked
-- won/lost, and never touched again by ordinary edits.
--
-- Why this can't reuse `updated_at`: `updated_at` moves every time a
-- deal is edited — renaming a won deal, fixing a typo in its notes,
-- reassigning it to another rep, all bump it. `pipeline-analytics.tsx`
-- already leans on it as a "closed this month" proxy, which is
-- approximately right for a quiet deal but silently wrong the moment
-- someone touches a closed deal for an unrelated reason.
--
-- The ROI work about to land (src/lib/ads/roi.ts) makes this exact:
-- it sums the value of won deals attributed to a campaign, filtered
-- to a date range. Using `updated_at` there would let an unrelated
-- edit shift a deal's revenue into a different month's ROI, or in/out
-- of the requested range entirely. `closed_at` is the one column that
-- only ever means "when this deal was decided".
--
-- Backfill: for the existing 'won'/'lost' rows, `updated_at` is the
-- best available approximation of when they closed (better than
-- `created_at`, which is when the deal was opened, or NULL, which
-- would exclude every historical deal from every ROI query until it's
-- next touched). New closes get the accurate value going forward from
-- the write sites this migration's companion code change updates.
-- ============================================================

ALTER TABLE deals ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

UPDATE deals
SET closed_at = updated_at
WHERE status IN ('won', 'lost') AND closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_deals_account_closed_at
  ON deals(account_id, closed_at)
  WHERE closed_at IS NOT NULL;
