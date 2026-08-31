# Plan: Prepaid credits / recharge billing model

**Goal:** Give each business account a **prepaid wallet**. The business recharges it; every **billable outbound message** deducts a configurable rate (default **₹1.50/message**). The platform admin sets the rate and controls how recharging works.

**Status:** Completed & Shipped (Migration `039_billing_credits.sql`, `charge.ts`, atomic RPCs, `/admin/billing`, wallet API).

### Confirmed decisions
- **Billable scope:** only **Meta-billable outbound** messages (template messages — broadcasts + template sends). Inbound customer replies and free 24h session replies are **not** charged (Meta doesn't charge you for them either — see §8).
- **Recharge method:** support **both** manual admin top-up **and** an online payment gateway, with a **platform-admin toggle** to switch which is active (`manual` / `gateway` / `both`).
- **Rate:** default ₹1.50/message, **configurable by the platform admin**, with an optional **per-account override**.

---

## 1. Concepts & roles

Two distinct admin levels — the current app only has the second:

| Role | Who | Powers |
|------|-----|--------|
| **Platform admin** | You / Nexara (the SaaS operator) | Set global rate & currency, switch recharge mode, do manual top-ups, set per-account overrides, view all wallets. **New concept — must be added.** |
| **Account admin/owner** | The business customer | Recharge their own wallet, view balance + transaction history. Already exists (`account_role` in migration 017). |

**Credit unit:** model the wallet balance in **credits**, where `1 credit = ₹1` by default (a configurable `credit_unit_value`). A message costs `per_message_rate` credits (default 1.50). Keeping balance and rate both in credits avoids currency-rounding drift; recharge converts money → credits at `credit_unit_value`.

---

## 2. What already exists (build on this)
- **Accounts + roles + `is_account_member(account_id, min_role)`** — `supabase/migrations/017_account_sharing.sql`.
- **Central outbound send core** — `src/lib/whatsapp/send-message.ts` → `sendMessageToConversation(db, accountId, params)`. Billable when `params.messageType === 'template'`. This is the single hook point for inbox + public-API template sends.
- **Broadcast send path** — `src/lib/whatsapp/broadcast-queue-processor.ts` → `processSingleRecipient()` (always a template send). Second hook point.
- **Automations/Flows template sends** — `src/lib/automations/meta-send.ts`, `src/lib/flows/meta-send.ts` (charge only when they send a template). Third/fourth hook points.
- **Meta's real cost reporting already wired** — `src/lib/whatsapp/pricing-analytics.ts` + `src/components/settings/whatsapp-usage.tsx` + the `usage` settings section. The wallet is a **separate flat-rate charge** (your markup); pricing-analytics stays as the "actual Meta cost" view for margin reconciliation.

---

## 3. Data model (new migration `0XX_billing_credits.sql`)

### 3a. Platform admin
```sql
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Seed the operator (replace with the real auth user id):
-- INSERT INTO platform_admins (user_id) VALUES ('<owner-user-id>') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION is_platform_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid());
$$;
ALTER FUNCTION is_platform_admin() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_platform_admin() TO authenticated, service_role;
```

### 3b. Global billing settings (singleton)
```sql
CREATE TABLE IF NOT EXISTS billing_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),      -- single-row guard
  default_per_message_rate NUMERIC(10,2) NOT NULL DEFAULT 1.50,
  currency TEXT NOT NULL DEFAULT 'INR',
  credit_unit_value NUMERIC(10,2) NOT NULL DEFAULT 1.00, -- ₹ per 1 credit
  recharge_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (recharge_mode IN ('manual','gateway','both')),
  gateway_provider TEXT DEFAULT 'razorpay',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO billing_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

ALTER TABLE billing_settings ENABLE ROW LEVEL SECURITY;
-- Everyone authenticated may READ (business UI needs rate + mode); only platform admin writes.
CREATE POLICY billing_settings_select ON billing_settings FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY billing_settings_update ON billing_settings FOR UPDATE USING (is_platform_admin()) WITH CHECK (is_platform_admin());
```

### 3c. Per-account wallet
```sql
CREATE TABLE IF NOT EXISTS account_wallets (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  per_message_rate_override NUMERIC(10,2),   -- NULL = use global default
  low_balance_threshold NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE account_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_wallets_select ON account_wallets FOR SELECT
  USING (is_account_member(account_id) OR is_platform_admin());
-- No client INSERT/UPDATE/DELETE — balance changes ONLY through the RPCs below.

-- Auto-create a wallet whenever an account is created.
CREATE OR REPLACE FUNCTION create_wallet_for_account() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO account_wallets (account_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_create_wallet ON accounts;
CREATE TRIGGER trg_create_wallet AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION create_wallet_for_account();
-- Backfill wallets for existing accounts:
INSERT INTO account_wallets (account_id) SELECT id FROM accounts ON CONFLICT DO NOTHING;
```

### 3d. Ledger (immutable audit of every balance change)
```sql
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('recharge','debit','adjustment','refund')),
  amount NUMERIC(12,2) NOT NULL,           -- +credit / -debit
  balance_after NUMERIC(12,2) NOT NULL,
  rate NUMERIC(10,2),                      -- rate applied on a debit
  reference_type TEXT,                     -- 'broadcast' | 'message' | 'payment' | 'admin'
  reference_id TEXT,
  note TEXT,
  created_by UUID,                         -- admin/user who initiated, if any
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_txn_account_time ON credit_transactions(account_id, created_at DESC);
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY credit_txn_select ON credit_transactions FOR SELECT
  USING (is_account_member(account_id) OR is_platform_admin());
-- Inserts happen only inside the SECURITY DEFINER RPCs below.
```

### 3e. Gateway orders (for the payment-gateway mode)
```sql
CREATE TABLE IF NOT EXISTS recharge_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'razorpay',
  provider_order_id TEXT UNIQUE,
  amount_money NUMERIC(12,2) NOT NULL,     -- what they pay
  credits NUMERIC(12,2) NOT NULL,          -- what they receive
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','failed')),
  provider_payment_id TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE recharge_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY recharge_orders_select ON recharge_orders FOR SELECT
  USING (is_account_member(account_id) OR is_platform_admin());
-- Writes via service-role routes only.
```

---

## 4. Atomic balance RPCs (the ONLY way balance moves)

All `SECURITY DEFINER`, `search_path = public`, owned by `postgres`. They keep balance and ledger consistent in one statement and prevent races.

```sql
-- Effective rate for an account.
CREATE OR REPLACE FUNCTION effective_rate(p_account_id UUID) RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(w.per_message_rate_override, s.default_per_message_rate)
  FROM billing_settings s
  LEFT JOIN account_wallets w ON w.account_id = p_account_id
  WHERE s.id = TRUE;
$$;

-- Debit one billable message. Returns TRUE if charged, FALSE if insufficient.
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
    RETURN FALSE;                         -- insufficient credits
  END IF;
  INSERT INTO credit_transactions(account_id,type,amount,balance_after,rate,reference_type,reference_id)
    VALUES (p_account_id,'debit',-v_rate,v_new,v_rate,p_reference_type,p_reference_id);
  RETURN TRUE;
END $$;

-- Add credits (manual top-up or gateway payment). Platform-admin gate is
-- enforced in the calling route for manual; gateway calls run as service role.
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
  INSERT INTO credit_transactions(account_id,type,amount,balance_after,reference_type,reference_id,note,created_by)
    VALUES (p_account_id,p_type,p_credits,v_new,p_reference_type,p_reference_id,p_note,p_created_by);
  RETURN v_new;
END $$;
```
Grant `EXECUTE` to `service_role` (and `authenticated` only where a route re-checks authorization). **Never** call these from the browser directly — always through a server route that authorizes first.

---

## 5. Charging integration (deduct on billable sends)

**Rule:** check balance **before** sending (don't call Meta with an empty wallet), debit **after** a successful Meta send (don't charge for failed sends).

Add one helper, e.g. `src/lib/billing/charge.ts`:
```ts
// Returns 'ok' | 'insufficient'. Uses the service-role client + debit_message RPC.
export async function chargeBillableMessage(
  accountId: string, referenceType: string, referenceId: string,
): Promise<'ok' | 'insufficient'> { /* rpc('debit_message', ...) → map result */ }

// Cheap pre-check without mutating (SELECT balance vs effective_rate).
export async function hasCreditsForOne(accountId: string): Promise<boolean> { /* ... */ }
```

Hook points (charge **only** template sends):
1. **`src/lib/whatsapp/send-message.ts` → `sendMessageToConversation`**: when `messageType === 'template'`, call `hasCreditsForOne` **before** the Meta send; if false, `throw new SendMessageError('insufficient_credits', 'Not enough credits — please recharge.', 402)`. After a successful send + DB insert, call `chargeBillableMessage(accountId, 'message', messageRecord.id)`.
2. **`src/lib/whatsapp/broadcast-queue-processor.ts` → `processSingleRecipient`**: before sending, if `debit`/pre-check fails, **stop draining** and leave the remaining recipients `pending`; mark the broadcast (e.g. a `paused_insufficient_credits` state or leave `sending` and surface a banner). After a successful send, `chargeBillableMessage(accountId, 'broadcast', broadcast.id)`. Because broadcasts pace at 2/min, a mid-broadcast empty wallet simply pauses; a later recharge resumes on the next cron tick.
3. **`src/lib/automations/meta-send.ts` & `src/lib/flows/meta-send.ts`**: charge only on the template-send branch, same before/after pattern; on insufficient, skip the send and log (don't crash the flow/automation run).

> Keep the flat-rate charge independent of Meta's category pricing — the user wants a single configurable ₹1.50, not pass-through. `pricing_analytics` remains the separate "real Meta cost" report.

---

## 6. Recharge flows

### 6a. Manual admin top-up (platform admin)
- Route `POST /api/admin/billing/recharge` — server checks `is_platform_admin()` (via the session), then `rpc('credit_wallet', { account, credits, type:'recharge', reference_type:'admin', note, created_by:user.id })`.
- Use case: business pays offline (UPI/bank), platform admin credits the wallet.

### 6b. Payment gateway (self-serve) — recommend **Razorpay** (INR, UPI/cards)
- `POST /api/billing/recharge/order` — business admin picks an amount → server creates a `recharge_orders` row + a Razorpay order → returns order id/key to the client.
- Client opens Razorpay checkout.
- `POST /api/billing/razorpay/webhook` — **verify the webhook signature** (mirror the HMAC discipline in `src/lib/whatsapp/webhook-signature.ts`), then on `payment.captured`: mark the order `paid` and `rpc('credit_wallet', ... type:'recharge', reference_type:'payment', reference_id: payment_id)`. **Idempotent** on `provider_payment_id` so retried webhooks don't double-credit.
- Secrets (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) in env, never client-side. Keep a thin provider abstraction so Stripe can be swapped in.
- **Prohibited-action note:** do not have Claude/agents enter card or payment credentials anywhere — the gateway's own hosted checkout collects payment; the app only creates orders and verifies signed webhooks.

### 6c. Mode switch
- `billing_settings.recharge_mode` (`manual` / `gateway` / `both`) — set by platform admin. Business recharge UI reads it and shows: manual instructions only, gateway button only, or both.

---

## 7. UI

### 7a. Business side — extend the existing **Settings → "Usage & billing"** (`usage` section)
- **Wallet card:** current balance (credits + ₹ equivalent), effective per-message rate, low-balance warning when `balance < low_balance_threshold` or below N messages.
- **Recharge:** mode-aware (manual instructions and/or "Recharge" gateway button).
- **Transaction history:** table from `credit_transactions` (date, type, amount, balance after, reference, note).
- **Send-blocked banner:** when balance can't cover one message, show a persistent "Recharge to keep sending" notice (broadcasts pause; inbox template sends return the 402 above — surface it as a toast).

### 7b. Platform admin side — new `/admin/billing` (gated by `is_platform_admin`)
- Global: default rate, currency, `credit_unit_value`, recharge mode toggle.
- Per account: list wallets/balances, set `per_message_rate_override`, manual top-up, view any account's ledger.
- Route-guard every admin page/endpoint server-side with `is_platform_admin()` — never rely on hiding UI alone.

---

## 8. Meta pricing context (why "outbound template only")
Meta's current model (per-message since 2025-07-01, as documented in `pricing-analytics.ts`):
- **Inbound** customer replies → **free** (Meta never bills to receive).
- **Your reply within the 24h service window** (non-template session message) → **free** (`SERVICE` / `FREE_*` unbilled).
- **Template messages** (`MARKETING` / `UTILITY` / `AUTHENTICATION`, incl. broadcasts and re-opening a chat after 24h) → **charged per delivered message**.

So charging credits only on outbound template sends mirrors your real Meta cost; inbox conversations cost the business nothing, matching what Meta charges you.

---

## 9. Security / correctness checklist
- [ ] Balance changes **only** via the SECURITY DEFINER RPCs; no client write policy on `account_wallets` / `credit_transactions`.
- [ ] `debit_message` is atomic (`balance >= rate` in the same `UPDATE`) → no oversell under concurrency.
- [ ] Charge **after** a confirmed Meta send; **pre-check** before, to avoid sending on empty.
- [ ] Gateway webhook signature-verified and **idempotent** on payment id.
- [ ] Platform-admin endpoints re-check `is_platform_admin()` server-side.
- [ ] Never charge inbound or session messages (only `messageType === 'template'` / broadcast/template paths).

---

## 10. Files touched
- **New migration:** `supabase/migrations/0XX_billing_credits.sql` (tables + RPCs + triggers + seed).
- **New:** `src/lib/billing/charge.ts` (charge/pre-check helpers), `src/lib/billing/rate.ts` (effective-rate read) as needed.
- **New routes:** `src/app/api/admin/billing/...` (settings, manual recharge, overrides), `src/app/api/billing/recharge/order/route.ts`, `src/app/api/billing/razorpay/webhook/route.ts`.
- **Edit (charge hooks):** `src/lib/whatsapp/send-message.ts`, `src/lib/whatsapp/broadcast-queue-processor.ts`, `src/lib/automations/meta-send.ts`, `src/lib/flows/meta-send.ts`.
- **Edit (UI):** the `usage` settings section components (wallet card, history, recharge), + new `/admin/billing` pages.
- **Env:** Razorpay keys + webhook secret.

---

## 11. Suggested build order
1. Migration (tables + RPCs + wallet backfill) — no behavior change yet.
2. Charge helper + wire into `send-message.ts` and the broadcast processor (core money path).
3. Business wallet UI + manual admin top-up (unblocks real use with `recharge_mode='manual'`).
4. Platform admin `/admin/billing` (rate, overrides, mode toggle).
5. Razorpay gateway + webhook (flip mode to `gateway`/`both`).
6. Automations/flows charge hooks + low-balance UX polish.

---

## 12. Verification
1. Recharge (manual) 100 credits → balance 100; send 1 template → balance 98.50; ledger shows a `debit` of -1.50 with `balance_after` 98.50.
2. Broadcast to N recipients with balance for only K → K sent + charged, broadcast pauses with remaining `pending`; recharge → resumes on next cron tick.
3. Inbound reply + a 24h-window text reply → **no** debit.
4. Set a per-account override to 2.00 → next template debits 2.00.
5. Switch `recharge_mode` manual→gateway → business UI swaps from instructions to the pay button.
6. Gateway webhook replayed twice → credited once (idempotent).
7. Non-platform-admin hitting `/api/admin/billing/*` → 403.
