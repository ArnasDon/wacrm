-- ============================================================
-- 060_push_subscriptions.sql — Web Push subscriptions
--
-- One row per browser/phone that opted in to push notifications
-- (service worker + Web Push). The inbound-message webhook reads this
-- table with the service-role client and pushes a notification to every
-- subscription in the account, so alerts arrive with the browser closed.
--
-- Additive only: a new table, nothing existing is altered.
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint     text NOT NULL UNIQUE,   -- push service URL (unique per browser install)
  p256dh       text NOT NULL,          -- client public key
  auth         text NOT NULL,          -- client auth secret
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_account_id_idx
  ON push_subscriptions (account_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON push_subscriptions (user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- A member can see and remove only their OWN device subscriptions.
-- Creating/refreshing rows and fan-out sending use the service-role
-- client after the API route has authenticated the caller.
DROP POLICY IF EXISTS push_subscriptions_select ON push_subscriptions;
CREATE POLICY push_subscriptions_select ON push_subscriptions FOR SELECT
  USING (user_id = auth.uid() AND is_account_member(account_id));

DROP POLICY IF EXISTS push_subscriptions_delete ON push_subscriptions;
CREATE POLICY push_subscriptions_delete ON push_subscriptions FOR DELETE
  USING (user_id = auth.uid());
