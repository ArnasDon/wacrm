-- ============================================================
-- 045_lulu_sync_freshness.sql — record how fresh the warehouse data is
--
-- `data_as_of` = timestamp of the newest order in the data that was synced.
-- The app shows it on /engagement and the campaign sender will refuse live
-- sends when it is too old (a customer who ordered after the cut-off would
-- otherwise look inactive and be sent a "we miss you" message).
-- Idempotent.
-- ============================================================
ALTER TABLE lulu_customer_sync_log ADD COLUMN IF NOT EXISTS data_as_of timestamptz;
