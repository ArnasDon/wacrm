-- ============================================================
-- 053_campaign_delivery_settings
--
-- The campaign wizard's "Advanced delivery settings":
--
--   1. Campaign interval — a campaign with the interval on starts at
--      least N seconds after the previous campaign of the account
--      STARTED (they may overlap while sending). The gate is one row per
--      account, claimed with a single conditional upsert, so any number
--      of workers / restarts agree on who may start.
--   2. Pause on quality hold / 3. Stop on Meta API error — both can
--      stop a campaign part-way: new status 'paused' (pending recipients
--      stay pending; "Resume" continues).
--
-- Also stores Meta's per-message submit status (e.g.
-- 'held_for_quality_assessment') on each recipient.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ── 'paused' campaign status ───────────────────────────────────
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_status_check;
ALTER TABLE broadcasts
  ADD CONSTRAINT broadcasts_status_check
  CHECK (status IN ('draft', 'scheduled', 'sending', 'paused', 'sent', 'failed'));

-- ── Meta's submit status per recipient ─────────────────────────
ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS meta_message_status TEXT;

COMMENT ON COLUMN broadcast_recipients.meta_message_status IS
  'message_status Meta returned when accepting the send (e.g. accepted, held_for_quality_assessment). Final delivery comes from the webhook.';

-- ── Campaign start gate (interval between campaign starts) ─────
CREATE TABLE IF NOT EXISTS campaign_start_gates (
  account_id      UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  last_started_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE campaign_start_gates ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (campaign runners) touches it.

-- Record a campaign start. With p_enforce, only succeed when the last
-- start was at least p_interval_seconds ago. Returns 0 when this start
-- is recorded (go), else the seconds still to wait.
CREATE OR REPLACE FUNCTION public.claim_campaign_start(
  p_account_id       UUID,
  p_interval_seconds INTEGER,
  p_enforce          BOOLEAN
)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  n    INTEGER;
  wait DOUBLE PRECISION;
BEGIN
  IF NOT p_enforce THEN
    INSERT INTO campaign_start_gates (account_id, last_started_at)
    VALUES (p_account_id, now())
    ON CONFLICT (account_id) DO UPDATE SET last_started_at = now();
    RETURN 0;
  END IF;

  INSERT INTO campaign_start_gates (account_id, last_started_at)
  VALUES (p_account_id, now())
  ON CONFLICT (account_id) DO UPDATE SET last_started_at = now()
  WHERE campaign_start_gates.last_started_at
        <= now() - make_interval(secs => p_interval_seconds);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RETURN 0;
  END IF;

  SELECT GREATEST(
           0,
           EXTRACT(EPOCH FROM (last_started_at + make_interval(secs => p_interval_seconds) - now()))
         )
    INTO wait
    FROM campaign_start_gates
   WHERE account_id = p_account_id;
  RETURN COALESCE(wait, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_campaign_start(UUID, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_campaign_start(UUID, INTEGER, BOOLEAN) TO service_role;

-- ── Batched result writes carry the Meta status too (052 + column) ─
CREATE OR REPLACE FUNCTION public.apply_recipient_results(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  UPDATE broadcast_recipients r
  SET status              = x.status,
      sent_at             = COALESCE(x.sent_at, r.sent_at),
      whatsapp_message_id = COALESCE(x.whatsapp_message_id, r.whatsapp_message_id),
      error_message       = x.error_message,
      whatsapp_config_id  = COALESCE(x.whatsapp_config_id, r.whatsapp_config_id),
      template_name       = COALESCE(x.template_name, r.template_name),
      template_language   = COALESCE(x.template_language, r.template_language),
      meta_message_status = COALESCE(x.meta_message_status, r.meta_message_status)
  FROM jsonb_to_recordset(p_rows) AS x(
    id                  UUID,
    status              TEXT,
    sent_at             TIMESTAMPTZ,
    whatsapp_message_id TEXT,
    error_message       TEXT,
    whatsapp_config_id  UUID,
    template_name       TEXT,
    template_language   TEXT,
    meta_message_status TEXT
  )
  WHERE r.id = x.id
    AND r.status = 'pending'
    AND x.status IN ('sent', 'failed');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_recipient_results(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_recipient_results(JSONB) TO service_role;
