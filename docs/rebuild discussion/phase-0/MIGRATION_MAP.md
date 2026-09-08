# Phase 0A — Production Data & Migration Decision

Read-only counts run 2026-09-09 against the Supabase project in `.env.local` (project ref `hwawmkhhyddzkrgjniez`), service-role key (bypasses RLS → global counts).

## Counts

| Entity | Count |
|---|---|
| accounts (organizations) | **3** |
| profiles (users) | **3** |
| contacts | **349** |
| conversations | **41** |
| messages (inbox) | **66** |
| broadcasts | **17** |
| broadcast_recipients | **3,142** |
| message_templates | 14 |
| account_invitations | 1 |
| pipelines / deals | 2 / 0 |
| notifications / api_keys / ai_configs | 0 / 0 / 0 |

**Messages span:** 2026-08-12 → 2026-09-02 (~3 weeks). **Inbox messages/month ≈ 66.** Highest-volume write path is broadcast fan-out (3,142 recipient rows from 17 broadcasts), not inbound messages — relevant to the DB benchmark (burst = broadcasts).

## Billing data — none exists

`account_wallets`, `credit_transactions`, `recharge_orders`, `billing_settings`, `platform_admins` → **PGRST205 (table not in schema)**. Migrations **037–040** (platform_admin, branding, billing/credits, provisioning) are **NOT applied** to this project (026/027/029 are — notifications/api_keys/ai_configs exist empty). So:
- **No existing credit balances or payment records to migrate.** v6 §7 mapping (`account_wallets → credit_wallet`, `credit_transactions → credit_ledger`) is effectively greenfield — nothing to preserve.

## ⚠ Caveat — confirm this is production

`.env.local` may point at a dev/staging project, not the live Worker's DB. The production Worker's `SUPABASE_URL` is dashboard-managed (see `../../../` deploy-config-drift memory). **Action:** confirm the CF-dashboard production `SUPABASE_URL` equals `hwawmkhhyddzkrgjniez`. If a different project holds applied 037–040 with real wallet balances, re-run these counts there and revisit §7.

## Decision — one-time cutover

Footprint is **negligible** (3 accounts, 3 users, 349 contacts, 66 messages). Even under the caveat, a WhatsApp CRM at this stage has no volume justifying a long-running strangler.

**→ One-time migration / cutover.** Do not build strangler infrastructure. Export the small dataset, transform to the new schema/DB, import, verify, cut over. Keep the old deploy available until the new system is proven (v6 reversibility).
