-- ============================================================
-- 072_seat_limits.sql
--
-- Product decision (2026-08-20): every account may add members
-- freely up to `seat_limit`; each seat beyond that costs Q100 and
-- must be unlocked by a platform admin (Angel) from /admin after he
-- confirms payment (email flow — see POST /api/billing/request-seat).
-- POST /api/account/invitations refuses to create a new invite once
-- current members + still-live pending invites reach `seat_limit`.
--
-- Backfilled to each account's CURRENT headcount (never lower than 1)
-- so applying this migration does not lock any existing team out of
-- inviting — it only gates *future* growth beyond today's size. New
-- accounts default to 1 (owner only), matching every account-creation
-- path (handle_new_user / platform company-invite acceptance), which
-- inserts exactly one owner profile at creation time.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS seat_limit INTEGER NOT NULL DEFAULT 1;

UPDATE public.accounts a
SET seat_limit = sub.member_count
FROM (
  SELECT account_id, COUNT(*) AS member_count
  FROM public.profiles
  GROUP BY account_id
) sub
WHERE a.id = sub.account_id
  AND sub.member_count > a.seat_limit;

COMMENT ON COLUMN public.accounts.seat_limit IS
  'Max members (incl. owner) this account may have. POST /api/account/invitations refuses a new invite once members + live pending invites reach this. Raised only via PATCH /api/admin/companies/[id] (platform admin "+1 asiento" button) after a Q100/seat payment is confirmed off-platform.';
