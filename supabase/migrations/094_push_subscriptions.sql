-- ============================================================
-- 094_push_subscriptions.sql — Web Push subscriptions
--
-- One row per browser/device a signed-in user has opted into push on.
-- A user can have several (phone + laptop). The row stores the raw
-- PushSubscription (endpoint + the two keys) so the server can call the
-- browser's push service directly with the `web-push` library.
--
-- Populated by POST /api/push/subscribe (the RLS client, scoped to the
-- caller). Read/pruned by the fanout + test routes. Dead subscriptions
-- (404/410 from the push service, or 5 consecutive failures) are
-- deleted by `sendPushToUser`.
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- A user owns their own device subscriptions, full stop. No account-
-- member visibility — a teammate has no reason to see your devices.
DROP POLICY IF EXISTS push_subscriptions_select ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_insert ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_update ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_delete ON public.push_subscriptions;

CREATE POLICY push_subscriptions_select ON public.push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY push_subscriptions_insert ON public.push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY push_subscriptions_update ON public.push_subscriptions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY push_subscriptions_delete ON public.push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
