-- push_subscriptions_insert alone isn't enough for the subscribe
-- endpoint's upsert(onConflict: 'endpoint') — re-subscribing the same
-- device takes the UPDATE path. Without this policy that path is
-- silently rejected by RLS.
DROP POLICY IF EXISTS push_subscriptions_update ON push_subscriptions;
CREATE POLICY push_subscriptions_update ON push_subscriptions FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND account_id IN (SELECT account_id FROM profiles WHERE user_id = auth.uid())
  );
