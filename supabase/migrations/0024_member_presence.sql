-- ============================================================
-- 024_member_presence.sql — team member presence (online / away)
--
-- Adds a lightweight presence layer so the Team members roster (and
-- the inbox Assign dropdown) can show who is actively using the
-- dashboard, idle, or gone. Implements wacrm#269.
--
-- Design
--
--   The active client heartbeats its own row through the
--   `touch_presence` RPC roughly every 30s, storing only 'online'
--   or 'away'. "Offline" is NOT stored — viewers derive it from
--   staleness (`now() - last_seen_at` beyond a threshold), so a
--   closed tab / logout resolves to offline automatically without
--   relying on an unreliable unload write.
--
--   A dedicated table keeps the high-write heartbeat off the
--   otherwise-stable `profiles` row and scopes Realtime cleanly.
--
-- Visibility
--
--   Any account member can read presence for their account — the
--   same visibility as the read-only roster (`is_account_member`).
--   Writes go ONLY through the SECURITY DEFINER RPC, which derives
--   the account from the caller's profile (never client-supplied).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- table -------------------------------------------------
CREATE TABLE IF NOT EXISTS member_presence (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'away')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_presence_account_idx
  ON member_presence(account_id);

-- ---- RLS ---------------------------------------------------
ALTER TABLE member_presence ENABLE ROW LEVEL SECURITY;

-- Account members may read every presence row for their account.
-- No client INSERT/UPDATE/DELETE policy exists: all writes flow
-- through touch_presence() below.
DROP POLICY IF EXISTS member_presence_select ON member_presence;
CREATE POLICY member_presence_select ON member_presence FOR SELECT
  USING (is_account_member(account_id));

-- ---- heartbeat RPC -----------------------------------------
-- Upserts the caller's presence row. SECURITY DEFINER so it can
-- write despite the absence of a client write policy; the account
-- is resolved from the caller's own profile, so a client can never
-- spoof which account it appears in.
CREATE OR REPLACE FUNCTION public.touch_presence(
  p_status TEXT DEFAULT 'online'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('online', 'away') THEN
    RAISE EXCEPTION 'Invalid presence status: %', p_status
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  INSERT INTO member_presence (user_id, account_id, status, last_seen_at)
  VALUES (auth.uid(), v_account_id, p_status, now())
  ON CONFLICT (user_id) DO UPDATE
    SET status       = excluded.status,
        last_seen_at = now(),
        account_id   = excluded.account_id;
END;
$$;

-- ---- realtime ----------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'member_presence'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE member_presence;
  END IF;
END $$;
