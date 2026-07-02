-- ============================================================
-- 031_profile_locale
--
-- Per-user language preference for the new i18n support.
--
-- wacrm ships translated in pt-BR (default) and en-US. Each user
-- can pick their own language independent of the account's other
-- members; unset defaults to pt-BR, matching the app-wide default
-- locale used when no cookie/profile preference is available yet.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'pt-BR';

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_locale_format;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_locale_format
  CHECK (locale ~ '^[a-z]{2}-[A-Z]{2}$');
