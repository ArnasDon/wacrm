-- ============================================================
-- 048: Template test sends
-- ============================================================
--
-- The Templates page's test tool sends an approved template to one
-- number and shows, live, the request it sent, Meta's API response and
-- the status webhooks Meta then posts for that message (sent →
-- delivered → read, or failed). Test sends create no contact,
-- conversation or message row, so their status webhooks would otherwise
-- be dropped; this table records them by wamid.
--
-- Only the service role touches it (the test routes after their own
-- role check, and the webhook) — RLS is on with no policies.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS template_test_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL,
  whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL,
  wamid TEXT NOT NULL UNIQUE,
  to_phone TEXT NOT NULL,
  request JSONB NOT NULL,
  response JSONB NOT NULL,
  -- Every status webhook for this wamid, in arrival order.
  statuses JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_template_test_sends_account
  ON template_test_sends (account_id, created_at DESC);

ALTER TABLE template_test_sends ENABLE ROW LEVEL SECURITY;
