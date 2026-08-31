-- ============================================================
-- 039_billing_credits.sql — Prepaid credits / recharge billing model
-- ============================================================

-- 1. Global billing settings (singleton table)
CREATE TABLE IF NOT EXISTS billing_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  default_per_message_rate NUMERIC(10,2) NOT NULL DEFAULT 1.50,
  currency TEXT NOT NULL DEFAULT 'INR',
  credit_unit_value NUMERIC(10,2) NOT NULL DEFAULT 1.00,
  recharge_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (recharge_mode IN ('manual','gateway','both')),
  gateway_provider TEXT DEFAULT 'razorpay',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO billing_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

ALTER TABLE billing_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_settings_select ON billing_settings;
CREATE POLICY billing_settings_select ON billing_settings FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS billing_settings_update ON billing_settings;
CREATE POLICY billing_settings_update ON billing_settings FOR UPDATE USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- 2. Per-account wallets
CREATE TABLE IF NOT EXISTS account_wallets (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  per_message_rate_override NUMERIC(10,2),
  low_balance_threshold NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE account_wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_wallets_select ON account_wallets;
CREATE POLICY account_wallets_select ON account_wallets FOR SELECT
  USING (is_account_member(account_id) OR is_platform_admin());

-- Auto-create wallet trigger
CREATE OR REPLACE FUNCTION create_wallet_for_account() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO account_wallets (account_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_create_wallet ON accounts;
CREATE TRIGGER trg_create_wallet AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION create_wallet_for_account();

-- Backfill wallets for existing accounts
INSERT INTO account_wallets (account_id) SELECT id FROM accounts ON CONFLICT DO NOTHING;

-- 3. Credit transactions ledger
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('recharge','debit','adjustment','refund')),
  amount NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  rate NUMERIC(10,2),
  reference_type TEXT,
  reference_id TEXT,
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_txn_account_time ON credit_transactions(account_id, created_at DESC);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_txn_select ON credit_transactions;
CREATE POLICY credit_txn_select ON credit_transactions FOR SELECT
  USING (is_account_member(account_id) OR is_platform_admin());

-- 4. Recharge orders (for gateway integration)
CREATE TABLE IF NOT EXISTS recharge_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'razorpay',
  provider_order_id TEXT UNIQUE,
  amount_money NUMERIC(12,2) NOT NULL,
  credits NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','failed')),
  provider_payment_id TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE recharge_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recharge_orders_select ON recharge_orders;
CREATE POLICY recharge_orders_select ON recharge_orders FOR SELECT
  USING (is_account_member(account_id) OR is_platform_admin());

-- 5. RPCs for billing logic

-- Effective per-message rate for an account
CREATE OR REPLACE FUNCTION effective_rate(p_account_id UUID) RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(w.per_message_rate_override, s.default_per_message_rate)
  FROM billing_settings s
  LEFT JOIN account_wallets w ON w.account_id = p_account_id
  WHERE s.id = TRUE;
$$;
ALTER FUNCTION effective_rate(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION effective_rate(UUID) TO authenticated, service_role;

-- Debit message RPC (atomic)
CREATE OR REPLACE FUNCTION debit_message(
  p_account_id UUID, p_reference_type TEXT, p_reference_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rate NUMERIC; v_new NUMERIC;
BEGIN
  v_rate := effective_rate(p_account_id);
  UPDATE account_wallets
    SET balance = balance - v_rate, updated_at = NOW()
    WHERE account_id = p_account_id AND balance >= v_rate
    RETURNING balance INTO v_new;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  INSERT INTO credit_transactions(account_id, type, amount, balance_after, rate, reference_type, reference_id)
    VALUES (p_account_id, 'debit', -v_rate, v_new, v_rate, p_reference_type, p_reference_id);
  RETURN TRUE;
END $$;
ALTER FUNCTION debit_message(UUID, TEXT, TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION debit_message(UUID, TEXT, TEXT) TO authenticated, service_role;

-- Credit wallet RPC (recharge / top-up)
CREATE OR REPLACE FUNCTION credit_wallet(
  p_account_id UUID, p_credits NUMERIC, p_type TEXT,
  p_reference_type TEXT, p_reference_id TEXT, p_note TEXT, p_created_by UUID
) RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new NUMERIC;
BEGIN
  IF p_credits <= 0 THEN RAISE EXCEPTION 'credits must be positive'; END IF;
  UPDATE account_wallets SET balance = balance + p_credits, updated_at = NOW()
    WHERE account_id = p_account_id RETURNING balance INTO v_new;
  INSERT INTO credit_transactions(account_id, type, amount, balance_after, reference_type, reference_id, note, created_by)
    VALUES (p_account_id, p_type, p_credits, v_new, p_reference_type, p_reference_id, p_note, p_created_by);
  RETURN v_new;
END $$;
ALTER FUNCTION credit_wallet(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION credit_wallet(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role;
