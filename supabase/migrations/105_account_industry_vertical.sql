-- ============================================================
-- 105_account_industry_vertical.sql — per-company industry vertical
--
-- SANDÍA now onboards more than one kind of company. A hotel needs a
-- reservations pipeline, date-based room rates and a catalog of rooms /
-- spa / activities / packages; a supplier ("generic") needs the current
-- flat-price CRM. `industry_vertical` lets the platform operator tag a
-- company and seed the right starter config for it (see
-- `src/lib/verticals/` + `POST /api/admin/companies/[id]/apply-vertical`).
--
--   'generic' — today's behaviour, unchanged. The column default, so
--               every existing account and every new non-hotel signup
--               is untouched.
--   'hotel'   — reservations workflow + per-date pricing (piece 2).
--
-- `vertical_applied_at` is stamped by the seeder so it can run
-- idempotently and the /admin UI can show whether a kit was applied.
--
-- Same one-scalar-column-per-migration convention as 021
-- (default_currency), 063 (timezone), 068 (catalog_delivery_mode). No
-- RLS change: the `accounts_update` admin+ policy (migration 017)
-- already gates writes, and the platform-admin seeder uses the
-- service-role client.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS industry_vertical TEXT NOT NULL DEFAULT 'generic'
    CHECK (industry_vertical IN ('generic', 'hotel')),
  ADD COLUMN IF NOT EXISTS vertical_applied_at TIMESTAMPTZ;

COMMENT ON COLUMN public.accounts.industry_vertical IS
  'Company industry vertical (migration 105). Drives per-vertical starter-kit seeding and light panel adaptation. Default ''generic'' = current behaviour.';
COMMENT ON COLUMN public.accounts.vertical_applied_at IS
  'When the vertical starter kit was last applied (migration 105) — set by POST /api/admin/companies/[id]/apply-vertical so it can run idempotently.';
