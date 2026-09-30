-- ============================================================
-- 052_apply_recipient_results
--
-- High-throughput campaigns (up to 1 000 messages/s per number) can't
-- afford one UPDATE round-trip per recipient. The senders buffer results
-- and apply up to a few hundred per call through this function: one
-- statement, one transaction.
--
-- Only rows still 'pending' are touched, so a late write can never
-- overwrite a status the webhook already advanced (delivered / read).
-- The per-status counters stay trigger-maintained (migrations 003/005).
--
-- Idempotent — safe to re-run.
-- ============================================================

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
      template_language   = COALESCE(x.template_language, r.template_language)
  FROM jsonb_to_recordset(p_rows) AS x(
    id                  UUID,
    status              TEXT,
    sent_at             TIMESTAMPTZ,
    whatsapp_message_id TEXT,
    error_message       TEXT,
    whatsapp_config_id  UUID,
    template_name       TEXT,
    template_language   TEXT
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
