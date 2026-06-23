-- ============================================================
-- 027_push_subscriptions.sql — Web Push subscriptions (PWA)
--
-- Backs the PWA push-notification feature. Each row is one browser
-- push subscription (one device/browser) owned by a logged-in user
-- inside an account. When an inbound WhatsApp message arrives, the
-- webhook resolves who should be notified (the conversation's
-- assigned agent, or every owner/admin/agent in the account when it
-- is unassigned) and sends a Web Push to that user's active
-- subscriptions via the `web-push` library (service-role path).
--
-- Design notes
--   - Account-scoped AND user-scoped: `account_id` keeps tenants
--     isolated (a company never pushes to another company's devices),
--     `user_id` is the human who owns the device. Both ON DELETE
--     CASCADE so removing a user/account cleans up their endpoints.
--   - `endpoint` is the push service URL (FCM/APNs/Mozilla). It is
--     globally unique per subscription, so we UNIQUE it and upsert on
--     conflict (re-subscribing the same browser updates the keys and
--     re-activates instead of duplicating).
--   - `active` is flipped to false by the sender when the push
--     service returns 404/410 (subscription expired/unsubscribed),
--     so dead endpoints stop being retried.
--   - Unlike the reference implementation this is NOT anonymous and
--     has no `unique_code`: targeting is by authenticated user_id /
--     account, not by a shared code.
--
-- RLS
--   A subscription is private to the device owner: a user may only
--   see/insert/update/delete their own rows (`auth.uid() = user_id`),
--   with the INSERT additionally checked to belong to an account the
--   user is a member of. The webhook reads every target's rows with
--   the service-role client (RLS-bypassing) because it runs without
--   a Supabase session.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint     text NOT NULL UNIQUE,
  p256dh_key   text NOT NULL,
  auth_key     text NOT NULL,
  user_agent   text,                       -- display label for the device list
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

-- Hot path: "active subscriptions for these users in this account".
CREATE INDEX IF NOT EXISTS push_subscriptions_account_user_idx
  ON push_subscriptions (account_id, user_id)
  WHERE active;

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- SELECT/UPDATE/DELETE: only the device owner.
DROP POLICY IF EXISTS push_subscriptions_select ON push_subscriptions;
CREATE POLICY push_subscriptions_select ON push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subscriptions_update ON push_subscriptions;
CREATE POLICY push_subscriptions_update ON push_subscriptions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subscriptions_delete ON push_subscriptions;
CREATE POLICY push_subscriptions_delete ON push_subscriptions FOR DELETE
  USING (auth.uid() = user_id);

-- INSERT: the row must be the caller's own, and scoped to an account
-- the caller actually belongs to (mirrors the membership guard used
-- by the other account-scoped tables).
DROP POLICY IF EXISTS push_subscriptions_insert ON push_subscriptions;
CREATE POLICY push_subscriptions_insert ON push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id AND is_account_member(account_id));
