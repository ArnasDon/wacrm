# DATABASE_DECISION — D1 vs Neon/Postgres

**Status: PENDING benchmark run.** Do not lock the DB, and do not write `credit_ledger` / reservation-settlement code, until this gate passes (v6). Business modules stay behind `DatabaseProvider` regardless of outcome.

## Why this gate
The critical workload is not plain CRUD. One inbound WhatsApp message → message insert + conversation update + unread update + event + notification + multi-client reads. Broadcast fan-out (already 3,142 recipient rows from 17 broadcasts in prod — see MIGRATION_MAP) is the real write burst. Credits add **two-phase reserve→settle** under webhook/worker retries — the hardest concurrency case.

## Benchmark workload (build a repeatable harness)
- Concurrent WhatsApp sends
- Concurrent credit **reservations** on one wallet
- Retries (same idempotency key) + duplicate webhook/provider events
- `settle` and `release/expire` under contention
- Concurrent wallet updates (hot-row)
- Broadcast burst (N recipients) + inbound burst
- Large tenant: 1 account, 10M+ messages — listing, history pagination, unread counts, search, index effectiveness
- Multi-tenant: hot-partition / noisy-neighbor

Measure p50/p95/p99 write latency, error rate, queue backlog, transaction latency, cost, operational complexity.

## Acceptance — correctness first (hard fail)
```
No negative balance
No double debit
No duplicate settlement
No lost reservation
```
If D1 cannot reliably guarantee these under realistic concurrency → **use Neon/Postgres.** Performance/cost are secondary to these four.

## D1-specific risks to probe
- SQLite transaction isolation vs Postgres for the reserve/settle two-phase debit.
- Per-DB size + write-concurrency ceiling at 10M+ messages / broadcast bursts.
- Session/read-consistency after write (immediate read-your-write on the inbox).

## Deliverable — record in this file
Workload assumptions · methodology · D1 results · Neon results · cost model · operational model · consistency model · scaling risks · **decision** · revisit triggers (thresholds from measurement, e.g. revisit if sustained writes > X, p95 > Y, DB size > Z, queue backlog > N).

## Contract tests (both adapters)
`ConversationRepositoryContractTests` + `WalletRepositoryContractTests` run against **both** D1 and Postgres adapters: create/get/list/paginate/update, **concurrent update, reserve/settle/release idempotency, tenant isolation, transaction behaviour.** This proves the escape hatch is real, not theoretical.
