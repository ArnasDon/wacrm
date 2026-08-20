-- ============================================================
-- 074_support_tickets.sql
--
-- "Reportar un problema" (Settings sidebar → support-report-dialog.tsx)
-- used to be email-only — the outgoing email to SUPPORT_INBOX was the
-- only record, with no ticket number and no way for Angel to track
-- which reports are still open. This gives every report a durable row
-- + a human-friendly sequential ticket_number, and a status Angel can
-- flip from /admin ("Tickets de soporte" section).
--
-- Deliberately does NOT store the screenshots the report can attach —
-- those stay email-only attachments exactly as before (see the
-- pre-existing comment in POST /api/support/report), preserving the
-- original privacy decision that no permanent history of potentially
-- sensitive customer screenshots accumulates in the project. Only the
-- text description + ticket metadata are persisted.
--
-- account_id/reported_by_user_id are nullable with ON DELETE SET NULL
-- (not CASCADE) so a ticket survives account/user deletion as history
-- — account_name is denormalized at report time for the same reason
-- (the admin panel can still show "which company" after the account
-- itself is gone).
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  account_name TEXT NOT NULL,
  reported_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reporter_name TEXT NOT NULL,
  reporter_email TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.support_tickets IS
  'Durable log of "Reportar un problema" submissions, one row per email sent to the support inbox. ticket_number is the human-facing sequential id shown in the email subject and the /admin ticket log. Screenshots are never stored here — email-only, by design.';

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- New Supabase projects don't expose public tables to the Data API by
-- default. `authenticated` gets INSERT (the reporting user, via the
-- RLS-scoped client in POST /api/support/report) + SELECT (needed for
-- PostgREST to return the inserted row, including its ticket_number,
-- to that same request). Admin listing/updates go through
-- platformAdminClient() (service role) in the /admin routes, same
-- pattern as platform_company_invitations.
GRANT SELECT, INSERT ON public.support_tickets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_tickets TO service_role;

DROP POLICY IF EXISTS support_tickets_insert_own ON public.support_tickets;
CREATE POLICY support_tickets_insert_own ON public.support_tickets FOR INSERT
  WITH CHECK (reported_by_user_id = auth.uid());

DROP POLICY IF EXISTS support_tickets_select ON public.support_tickets;
CREATE POLICY support_tickets_select ON public.support_tickets FOR SELECT
  USING (reported_by_user_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS support_tickets_admin_update ON public.support_tickets;
CREATE POLICY support_tickets_admin_update ON public.support_tickets FOR UPDATE
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());
