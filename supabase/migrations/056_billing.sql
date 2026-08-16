-- ============================================================
-- 056_billing.sql
--
-- Billing/subscriptions for the platform operator (Angel), not a
-- per-company feature. Two additions:
--
--   1. accounts.next_payment_due_at / last_marked_paid_at — nullable.
--      NULL next_payment_due_at means "no billing cycle assigned yet,"
--      so applying this migration does not affect any existing
--      account's access until Angel sets a date by hand in /admin.
--      The auto-suspend cron (Bloque 10, app code — not scheduled by
--      this migration) only ever touches accounts where
--      next_payment_due_at IS NOT NULL and past due, and never
--      accounts already suspended for another reason.
--
--   2. platform_settings — a single-row table holding Angel's bank
--      details, shown to every company on their own Settings →
--      Facturación page. Any authenticated user may read it (it's
--      meant to be shown widely); only a platform admin may write it,
--      via the existing is_platform_admin() (migration 043).
--
-- Reuses the exact suspension columns/semantics from migration 044
-- (suspended_at / suspended_reason) — the auto-suspend cron sets
-- suspended_reason = 'Pago pendiente', same column is_account_member()
-- already checks, so no RLS changes are needed here at all.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS next_payment_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_marked_paid_at TIMESTAMPTZ;

COMMENT ON COLUMN public.accounts.next_payment_due_at IS
  'Next subscription payment due date, set by hand in /admin. NULL = no billing cycle assigned yet — never touched by the auto-suspend cron.';
COMMENT ON COLUMN public.accounts.last_marked_paid_at IS
  'Last time a platform admin marked this account as paid in /admin (informational only).';

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bank_name TEXT,
  account_number TEXT,
  account_type TEXT,
  account_holder TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- New Supabase projects don't expose public tables to the Data API by
-- default. Reads happen directly from the RLS-scoped client (every
-- company's Settings → Facturación page shows these bank details), so
-- `authenticated` gets a plain SELECT grant. Writes only ever go
-- through POST /api/admin/platform-settings using the service-role
-- client (requirePlatformAdmin() gate) — same "server route owns all
-- writes" shape as platform_company_invitations (migration 043) — so
-- there's no INSERT/UPDATE/DELETE grant for `authenticated` at all;
-- RLS would deny it even if there were, since no policy covers those
-- commands for that role below.
GRANT SELECT ON public.platform_settings TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.platform_settings TO service_role;

DROP POLICY IF EXISTS platform_settings_select ON public.platform_settings;
CREATE POLICY platform_settings_select ON public.platform_settings FOR SELECT
  USING (true);

DROP TRIGGER IF EXISTS set_updated_at ON public.platform_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.platform_settings IS
  'Single-row (id=1) table of platform-operator settings — currently just Angel''s bank details, shown to every company for the "report a payment" flow. Any authenticated user may SELECT; only is_platform_admin() may UPDATE.';
