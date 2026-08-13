-- ============================================================
-- 063_deal_position.sql
--
-- Pipeline drag-and-drop rewrite (Trello-equivalent UX), stage 2:
-- persists the exact card order within a stage column. `deals` had no
-- ordering column before this — the board always re-sorted by
-- created_at DESC, so a manual reorder inside a column never survived
-- a page reload.
--
-- Integer, 1000-step positions (same shape/convention as
-- pipeline_stages.position, migration 001) instead of a fractional/
-- midpoint scheme: every drop rewrites the full position set of
-- whichever column(s) it touched as index * 1000, so there's never an
-- "insert between two adjacent integers" exhaustion case to special-
-- case or periodically rebalance.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

-- Backfill preserving today's visual order (newest first) so existing
-- boards don't visibly reshuffle the moment this ships.
UPDATE deals AS d
SET position = sub.rn * 1000
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY stage_id ORDER BY created_at DESC) AS rn
  FROM deals
) AS sub
WHERE d.id = sub.id;

CREATE INDEX IF NOT EXISTS idx_deals_stage_position ON deals(stage_id, position);

-- New deals (auto-created from a WhatsApp lead, or via an automation —
-- see src/lib/pipelines/auto-deal.ts and src/lib/automations/engine.ts,
-- neither of which sets `position`) land at the top of their column,
-- matching the old created_at-DESC default — computed here once instead
-- of duplicated across every insert call site. `= 0` (the column
-- default) is the "not explicitly set" sentinel; nothing in this
-- codebase currently sets `position` on insert.
CREATE OR REPLACE FUNCTION assign_deal_position()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.position IS NULL OR NEW.position = 0 THEN
    SELECT COALESCE(MIN(position), 1000) - 1000 INTO NEW.position
    FROM deals
    WHERE stage_id = NEW.stage_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_deal_position ON deals;
CREATE TRIGGER set_deal_position
  BEFORE INSERT ON deals
  FOR EACH ROW EXECUTE FUNCTION assign_deal_position();

-- No RLS change needed — deals_select/insert/update/delete (migration
-- 017) are already column-agnostic (is_account_member(account_id)).
