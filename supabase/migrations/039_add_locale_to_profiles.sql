-- ============================================================
-- 038_add_locale_to_profiles.sql — Per-user language preference
--
-- Adds a `locale` column to `profiles` so each user can pick
-- their preferred UI language. The DEFAULT is 'en' so existing
-- profiles continue in English until the user changes it.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en';

-- ============================================================
-- Changelog
-- ============================================================
-- 2026-07-29 · kukic · created
