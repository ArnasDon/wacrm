-- ============================================================
-- 102_csat_surveys.sql — post-sale customer satisfaction (CSAT)
--
-- When a deal is won, the account can have SANDÍA send the customer a
-- short WhatsApp satisfaction survey (an approved template with
-- quick-reply buttons 1..N). The button the customer taps is captured
-- back as a numeric score. This is the "sembrar evidencia del sello"
-- piece from the SANDÍA plan: a per-contact record of satisfaction the
-- affiliated business sees today and that will back the trust seal
-- later.
--
-- Two tables:
--
--   csat_config   — one row per account: master toggle, which approved
--                   template to send, the button scale (3 or 5), how
--                   long to wait after deal.won before sending, and a
--                   per-contact cooldown so a repeat customer is not
--                   surveyed on every purchase.
--
--   csat_surveys  — one row per survey. Created 'pending' on deal.won
--                   (or immediately 'sent' when delay_minutes = 0),
--                   moved to 'sent' by /api/csat/cron, then 'responded'
--                   when the customer taps a button (captured in the
--                   inbound webhook path, same place automations see an
--                   interactive reply). 'skipped' / 'failed' are
--                   terminal too — every deal.won produces exactly one
--                   row (uq_csat_surveys_deal) so the sweep never
--                   re-queues.
--
-- RLS: any account member may read both tables; csat_config writes are
-- admin+ (settings form); csat_surveys is service-role-only for writes
-- (the dispatch + cron paths), same as ai_followup_log (migration 099).
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ---------- csat_config -------------------------------------------------

CREATE TABLE IF NOT EXISTS public.csat_config (
  account_id        UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled           BOOLEAN NOT NULL DEFAULT false,
  -- Approved WhatsApp template with quick-reply buttons. NULL until the
  -- admin picks one; the dispatch path no-ops while it is unset.
  template_name     TEXT,
  template_language TEXT,
  -- Number of rating buttons (1..scale). Kept small: WhatsApp allows at
  -- most 3 quick-reply buttons on a template, but a list-style template
  -- can carry 5, so both are permitted.
  scale             SMALLINT NOT NULL DEFAULT 5 CHECK (scale IN (3, 5)),
  -- Wait after the deal is won before the survey goes out. 0 = send
  -- immediately from the deal.won dispatch. Default 1 day so the
  -- delivery/appointment has actually happened. Max 14 days.
  delay_minutes     INTEGER NOT NULL DEFAULT 1440 CHECK (delay_minutes BETWEEN 0 AND 20160),
  -- Do not survey the same contact again within this many days.
  cooldown_days     INTEGER NOT NULL DEFAULT 30 CHECK (cooldown_days BETWEEN 0 AND 365),
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.csat_config ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON public.csat_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.csat_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS csat_config_select ON public.csat_config;
DROP POLICY IF EXISTS csat_config_insert ON public.csat_config;
DROP POLICY IF EXISTS csat_config_update ON public.csat_config;
DROP POLICY IF EXISTS csat_config_delete ON public.csat_config;
CREATE POLICY csat_config_select ON public.csat_config
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY csat_config_insert ON public.csat_config
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY csat_config_update ON public.csat_config
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY csat_config_delete ON public.csat_config
  FOR DELETE USING (is_account_member(account_id, 'admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.csat_config TO authenticated;
GRANT ALL ON public.csat_config TO service_role;

-- ---------- csat_surveys ---------------------------------------------

CREATE TABLE IF NOT EXISTS public.csat_surveys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  -- The won deal that triggered this survey. Unique (below) so the
  -- several deal.won dispatch sites can't each queue their own.
  deal_id         UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'responded', 'failed', 'skipped')),
  -- Snapshot of csat_config.scale at send time, so a later scale change
  -- doesn't retro-scramble how an old score is read.
  scale           SMALLINT NOT NULL DEFAULT 5,
  score           SMALLINT CHECK (score IS NULL OR score BETWEEN 1 AND 10),
  comment         TEXT,
  -- messages.id of the survey we sent (NULL until sent / on failure).
  sent_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  error           TEXT,
  skip_reason     TEXT,
  -- When the cron may send this row (created_at + config.delay_minutes).
  send_after      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  responded_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One survey per won deal — the dedupe backstop for the multiple
-- deal.won dispatch sites (deal status route, stage route, AI action).
CREATE UNIQUE INDEX IF NOT EXISTS uq_csat_surveys_deal
  ON public.csat_surveys (deal_id) WHERE deal_id IS NOT NULL;

-- The cron's working set: pending rows whose delay has elapsed.
CREATE INDEX IF NOT EXISTS idx_csat_surveys_pending
  ON public.csat_surveys (send_after) WHERE status = 'pending';

-- The inbound-capture lookup: "this contact's outstanding sent survey".
CREATE INDEX IF NOT EXISTS idx_csat_surveys_capture
  ON public.csat_surveys (account_id, contact_id, sent_at DESC) WHERE status = 'sent';

-- The KPIs page query (responses in a date window).
CREATE INDEX IF NOT EXISTS idx_csat_surveys_account_created
  ON public.csat_surveys (account_id, created_at DESC);

-- Cooldown lookup: recent surveys for a contact regardless of status.
CREATE INDEX IF NOT EXISTS idx_csat_surveys_contact_created
  ON public.csat_surveys (contact_id, created_at DESC);

ALTER TABLE public.csat_surveys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS csat_surveys_select ON public.csat_surveys;
CREATE POLICY csat_surveys_select ON public.csat_surveys
  FOR SELECT USING (is_account_member(account_id));
-- No INSERT/UPDATE/DELETE policy: only the service-role backend writes
-- (dispatch on deal.won, the cron send, the inbound capture).

GRANT SELECT ON public.csat_surveys TO authenticated;
GRANT ALL ON public.csat_surveys TO service_role;
