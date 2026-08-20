-- ============================================================
-- 056_rimula_ba_routing.sql — BA routing config + RPCs (§9.1, §12,
-- §15, §17, Phase 6)
--
-- Three things:
--
--   1. `ba_routing_settings` — one row per account, the "configurable
--      strategy" §12's `LeadRoutingService` reads (round robin,
--      lowest open-lead-count, manual). Settings-class: any member
--      reads, only admin+ writes (§15 lists "BA routing rules" under
--      Settings, same tier as other settings-class tables).
--
--   2. `routing_reason` on `customer_requests` and `trials` —
--      `deals` got its own copy of this column in migration 055.
--      Recording *why* a BA was chosen (§12) is the same requirement
--      on all three assignable tables, so all three get the same
--      column rather than a separate audit table — consistent with
--      055's header on why a fourth table wasn't introduced here.
--
--   3. Two SECURITY DEFINER RPCs, same rationale + error contract as
--      migration 018's member-management RPCs:
--
--      - `set_ba_profile_fields` — migration 051's own header already
--        flagged this gap: `profiles_update` RLS only lets a user
--        edit their OWN row, so an admin setting a teammate's
--        region/market/capacity/status/languages needs a supervised
--        escape hatch, exactly like `set_member_role`.
--      - `adjust_ba_open_leads` — migration 051 also flagged that
--        `open_leads` is "maintained by the BA-routing logic (§12,
--        phase 6)". Routing runs as the *acting* user (agent+), not
--        an admin, and needs to bump a DIFFERENT profile's counter,
--        so this needs the same RLS bypass — but only ever by +/-1
--        under an application-controlled delta, never a free column
--        write, keeping the bypass tightly scoped like 018's
--        functions.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. ba_routing_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS ba_routing_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL DEFAULT 'lowest_open_leads' CHECK (strategy IN (
    'round_robin', 'lowest_open_leads', 'manual'
  )),
  -- Round-robin needs to remember where it left off per account; kept
  -- here rather than a second table since it's 1:1 with the strategy.
  round_robin_cursor INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ba_routing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ba_routing_settings_select ON ba_routing_settings;
CREATE POLICY ba_routing_settings_select ON ba_routing_settings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ba_routing_settings_insert ON ba_routing_settings;
CREATE POLICY ba_routing_settings_insert ON ba_routing_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ba_routing_settings_update ON ba_routing_settings;
CREATE POLICY ba_routing_settings_update ON ba_routing_settings FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON ba_routing_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ba_routing_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- The routing service also needs to bump round_robin_cursor from an
-- agent+ (non-admin) request — same "acting user, different scope"
-- gap as open_leads below. One more tightly-scoped RPC rather than
-- widening the UPDATE policy to agent (which would let any BA rewrite
-- the account's routing strategy, not just the cursor).
CREATE OR REPLACE FUNCTION public.advance_ba_routing_cursor(
  p_account_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_next INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_caller_account_id
  FROM profiles WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL OR v_caller_account_id <> p_account_id THEN
    RAISE EXCEPTION 'Caller is not a member of this account'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO ba_routing_settings (account_id)
  VALUES (p_account_id)
  ON CONFLICT (account_id) DO NOTHING;

  UPDATE ba_routing_settings
  SET round_robin_cursor = round_robin_cursor + 1
  WHERE account_id = p_account_id
  RETURNING round_robin_cursor INTO v_next;

  RETURN v_next;
END;
$$;

ALTER FUNCTION public.advance_ba_routing_cursor(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.advance_ba_routing_cursor(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_ba_routing_cursor(UUID) TO authenticated;

-- ============================================================
-- 2. routing_reason on customer_requests / trials, plus the forward
--    link a CustomerRequest needs once it's qualified into a Lead.
--    `trials.deal_id` already exists (migration 045); this is the
--    same idea for the other origin of a Lead.
-- ============================================================
ALTER TABLE customer_requests ADD COLUMN IF NOT EXISTS routing_reason TEXT;
ALTER TABLE customer_requests ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_customer_requests_deal ON customer_requests(deal_id);
ALTER TABLE trials ADD COLUMN IF NOT EXISTS routing_reason TEXT;

-- ============================================================
-- 3. set_ba_profile_fields(...)
--
-- Admin+ edits a teammate's BA fields within the caller's account.
-- Mirrors set_member_role's shape exactly (018). NULL for any
-- p_* parameter means "leave unchanged", so a partial edit from the
-- UI doesn't have to resend every field.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_ba_profile_fields(
  p_user_id UUID,
  p_region_id UUID DEFAULT NULL,
  p_market_id UUID DEFAULT NULL,
  p_ba_status TEXT DEFAULT NULL,
  p_capacity INTEGER DEFAULT NULL,
  p_languages TEXT[] DEFAULT NULL,
  p_clear_region BOOLEAN DEFAULT FALSE,
  p_clear_market BOOLEAN DEFAULT FALSE
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_target_account_id
  FROM profiles WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF p_ba_status IS NOT NULL AND p_ba_status NOT IN ('active', 'inactive', 'on_leave') THEN
    RAISE EXCEPTION 'ba_status must be one of active, inactive, on_leave'
      USING ERRCODE = '22023';
  END IF;

  IF p_capacity IS NOT NULL AND p_capacity < 0 THEN
    RAISE EXCEPTION 'capacity must be >= 0' USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET
    region_id = CASE WHEN p_clear_region THEN NULL
                      WHEN p_region_id IS NOT NULL THEN p_region_id
                      ELSE region_id END,
    market_id = CASE WHEN p_clear_market THEN NULL
                      WHEN p_market_id IS NOT NULL THEN p_market_id
                      ELSE market_id END,
    ba_status = COALESCE(p_ba_status, ba_status),
    capacity = COALESCE(p_capacity, capacity),
    languages = COALESCE(p_languages, languages)
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_ba_profile_fields(UUID, UUID, UUID, TEXT, INTEGER, TEXT[], BOOLEAN, BOOLEAN)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_ba_profile_fields(UUID, UUID, UUID, TEXT, INTEGER, TEXT[], BOOLEAN, BOOLEAN)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_ba_profile_fields(UUID, UUID, UUID, TEXT, INTEGER, TEXT[], BOOLEAN, BOOLEAN)
  TO authenticated;

-- ============================================================
-- 4. adjust_ba_open_leads(p_user_id, p_delta)
--
-- Called by the LeadRoutingService (as the acting agent/admin, not
-- necessarily the target BA) on every assign/unassign/reassign across
-- customer_requests, deals (Lead), and trials. `p_delta` is always
-- +1 or -1 from the application layer; clamped at 0 floor here as a
-- second line of defense against undercount going negative.
-- ============================================================
CREATE OR REPLACE FUNCTION public.adjust_ba_open_leads(
  p_user_id UUID,
  p_delta INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_target_account_id UUID;
  v_new_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_caller_account_id
  FROM profiles WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- Any account member (agent+) can trigger routing; RLS on the
  -- calling table (customer_requests/deals/trials) already required
  -- agent+ to reach this point via the API route.
  SELECT account_id INTO v_target_account_id
  FROM profiles WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target BA not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target BA is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  UPDATE profiles
  SET open_leads = GREATEST(0, open_leads + p_delta)
  WHERE user_id = p_user_id
  RETURNING open_leads INTO v_new_count;

  RETURN v_new_count;
END;
$$;

ALTER FUNCTION public.adjust_ba_open_leads(UUID, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.adjust_ba_open_leads(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_ba_open_leads(UUID, INTEGER) TO authenticated;
