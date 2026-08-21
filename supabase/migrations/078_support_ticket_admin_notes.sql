-- ============================================================
-- 078_support_ticket_admin_notes.sql
--
-- Follow-up to 074_support_tickets.sql. Angel asked for two things
-- for the "Historial de tickets" admin panel and its counterpart on
-- the customer side:
--   1. A way for Angel to leave a note on a ticket (status updates,
--      what he's doing about it) that the reporting company can read.
--   2. A place inside each account's own Settings for that company to
--      see the tickets IT submitted, their status, and Angel's notes
--      — not just their own individual report (any account member,
--      viewer+, matching who's allowed to submit one in the first
--      place via `requireRole('viewer')` in POST /api/support/report).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS admin_note TEXT;

COMMENT ON COLUMN public.support_tickets.admin_note IS
  'Freeform note Angel (platform admin) can leave on a ticket from /admin — visible to the reporting company in Settings → Tickets.';

-- Widen SELECT from "only the exact person who filed it" to "any
-- member of that company" — a teammate should be able to see a
-- ticket a colleague reported, same as they can already see it get
-- created (anyone viewer+ can submit one). Keeps the own-report and
-- platform-admin clauses so nothing that worked before regresses.
DROP POLICY IF EXISTS support_tickets_select ON public.support_tickets;
CREATE POLICY support_tickets_select ON public.support_tickets FOR SELECT
  USING (
    reported_by_user_id = auth.uid()
    OR (account_id IS NOT NULL AND public.is_account_member(account_id))
    OR public.is_platform_admin()
  );
