-- ============================================================
-- PUSH SUBSCRIPTIONS (custom feature, not part of the upstream
-- template) — Web Push endpoints registered by installed PWA
-- clients (iPhone "Add to Home Screen" etc.), so new inbound
-- WhatsApp messages can trigger a device notification.
-- ============================================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_account
  ON push_subscriptions(account_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_select ON push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_insert ON push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_delete ON push_subscriptions;

-- Members can see subscriptions for their own account (so the UI can
-- show "notifications enabled on N devices"), but only ever insert or
-- delete their own — server-side send uses the service-role key and
-- bypasses RLS entirely.
CREATE POLICY push_subscriptions_select ON push_subscriptions FOR SELECT
  USING (
    account_id IN (SELECT account_id FROM profiles WHERE user_id = auth.uid())
  );
CREATE POLICY push_subscriptions_insert ON push_subscriptions FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM profiles WHERE user_id = auth.uid())
  );
CREATE POLICY push_subscriptions_delete ON push_subscriptions FOR DELETE
  USING (user_id = auth.uid());
