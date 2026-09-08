# CREDITS_BILLING_DESIGN — Nexara Credits (design only)

**Build gate:** design now; do NOT implement `credit_ledger` / reservation / settlement code until BOTH gates pass — Meta commercial model (META_COMMERCIAL_BILLING_MODEL) + DB correctness benchmark (DATABASE_DECISION). Prepaid is the only required V1 flow. Postpaid = enterprise-only, deferred (design the schema to allow it, don't build it).

## Model (V1 = Tech-Provider fallback)
Prepaid credits = access-control + Nexara service margin. Meta bills the customer's own WABA directly (fallback). Same schema serves the preferred Solution-Partner model later, where credits additionally settle Meta — the settlement target is a strategy behind the billing boundary, swappable without touching messaging.

## Entities
`plans` · `subscriptions` · `credit_wallets` · `credit_ledger` (immutable, append-only) · `credit_reservations` · `usage_records` · `pricing_rules` · `payment_transactions`.

**Ledger** — every balance change has a traceable reason: `purchase | monthly_grant | promotional_credit | whatsapp_usage | refund | manual_adjustment | expiry`. Never mutate balance without a ledger row.

**Reservation lifecycle**
```
available → reserved → settled
reserved  → released / expired
```
Each reservation: unique **idempotency_key**, reservation_id, amount, customer/WABA/message ref, created_at, **expiry/TTL**, status.

## UsageMeter (provider-neutral; only WhatsApp impl now)
```ts
interface UsageMeter {
  reserve(input: UsageRequest): Promise<UsageReservation>;
  settle(reservationId: string, actualUsage: Usage): Promise<void>;
  release(reservationId: string): Promise<void>;
}
```
- Usage known only after provider processing → `reserve → execute → settle`.
- Deterministic usage → atomic debit with idempotency key.
- Atomic conditional debit (prevents negative balance):
  ```sql
  UPDATE credit_wallets SET balance = balance - ?
   WHERE account_id = ? AND balance >= ?
  ```
  then assert `rows_written === 1`; else insufficient/conflict.

## Reconciliation (required — confirmation may be delayed/duplicated/missing)
Periodic job reconciles reservations against authoritative Meta usage (read via WABA usage/analytics API): settle confirmed, release expired (past TTL, no confirmation), detect + drop duplicates. Must prevent: double debit, duplicate settlement, lost reservation, negative balance.

## Insufficient credits
Block/pause new billable WhatsApp usage. Deterministic `INSUFFICIENT_BALANCE` state; surface top-up; record rejected attempt. Never silent-send a paid op.

## Payments
`PaymentProvider` abstraction (createPayment/verifyPayment/refund). Credits granted only after **server-side** payment verification / webhook confirmation. First impl market-driven (Razorpay/INR likely). Not hard-coded to one SDK.

## Existing data
No wallet/credit data exists in the probed project (MIGRATION_MAP) → greenfield. If a different production project holds `account_wallets`/`credit_transactions` with balances, map `account_wallets → credit_wallets`, `credit_transactions → credit_ledger/usage_records`, preserve balances + history; document mapping before build.
