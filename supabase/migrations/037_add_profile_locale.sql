-- ============================================================
-- 037_add_profile_locale.sql — Add locale column to profiles
--
-- Enables persisting user language preference (e.g. 'en', 'es') 
-- across devices, defaults to 'en'.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'en';
