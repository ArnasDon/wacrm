-- ============================================================
-- 056: Per-second campaign speed log
--
-- For every second a campaign sends, per channel: how many requests we
-- sent to Meta (retries included), how many Meta accepted, how many it
-- throttled (130429 "too fast") and how many it rejected otherwise, plus
-- the pace our limiter was running at. Shown in the campaign's Logs tab
-- ("what speed I sent vs what Meta accepted").
--
-- Written by the senders in small batches (src/lib/campaigns/speed-log.ts).
-- A second can appear in several rows when several workers send the same
-- campaign — readers add them up. Cleared with the campaign, and by the
-- daily data retention like everything else.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.campaign_speed_log (
  id                 BIGSERIAL PRIMARY KEY,
  account_id         UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  broadcast_id       UUID NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  -- No FK: a log line must never keep a channel from being removed.
  whatsapp_config_id UUID,
  second             TIMESTAMPTZ NOT NULL,
  sent               INTEGER NOT NULL DEFAULT 0,
  accepted           INTEGER NOT NULL DEFAULT 0,
  throttled          INTEGER NOT NULL DEFAULT 0,
  failed             INTEGER NOT NULL DEFAULT 0,
  -- Our limiter's pace (msg/s) during that second.
  limit_rate         NUMERIC(8, 2),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_speed_log_broadcast
  ON public.campaign_speed_log (broadcast_id, second);
CREATE INDEX IF NOT EXISTS idx_campaign_speed_log_account
  ON public.campaign_speed_log (account_id);
CREATE INDEX IF NOT EXISTS idx_campaign_speed_log_created
  ON public.campaign_speed_log (created_at);

-- Members read their own account's log; only the server writes it.
ALTER TABLE public.campaign_speed_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_speed_log_select ON public.campaign_speed_log;
CREATE POLICY campaign_speed_log_select ON public.campaign_speed_log
  FOR SELECT USING (is_account_member(account_id));
