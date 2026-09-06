-- ============================================================
-- 107_account_hidden_nav.sql — per-company sidebar section visibility
--
-- The vertical registry (`src/lib/verticals/`) can declare
-- `hiddenNavKeys` per kit; this column lets the platform operator also
-- pick, per company, which sidebar sections a company sees — checked
-- in `/admin` → company detail.
--
-- NULL = fall back to the company's vertical default. A non-null array
-- (even empty) is an explicit per-company choice: the listed
-- `labelKey`s are hidden from the sidebar / mobile tab bar / ⌘K menu.
--
-- Same one-scalar-column convention as 105 (`industry_vertical`). The
-- seeder writes this from the kit's `hiddenNavKeys` when the kit
-- declares one; a platform admin can override it afterward.
--
-- No RLS change: `accounts_update` (migration 017) already gates admin+
-- writes, and the platform-admin route uses the service-role client.
-- Idempotent.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS hidden_nav_keys TEXT[];

COMMENT ON COLUMN public.accounts.hidden_nav_keys IS
  'Sidebar section labelKeys hidden for this company (migration 107). NULL = use the vertical default from src/lib/verticals. Set in /admin.';
