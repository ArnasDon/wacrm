# Nexara WACRM — Rebuild Decision Record v6

> Locks the open questions from the v5 review. This is the decision record the implementation agent follows. Reads on top of v5 (architecture) — v5 stays the architecture doc; v6 is the authoritative decision layer.

**Headline:** the Meta commercial billing model is a **business gate, not an implementation detail**. Confirm Solution Partner + credit-line eligibility with Meta before implementing the assumption that Nexara receives the Meta invoice. Architecture must keep both models swappable without touching WACRM messaging.

---

## 1. Release scope — Nexara-powered WACRM only

In scope this release:
```
Organization → Credits → Meta onboarding → WhatsApp → Contacts/Conversations → Messages → Inbox
```
**DEFERRED** (long-term Nexara OS direction, NOT this release): Work Hub, Calendar, Approvals, generic Work Items, Activities, Files-as-platform, mobile Action Center. Build only the platform foundation WACRM needs now (see §8). Everything else marked DEFERRED in `DO_NOT_BUILD_YET.md`.

## 2. Migration strategy — one-time cutover, evidence-gated

Effectively a new product with limited production data → do **not** over-engineer a strangler.
- **Phase-0 action:** establish real production counts first — organizations, users, contacts, conversations, messages, credit balances.
- If negligible (as expected) → **one-time migration / cutover**.
- Only build a long-running strangler if data volume actually proves it necessary.

Count query set to run against current production (Supabase) — record in `MIGRATION_MAP.md`:
```
count(organizations/accounts), count(users), count(contacts),
count(conversations), count(messages), sum/þcount(billing_credits balances)
```

## 3. Meta commercial billing — dual model, eligibility-gated

**Preferred:** Meta Solution Partner / credit-line.
```
Customer → Nexara Credits → WhatsApp → Meta
```
Customer buys Nexara Credits; Nexara meters usage and settles Meta charges.

**Fallback (if Meta requires direct WABA billing):**
```
Customer → Meta        (WhatsApp charges, customer WABA billed directly)
Customer → Nexara      (WACRM/Nexara service fee, separate)
```
- Make eligibility a **Phase-0 commercial gate** (`META_COMMERCIAL_BILLING_MODEL.md`). Do not blindly implement the preferred model.
- Architecture keeps Meta commercial billing **replaceable** — switching models must not change the WACRM messaging architecture. The credit/metering layer stays; only whether Nexara settles Meta (preferred) vs gates-own-sends + charges service fee (fallback) differs.

## 4. Nexara Credits — prepaid default

- **Prepaid is the only required production flow.** Customer must purchase credits before consuming WhatsApp usage.
  ```
  Customer buys ₹5,000 → Nexara Credit Wallet → WhatsApp usage consumes credits
  ```
- Insufficient available credits → **block/pause** new billable WhatsApp usage (deterministic insufficient-credit state, never silent send).
- **Postpaid NOT default.** Enterprise-only facility, added later: explicit Nexara approval, assigned credit limit, billing cycle/terms, spend controls, auto-suspend at limit.
- Data model must allow postpaid later, but prepaid is the only build target now.

## 5. Reservation / settlement lifecycle

Do not assume Meta usage confirmation arrives immediately.
```
available → reserved → settled
reserved  → released / expired
```
Every reservation carries: unique **idempotency key**, reservation ID, amount, customer/WABA/message reference, created-at, **expiry/TTL**, status.

Add **reconciliation** against authoritative Meta usage/billing data (confirmation may be delayed, duplicated, or missing) — periodic job, records in the ledger.

System must prevent: **double debit, duplicate settlement, lost reservation, negative prepaid balance.**

## 6. Database — benchmark before lock, correctness-first

D1 vs Neon/Postgres validated by real benchmark (`DATABASE_DECISION.md`). Benchmark the workload that matters: concurrent WhatsApp sends, concurrent credit reservations, retries, duplicate webhook/provider events, settlement, release/expiry, idempotency, concurrent wallet updates.

**Acceptance = correctness first:**
```
No negative balance
No double debit
No duplicate settlement
No lost reservation
```
If D1 cannot reliably satisfy these under realistic concurrency → **use Neon/Postgres.** Business modules stay behind `DatabaseProvider` either way.

## 7. Existing billing tables — map, don't discard

Migration 039 (`billing_credits` / `debit_message`) maps into the new Nexara Billing model:
```
billing_credits → credit_wallet
debit_message   → credit_ledger / usage_records
```
Preserve existing customer balances + transaction history where applicable. Document the exact mapping before implementation (`CREDITS_BILLING_DESIGN.md`).

## 8. Architecture principle — build only what WACRM needs now

Platform foundation to BUILD now: Organization/tenant, Auth, Permissions, Nexara Credits/Billing, Provider abstraction, Meta onboarding, WhatsApp, Contacts, Conversations, Messages, Inbox, required audit/usage infrastructure.
Everything else = **DEFERRED**. Do not build generic Nexara OS infra just because the long-term architecture contains it.

## 9. First production vertical slice — the acceptance test

```
Create Organization
  → Purchase/allocate Nexara Credits
  → Complete Meta Embedded Signup
  → Connect WhatsApp
  → Send WhatsApp message
  → Meta processes message
  → Usage recorded
  → Credits reserved/settled
  → Message appears in WACRM Inbox
```
This slice drives Phase-0/Phase-1 decisions — more important than implementing every WACRM screen.

---

## Capability classification (USE / ADAPT / BUILD / DEFER)

| Capability | Decision |
|---|---|
| Nexara container / guards / providers / RBAC | USE |
| Framework `AuthProvider` (extended: refresh/rotation/reset/verify/devices) | ADAPT/EXTEND |
| `DatabaseProvider` (D1 or Neon per benchmark) | USE + BUILD adapter |
| Existing WACRM features (contacts, conversations, messages, inbox, broadcasts, automation) | ADAPT (port into modules) |
| `billing_credits` / `debit_message` (039) | ADAPT (map into credit_wallet/ledger) |
| Nexara Credits: wallet, ledger, UsageMeter (reserve/settle), pricing | BUILD |
| PaymentProvider abstraction (market-first impl) | BUILD |
| `meta-onboarding` module + MetaBusinessProvider (Embedded Signup) | BUILD |
| WhatsAppProvider (MetaWhatsAppProvider) | ADAPT |
| Postpaid billing | DEFER (model now, build later) |
| Work Hub / Calendar / Approvals / Work Items / Action Center | DEFER |
| Generic multi-provider credit marketplace (AI/voice/etc.) | DEFER |
| AI spend caps / AI billing subsystem | DEFER |

## Phase-0 gates (must produce before substantial build)

`00_NEXARA_ARCHITECTURE_DECISIONS.md` · `ARCHITECTURE_GAP_REPORT.md` · `DATABASE_DECISION.md` · `MIGRATION_MAP.md` (incl. production counts) · `NEW_REPO_PLAN.md` · `AUTH_EXTENSION.md` · `CREDITS_BILLING_DESIGN.md` (reservation lifecycle + reconciliation + 039 mapping) · `META_FEASIBILITY_POC.md` · `META_ONBOARDING_FLOW.md` · **`META_COMMERCIAL_BILLING_MODEL.md` (commercial gate — blocks the billing model)** · `DO_NOT_BUILD_YET.md`

**Order of the two hard gates:** run the Meta commercial gate (§3) and the DB correctness benchmark (§6) early — both can invalidate downstream billing design. Do not write credit-ledger/settlement code before both return.
