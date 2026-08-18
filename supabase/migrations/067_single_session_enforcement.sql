-- ============================================================
-- 067_single_session_enforcement.sql
--
-- Adds `accounts.enforce_single_session` — when true (the default),
-- a user signing in on a new device/browser signs every OTHER active
-- session for that same user out (via Supabase Auth's own
-- `signOut({ scope: 'others' })`, which revokes the other sessions'
-- refresh tokens server-side — this is real enforcement, not just a
-- client-side notice). A user may still use several devices, just
-- never two at once.
--
-- Exemption: Angel's own account (Chat Sandía's own team, used for
-- day-to-day testing across many devices) is backfilled to `false`
-- here. Every other account defaults to enforced.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS enforce_single_session BOOLEAN NOT NULL DEFAULT true;

UPDATE public.accounts
  SET enforce_single_session = false
  WHERE id = '6ad222e9-20b0-4754-85db-ab8547d49a1d';
