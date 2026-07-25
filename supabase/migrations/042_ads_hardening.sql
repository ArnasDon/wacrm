-- ============================================================
-- 042_ads_hardening
--
-- Three corrections to the ads subsystem (037-041), all found by
-- reviewing the code rather than by it failing — because each one only
-- misbehaves once a day has passed, which same-day testing never sees.
--
--   1. Retry bookkeeping for ad resolution. Migration 038's comment
--      claimed a failed resolution "doesn't retry the same broken ad on
--      every run" — true, but it never retries it *at all*, because the
--      sync skipped any ad_id that had a row in ad_entities regardless
--      of why. A transient Graph API error, a rate-limit, or the very
--      common "ad resolved but its campaign isn't synced yet" therefore
--      stranded that ad permanently: its contacts kept
--      source_campaign_id = NULL and never appeared in the campaign's
--      leads or revenue. `attempts` + `last_attempt_at` let the sync
--      back off and give up deliberately instead of by accident.
--
--   2. The ad account's own timezone. Meta reports insight dates in the
--      ad account's timezone, the operator reads the /campaigns page in
--      the browser's, and the server writes in its own — three clocks
--      that will not always agree. Storing the one Meta uses lets
--      Settings show the mismatch instead of quietly presenting numbers
--      that look off by a day for no visible reason.
--
--   3. A missing WITH CHECK. `ad_metrics_daily_update` (038) restricts
--      which rows an admin may update but not what they may write, so
--      an API-synced row could be flipped to origin = 'manual' and
--      hand-edited. The INSERT policy already enforces manual-only;
--      this makes UPDATE agree with it.
-- ============================================================

-- ============================================================
-- 1. RETRY BOOKKEEPING
--
-- `resolved_at` keeps meaning "when this ad actually resolved" — it is
-- not overloaded as "when we last tried", which is what
-- `last_attempt_at` is for. Existing rows start at 0 attempts so they
-- get a fresh chance under the new policy: rows stranded by the old
-- behaviour are exactly the ones worth retrying once this ships.
-- ============================================================
ALTER TABLE ad_entities
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

-- The sync's per-run scan is "unresolved ads for this account". Partial
-- index because resolved rows are the vast majority over time and are
-- never scanned by it.
CREATE INDEX IF NOT EXISTS idx_ad_entities_unresolved
  ON ad_entities(account_id)
  WHERE campaign_id IS NULL;

-- ============================================================
-- 2. AD ACCOUNT TIMEZONE
--
-- From Meta's `timezone_name` on the ad account (e.g. 'America/Lima').
-- Nullable: manual platforms (Google, other) have no such concept, and
-- Meta accounts connected before this migration only fill it on their
-- next reconnect.
-- ============================================================
ALTER TABLE ad_accounts
  ADD COLUMN IF NOT EXISTS timezone TEXT;

-- ============================================================
-- 3. MANUAL-ONLY WRITES ON UPDATE
-- ============================================================
DROP POLICY IF EXISTS ad_metrics_daily_update ON ad_metrics_daily;
CREATE POLICY ad_metrics_daily_update ON ad_metrics_daily FOR UPDATE
  USING (is_account_member(account_id, 'admin') AND origin = 'manual')
  WITH CHECK (is_account_member(account_id, 'admin') AND origin = 'manual');
