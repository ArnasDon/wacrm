-- ============================================================
-- 103_lead_temperature_cooldown.sql — auto-cool stale leads
--
-- `contacts.lead_temperature` (migration 047) is only ever written by
-- a human (the inbox temperature control) or the AI in an active
-- conversation ([[ACTION:set_temperature]], migration 052). A lead the
-- AI marked "hot" that then goes silent for weeks stays "hot" forever
-- and pollutes "leads calificados" on the KPIs page.
--
-- This adds an opt-in per-account sweep (/api/contacts/temperature-
-- sweep/cron) that walks warm/hot contacts and steps one notch cooler
-- (hot -> warm -> cold) once BOTH:
--   - the thread has had no activity for `lead_cooldown_days`, and
--   - the current temperature has been in place for `lead_cooldown_days`
--     (so a fresh classification gets its own full grace period).
--
-- Additive changes:
--   1. contacts.lead_temperature_updated_at — stamped whenever the
--      temperature changes (the sweep, the manual PATCH, the AI action).
--      Backfilled for existing classified rows so the first sweep tick
--      doesn't treat them all as "just set".
--   2. accounts.lead_cooldown_enabled / lead_cooldown_days — the
--      per-account opt-in + grace period (Settings -> Deals & currency).
--   3. a partial index so the sweep's "warm/hot in this account" scan
--      doesn't sequentially scan contacts.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Temperature-change timestamp -----------------------------------

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS lead_temperature_updated_at TIMESTAMPTZ;

-- Existing classified contacts: seed from updated_at (best available
-- proxy for "when it was last touched"), falling back to created_at.
UPDATE public.contacts
  SET lead_temperature_updated_at = COALESCE(updated_at, created_at)
  WHERE lead_temperature IS NOT NULL
    AND lead_temperature_updated_at IS NULL;

-- 2. Per-account opt-in -------------------------------------------------

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS lead_cooldown_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lead_cooldown_days INTEGER NOT NULL DEFAULT 14;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_lead_cooldown_days_range'
      AND conrelid = 'public.accounts'::regclass
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_lead_cooldown_days_range
      CHECK (lead_cooldown_days BETWEEN 1 AND 365);
  END IF;
END $$;

COMMENT ON COLUMN public.accounts.lead_cooldown_enabled IS
  'Opt-in: /api/contacts/temperature-sweep/cron steps warm/hot contacts one notch cooler after lead_cooldown_days of silence.';

-- 3. Sweep scan index ------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_contacts_temperature_active
  ON public.contacts (account_id)
  WHERE lead_temperature IN ('warm', 'hot');
