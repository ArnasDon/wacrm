-- ============================================================
-- 046_lulu_customer_city.sql — customer's latest order city
-- Lets the app show / segment by region (phase 1 focuses on the
-- western province; other regions can be switched on later).
-- Idempotent.
-- ============================================================
ALTER TABLE lulu_customer_profiles ADD COLUMN IF NOT EXISTS city text;
CREATE INDEX IF NOT EXISTS lulu_cp_city_idx ON lulu_customer_profiles (account_id, city);
