-- ============================================================
-- 044_lulu_data_quality.sql — suspected shared / fake phone numbers
--
-- Adds visibility columns to lulu_customer_profiles. A profile with a
-- non-null `suspect_reason` is kept (so it can be reviewed) but excluded
-- from lifecycle counts, campaign eligibility and the next-best-action
-- engine. Set by the BigQuery customer master; cleared by a later sync
-- once the data no longer trips the rule.
-- Idempotent.
-- ============================================================
ALTER TABLE lulu_customer_profiles ADD COLUMN IF NOT EXISTS distinct_names  integer;
ALTER TABLE lulu_customer_profiles ADD COLUMN IF NOT EXISTS distinct_emails integer;
ALTER TABLE lulu_customer_profiles ADD COLUMN IF NOT EXISTS suspect_reason  text;

CREATE INDEX IF NOT EXISTS lulu_cp_suspect_idx
  ON lulu_customer_profiles (account_id, total_orders DESC)
  WHERE suspect_reason IS NOT NULL;
