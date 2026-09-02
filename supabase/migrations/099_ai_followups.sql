-- ============================================================
-- 099_ai_followups.sql — automated follow-up nudges
--
-- When a customer goes quiet mid-conversation without scheduling a
-- demo, the account can have Chat Sandía send one or more follow-up
-- messages after a configurable delay. This is driven by a NEW cron
-- sweep (/api/ai/followups/cron), NOT the reactive inbound auto-reply
-- path — the AI only ever runs on an inbound message, so "message the
-- customer an hour after they went silent" needs a scheduler.
--
-- Two additive changes:
--
--   1. `ai_configs` gets the per-account settings: a master toggle, an
--      ordered `followups` step list (jsonb; each step is
--      { after_minutes, type: 'text'|'template', text?, template_name?,
--      template_language? } — validated app-side in
--      src/lib/ai/followups.ts), and an optional local working-hours
--      window so nudges only go out during business hours (the system
--      prompt already says "solo en horario laboral"; this makes it
--      real).
--
--   2. `ai_followup_log` records every attempt (success or failure) so
--      the sweep advances through the steps exactly once per silence
--      streak and never loops. A row whose `sent_at` is newer than the
--      contact's last inbound message counts as "this step was already
--      attempted"; a new inbound naturally resets the streak (older
--      rows fall behind the new cutoff) with no delete needed.
--
-- RLS on the log: any account member may read; writes are service-role
-- only (the cron) — RLS enabled with no write policy denies anon/auth,
-- service_role bypasses.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS followups_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS followups jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS followups_business_hours_only boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS followups_window_start_hour smallint NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS followups_window_end_hour smallint NOT NULL DEFAULT 18;

ALTER TABLE public.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_followups_window_chk;
ALTER TABLE public.ai_configs
  ADD CONSTRAINT ai_configs_followups_window_chk
  CHECK (
    followups_window_start_hour BETWEEN 0 AND 24
    AND followups_window_end_hour BETWEEN 0 AND 24
  );

CREATE TABLE IF NOT EXISTS public.ai_followup_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  -- 0-based index into ai_configs.followups at the time of the attempt.
  step_index INT NOT NULL,
  step_type TEXT NOT NULL CHECK (step_type IN ('text', 'template')),
  -- The persisted messages.id when the send succeeded; NULL when it
  -- failed (see `error`). Either way the row consumes the step so the
  -- sweep does not retry it forever.
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  error TEXT,
  -- The contact's last-inbound instant this nudge answered. Part of the
  -- idempotency key: a fresh inbound moves this forward, starting a new
  -- streak without touching old rows.
  since_customer_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The sweep's per-conversation working set: "attempts since <cutoff>".
CREATE INDEX IF NOT EXISTS idx_ai_followup_log_conv_sent
  ON public.ai_followup_log (conversation_id, sent_at DESC);

-- Backstop against two overlapping sweeps double-sending the same step
-- for the same silence streak (pg_cron every ~5 min makes an overlap
-- practically impossible, but the unique insert makes it safe anyway —
-- the second insert hits 23505 and the sweep skips it).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_followup_log_step
  ON public.ai_followup_log (conversation_id, since_customer_at, step_index);

ALTER TABLE public.ai_followup_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_followup_log_select ON public.ai_followup_log;
CREATE POLICY ai_followup_log_select ON public.ai_followup_log
  FOR SELECT USING (is_account_member(account_id));

GRANT SELECT ON public.ai_followup_log TO authenticated;
GRANT ALL ON public.ai_followup_log TO service_role;
