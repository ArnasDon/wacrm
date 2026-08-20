-- ============================================================
-- 073_whatsapp_number_limits.sql
--
-- Same gating pattern as accounts.seat_limit (migration 072), applied
-- to WhatsApp connections: every account may keep whatsapp_config rows
-- freely up to `whatsapp_number_limit`; each number beyond that costs
-- Q200 and must be unlocked by a platform admin (Angel) from /admin
-- after he confirms payment (email flow — see POST
-- /api/billing/request-whatsapp-number). POST /api/whatsapp/config
-- refuses to create a new connection once the account is at capacity.
--
-- Backfilled to each account's CURRENT connection count (never lower
-- than 1) so applying this migration does not remove anyone's existing
-- numbers — it only gates *future* growth beyond today's count. New
-- accounts default to 1, matching the product's baseline of "one
-- WhatsApp number included."
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS whatsapp_number_limit INTEGER NOT NULL DEFAULT 1;

UPDATE public.accounts a
SET whatsapp_number_limit = sub.config_count
FROM (
  SELECT account_id, COUNT(*) AS config_count
  FROM public.whatsapp_config
  GROUP BY account_id
) sub
WHERE a.id = sub.account_id
  AND sub.config_count > a.whatsapp_number_limit;

COMMENT ON COLUMN public.accounts.whatsapp_number_limit IS
  'Max whatsapp_config rows (WhatsApp connections) this account may have. POST /api/whatsapp/config refuses a new connection once existing connections reach this. Raised only via PATCH /api/admin/companies/[id] (platform admin "+1 número" button) after a Q200/number payment is confirmed off-platform.';
