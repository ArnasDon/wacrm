# Reporting & Analytics — TRD

Part of the Nexara WACRM rebuild (`docs/rebuild discussion/`). Companion docs: [PRD.md](./PRD.md) (product scope, report catalog, metric formulas) · [UIUX.md](./UIUX.md) (screens/interactions) · [SCHEMA.md](./SCHEMA.md) (full DDL). Built on the constraints in [ARCHITECTURE_MODEL.md](../phase-0/ARCHITECTURE_MODEL.md), [DATABASE_DECISION.md](../phase-0/DATABASE_DECISION.md) and [CREDITS_BILLING_DESIGN.md](../phase-0/CREDITS_BILLING_DESIGN.md).

**Non-negotiables inherited from the platform architecture:**
- Business/UI code depends on interfaces only; all reporting SQL lives in `modules/reporting/infrastructure` repositories behind `DatabaseProvider`. Nothing in `modules/reporting/application` or `apps/web` touches a query builder or raw binding directly.
- Every reporting SQL statement filters `account_id` (the one sanctioned, narrow exception is the platform cross-tenant aggregate job — see §8).
- The DB is D1 **or** Neon/Postgres, pending the Phase-1 benchmark. Reporting's design must work on either, and this doc calls out where the choice matters.
- Cloudflare Workers + OpenNext: request-path CPU is a scarce, ~10ms-class budget. **No aggregation ever runs in the request path.** Every report read is an indexed lookup against a pre-computed rollup table.

## 0a. Upstream schema prerequisites (verified 2026-09-11)

Reporting was checked against the current operational schema (`supabase/migrations/`). These columns **do not exist today** and reporting cannot source the listed metrics without them. Each is a **Phase-2 prerequisite** owned by the operational module, not by reporting. If a column is not added, its metric is **cut, not faked**.

| Needed column | Owning module | Unblocks | If absent |
|---|---|---|---|
| `accounts.timezone` (IANA, default `UTC`) | organizations | **all** day/hour bucketing (every report) | buckets fall back to UTC — day boundaries won't match the business calendar |
| `conversations.closed_at` (timestamp) + reopen signal (status-transition log or `reopen_count`) | conversations | avg resolution time, reopen rate (PRD §6.1) | those two metrics cut |
| `contacts.opt_out_at` (timestamp/nullable) | contacts | opt-out rate (PRD §6.6) | metric cut |
| `contacts.source` (text/enum: manual/api/broadcast_optin/webhook/import) | contacts | growth-by-source (PRD §6.6), `analytics_contact_source_daily` | source breakdown cut |
| `deals.origin_conversation_id`, `deals.origin_broadcast_id`, `deals.source` | pipelines | **Deal origin USP** + campaign→pipeline correlation (PRD §6.7) | the flagship pipeline USP cut |

Verified-present columns the design correctly relies on (no action): `messages.sender_type` (customer/agent/bot), `conversations.assigned_agent_id`+status, `broadcast_recipients.status` (incl. `replied`), `account_wallets.low_balance_threshold`, `automation_logs.status`+`trigger_event`.

## 1. Data model: raw vs. pre-aggregated

Two layers:

**Raw / operational tables** (owned by their respective modules, not reporting): `conversations`, `messages`, `contacts`, `deals`, `pipeline_stages`, `broadcasts`, `broadcast_recipients`, `message_templates`, `automations`, `automation_logs`, `credit_wallets`, `credit_ledger`, `credit_reservations`, `usage_records` (per `CREDITS_BILLING_DESIGN.md`). Reporting never writes to these and never aggregates them synchronously in a request.

**Rollup / summary tables** (owned by `modules/reporting`, full DDL in [SCHEMA.md](./SCHEMA.md)): one fact table per report family in the PRD catalog, at daily grain (all report families) and additionally hourly grain where intraday freshness matters (conversation volume, SLA). Each rollup row is keyed by `(account_id, period_start, dimension_key...)`, small, and served by a single covering index — this is what makes every dashboard read a sub-millisecond indexed lookup regardless of how many raw messages the tenant has accumulated.

This is a deliberate move away from the current pre-rebuild pattern (`src/lib/dashboard/queries.ts`), which pulls raw `messages`/`conversations`/`deals` rows into the request and aggregates them in JS under RLS. That's fine at "low thousands of messages" (as its own comments admit) and explicitly not fine at the 10M+-message, broadcast-burst scale the benchmark in `DATABASE_DECISION.md` is built to test. The rollup pattern replaces it entirely.

Rollup source→target mapping is defined fully in [SCHEMA.md — Rollup source→target mapping](./SCHEMA.md#rollup-sourcetarget-mapping).

## 2. Aggregation pipeline

Two complementary paths keep rollups fresh without ever aggregating in the request path:

### 2a. Event-driven micro-batch (near-real-time, 5–15 min freshness)

Business events already flow through the platform's `EventBus` (core provider, per `ARCHITECTURE_MODEL.md` §1/§4): `message.sent`, `message.status_updated` (delivered/read/failed), `conversation.closed`, `broadcast.recipient.updated`, `deal.stage_changed`, `automation.executed`, `credit.reserved` / `credit.settled` / `credit.released`. The reporting module subscribes and publishes each onto a dedicated Cloudflare Queue (`reporting-ingest`). A queue consumer Worker:

1. Batches events (Cloudflare Queues batch delivery, e.g., up to 100 messages / a few seconds).
2. Groups by `(account_id, rollup_table, period_bucket, dimension_key)`.
3. For each affected bucket, **recomputes the bucket from source rows** (not an incremental `+1`) and upserts — see §7 for why.

This keeps dashboards "fresh enough" without touching the request path: the queue consumer runs on its own schedule/trigger, off the user's clock.

### 2b. Scheduled cron finalization (correctness path)

Cloudflare Cron Triggers run:
- **Hourly**: finalize the previous hour's hourly-grain rollups (conversation volume, SLA) — catches anything the event-driven path missed or that arrived out of order.
- **Daily**: finalize the previous day across *all* rollup families, including ones fed only by daily cron (pipeline snapshots, contact growth, credit usage, template/broadcast/automation summaries). Also handles **late-arriving data** — a WhatsApp `read` receipt can land hours after `sent`, after the hourly bucket already closed; the daily finalize job re-scans the full day and replaces the daily row so read-rate numbers are eventually correct even if the hourly number briefly under-counted.
- **Meta cost sync**: a scheduled job calls the existing `getPricingAnalytics`/`getWabaCurrency` functions (`src/lib/whatsapp/pricing-analytics.ts`) per connected WABA and writes the category-level cost breakdown into `analytics_credit_usage_daily`. This decouples the credit/cost report from a live Graph API call per dashboard view (see [PRD open question #6](./PRD.md#14-open-questions)).

### 2c. Backfill / recompute

A manual/admin-triggered job re-derives rollups for an arbitrary date range from raw source tables — used for (a) initial backfill when a new rollup table ships, (b) disaster recovery, (c) correcting a bug in rollup logic after the fact. Because bucket recompute is the standing strategy (§7), backfill is just "run the same recompute function over a wider range" — no special-cased code path.

```
EventBus ──▶ Queue(reporting-ingest) ──▶ consumer: recompute-and-upsert affected bucket(s)
                                                         │
Cron (hourly)  ──▶ finalize previous hour ───────────────┤──▶ analytics_* rollup tables
Cron (daily)   ──▶ finalize previous day (all families) ─┤
Cron (Meta sync) ─▶ pull pricing_analytics per WABA ──────┘
Manual backfill ──▶ recompute(range) ─────────────────────┘
```

## 3. Query patterns behind DatabaseProvider

All reporting reads go through a `ReportingRepository` per cube (interface in `modules/reporting/domain`, implementation in `modules/reporting/infrastructure`), e.g.:

```ts
interface ConversationAnalyticsRepository {
  getDaily(accountId: string, range: DateRange, compare?: DateRange): Promise<ConversationDailyRow[]>
  getHourlyHeatmap(accountId: string, range: DateRange): Promise<ConversationHourlyRow[]>
}
interface CreditUsageRepository {
  getDaily(accountId: string, range: DateRange): Promise<CreditUsageDailyRow[]>
  getPlatformAggregate(range: DateRange): Promise<PlatformCreditAggregateRow[]> // platform-admin only, reads platform_analytics_daily
}
```

Rules every implementation follows:
- Every method's first real filter is `WHERE account_id = ?` (except the explicit platform-aggregate methods, which read from `platform_analytics_daily`, itself pre-aggregated with no per-tenant rows — see §8).
- Every query is a range scan on `(account_id, period_start [, dimension...])` against the rollup table's PK/index — never a join across raw operational tables at read time.
- Drill-down queries (from a rollup row down to record-level) are a **separate, narrower** repository method against the operational tables (e.g., `ConversationRepository.listByDay(accountId, day, filters, page)`), paginated and indexed on `(account_id, created_at)` — cheap because it's scoped to one bucket's worth of rows, not the whole tenant history.
- Custom report builder queries (§ PRD 7) are generated server-side from a **fixed allow-list** of dimensions/metrics per cube, never free SQL — this guarantees every custom query is still index-backed and keeps `check-architecture.mjs`'s "every SQL filters account_id" guarantee mechanically true.

## 4. D1 vs. Postgres implications for analytical queries

The pre-aggregation architecture in §1–§3 is intentionally **DB-agnostic** — it exists *because* neither D1 nor Postgres can be trusted to aggregate 10M+ raw rows inside a 10ms Workers request, regardless of which one wins the benchmark. Where the choice does matter:

| Concern | D1 (SQLite) | Neon/Postgres |
|---|---|---|
| Rollup upsert concurrency | Single active writer per database; broadcast-burst fan-in of many small upserts to the *same* daily bucket row (e.g., `analytics_broadcast_daily` during a large send) can serialize and queue up. Mitigation: the queue consumer coalesces same-bucket events into one upsert per batch rather than one write per event. | MVCC allows concurrent writers to different rows without blocking; hot-row contention on the *same* bucket row still needs `INSERT ... ON CONFLICT DO UPDATE` with row-level locking, same coalescing mitigation applies but is less critical. |
| Ad hoc query sophistication | No materialized views; window functions exist (SQLite ≥3.25) but the planner is materially less sophisticated for multi-way joins — reason to keep rollup queries to simple range scans, never rely on D1 to do clever query planning. | Native materialized views and richer window/CTE support are available as an *implementation shortcut* for building rollups (e.g., a nightly `REFRESH MATERIALIZED VIEW CONCURRENTLY`) — optional, not required; the queue+cron pipeline in §2 works identically either way and is the documented baseline. |
| Database size ceiling | D1's per-database size ceiling (current-generation limit, being raised over time but still bounded) is a stated risk in `DATABASE_DECISION.md` at 10M+ messages for one large tenant. Rollup tables themselves stay tiny (rows = accounts × days × low-cardinality dims), but **raw** `messages`/`broadcast_recipients` rows sharing the same database are the risk. | Effectively unbounded for this workload; Neon's storage scales independently of compute. |
| Read scaling | D1 Sessions API / read replicas help fan out dashboard reads; write-heavy rollup upserts during a broadcast burst remain the risk (same row above). | Read replicas / pooled connections via Hyperdrive from Workers (Workers have no persistent TCP otherwise) handle read fan-out; write path unaffected by read scaling. |
| Partitioning | No native table partitioning — composite PK + index on `(account_id, day)` is the only lever; archival (below) is the real mitigation. | Native `PARTITION BY RANGE` on month/day is available for the shared multi-tenant rollup tables if a single table's row count (across *all* tenants) grows large — see [SCHEMA.md retention notes](./SCHEMA.md#retention--partitioning-notes). |

**Fallback if D1 is chosen**: the archival policy becomes mandatory, not optional — raw `messages`/`broadcast_recipients` rows older than the retention window (default: 13 months) are exported to R2 as newline-delimited JSON and deleted from D1 once their contribution is baked into daily/monthly rollups (which are retained indefinitely — they're tiny). Drill-down into archived periods degrades gracefully to rollup-only detail (no per-message drill-through) rather than failing — flagged as a UX constraint in [UIUX.md](./UIUX.md#8-empty-loading-and-error-states). Cloudflare Workers Analytics Engine is noted as a possible future complement for very-high-cardinality raw event exploration but is **not** required for V1 — the rollup tables cover every report in the PRD catalog without it.

**If Postgres is chosen**: the same architecture applies unchanged; Postgres just gives more headroom (bigger raw-table retention window before archival is forced, optional materialized-view shortcut for rollup implementation) rather than a different design.

## 5. Caching

- **Rollup reads** are cached at the edge keyed by `(account_id, report_key, params_hash, rollup_version)` — Cache API or KV, TTL 60–300s depending on report (near-real-time reports like the Conversation Overview use the shorter end; daily-only reports like Pipeline use the longer end).
- **Cache invalidation**: the cron finalize jobs (§2b) publish a `rollup.finalized` event per `(account_id, rollup_table, period)` after a successful write; a lightweight cache-bust consumer clears the matching cache keys. Event-driven micro-batch upserts (§2a) do **not** bust cache on every write (that would defeat the point) — the TTL alone bounds staleness for those.
- **Export queries** (§ next) are not cached — they run once per export request against the same indexed rollup tables, which is cheap enough not to need it.

## 6. Realtime vs. near-real-time

Two tiers, matching the platform's stated V1 realtime posture (`ARCHITECTURE_MODEL.md` §6 — polling + incremental sync behind `RealtimeProvider`, no WebSocket/DO unless proven necessary):

- **Live** (no rollup involved): a handful of "right now" numbers — open conversation count, unread count, current wallet balance — are cheap indexed counts/reads against operational tables directly (exactly how today's `loadMetrics` works, minus the client-side aggregation parts). These do not need a rollup because they're already O(1) indexed lookups.
- **Near-real-time** (rollup-backed): everything else in the report catalog is 5–15 minutes fresh via the event-driven pipeline (§2a), finalized-correct within the hour/day via cron (§2b). This is an explicit, documented trade-off: a campaign's read-rate on the dashboard may lag a live Meta read-receipt by a few minutes. Alerts (PRD §9) are evaluated on the same cadence — not instant push.

## 7. Idempotency for rollups

At-least-once delivery (Cloudflare Queues) and duplicate/retried webhook events (the same correctness concern `CREDITS_BILLING_DESIGN.md` calls out for the ledger) both mean a rollup upsert can be triggered more than once for the same underlying change. The strategy:

- **Recompute-and-replace, not increment.** Every rollup upsert recomputes the full bucket `(account_id, period_start, dimension_key)` from the authoritative source rows for that bucket and does a full-row `UPSERT` (`INSERT ... ON CONFLICT (account_id, period_start, dimension_key) DO UPDATE SET ...` on Postgres; `INSERT OR REPLACE` / `ON CONFLICT` on D1/SQLite). A duplicate event triggers the same recompute and writes the same numbers — naturally idempotent, no dedup-by-event-id bookkeeping required for the common case.
- **`rollup_job_runs`** (see [SCHEMA.md](./SCHEMA.md#rollup_job_runs)) records one row per `(job_name, account_id, period_grain, period_start)` with a unique constraint, so a cron finalize job that fires twice (retry, overlapping schedule) is a no-op on the second run rather than a duplicate recompute — protects against wasted work, not correctness (correctness is already guaranteed by recompute-and-replace).
- **Late-arriving data** is handled by the daily finalize pass re-scanning and replacing the whole day (§2b), so an hourly bucket that was correct-at-the-time but later needs a delivered/read status update converges to correct by end of day.

## 8. Tenant isolation enforcement

- Every `ReportingRepository` method takes `accountId` from a server-verified `TenantContext` (resolved once at the edge from the session/JWT per `AUTH_EXTENSION.md`) — never from client-supplied input — and every generated SQL statement includes it as the leading predicate. `check-architecture.mjs` is extended with a reporting-specific check that flags any file under `modules/reporting/infrastructure` containing a query without an `account_id` (or the explicit platform-aggregate exception below) bound parameter.
- Queue messages carry `account_id`; the consumer processes each message inside a per-message tenant context, so a batch mixing multiple tenants' events never cross-contaminates a bucket.
- Exports are written to R2 under `exports/{account_id}/{export_id}.{csv|pdf}` and signed URLs are scoped to that object only.
- **The one sanctioned exception**: `platform_analytics_daily` (platform-admin cross-tenant aggregate, [SCHEMA.md](./SCHEMA.md#platform_analytics_daily)) is populated by a scheduled job that reads *already tenant-scoped* rollup rows (one `account_id`-filtered query per tenant, or a single query grouped by `account_id` then re-aggregated across the result set) and writes rows with **no `account_id` column at all** — platform-wide totals only (active accounts, total messages, total credits settled, total Meta cost, avg margin %). It never stores or exposes a specific tenant's numbers to another tenant, and platform-admin UI never joins back from this table to per-tenant detail without a separate, explicitly-permissioned per-account query. This needs architect sign-off as the documented exception to "every query filters account_id" (flagged in [PRD open question #3](./PRD.md#14-open-questions)).

## 9. Export pipeline

1. User (or a schedule trigger) requests an export → API creates a `report_exports` row (`status='queued'`) and enqueues a Queue message with `{account_id, export_id, report_key or saved_report_id, params, format}`.
2. A queue consumer Worker runs the report's normal (already rollup-backed, cheap) query, renders:
   - **CSV**: straightforward row serialization.
   - **PDF**: a pure-JS, Workers-runtime-compatible renderer (no native binaries/headless-Chrome dependency, which Workers can't run) — render a simple templated layout (title, filter summary, table/chart-as-static-SVG) server-side.
3. Uploads the file to R2 at `exports/{account_id}/{export_id}.{csv|pdf}`.
4. Generates a short-TTL signed URL (15–60 min), updates `report_exports.status='ready'` with the URL and its expiry.
5. Notifies the requester via `NotificationProvider` (in-app) and email (if scheduled or opted in).
6. Files are purged from R2 after the retention window ([SCHEMA.md retention notes](./SCHEMA.md#retention--partitioning-notes)); a cron sweep deletes expired `report_exports` rows' R2 objects.

Scheduled reports (`report_schedules`) are just a cron-driven producer of the same export request, fed to the same pipeline — no separate code path.

## 10. API surface (`/api/app/reports/*`)

All endpoints require an authenticated session resolving a `TenantContext`; all return data scoped to that `account_id` except the `/api/platform/reports/*` group (platform-admin only, separate permission check).

```
GET  /api/app/reports/overview                         # pinned metric cards + summary charts
GET  /api/app/reports/conversations?range&compare&groupBy
GET  /api/app/reports/agents?range&compare&agentId
GET  /api/app/reports/broadcasts?range                 # campaign comparison list
GET  /api/app/reports/broadcasts/:broadcastId           # single campaign detail
GET  /api/app/reports/templates?range&category&language
GET  /api/app/reports/funnels?range&source&category
GET  /api/app/reports/contacts/growth?range&segment
GET  /api/app/reports/pipeline?range&pipelineId
GET  /api/app/reports/credits?range                     # flagship cost/credit report
GET  /api/app/reports/automations?range&automationId

GET  /api/app/reports/drilldown/:cube?bucketKey&page     # record-level drill-down for a rollup bucket

POST   /api/app/reports/custom                          # define + run a custom report (dry-run)
GET    /api/app/reports/saved
POST   /api/app/reports/saved
PATCH  /api/app/reports/saved/:id
DELETE /api/app/reports/saved/:id

GET    /api/app/reports/schedules
POST   /api/app/reports/schedules
PATCH  /api/app/reports/schedules/:id
DELETE /api/app/reports/schedules/:id

POST   /api/app/reports/exports                         # trigger on-demand export
GET    /api/app/reports/exports/:id                      # poll status / get signed URL

GET    /api/app/reports/alerts
POST   /api/app/reports/alerts
PATCH  /api/app/reports/alerts/:id
DELETE /api/app/reports/alerts/:id
GET    /api/app/reports/alerts/events                    # alert history/log

GET  /api/platform/reports/overview                      # platform-admin cross-tenant aggregate
GET  /api/platform/reports/accounts-at-risk               # low balance / high failure-rate accounts (aggregate flags only)
```

## 11. Performance budgets

- Dashboard/report read endpoints: **P95 server time < 150ms**, achievable because every read is an indexed rollup lookup (§3) plus edge cache hit for repeat views (§5).
- Drill-down endpoints: **P95 < 250ms** (single-bucket-scoped, paginated, indexed operational-table query).
- Export enqueue: **< 50ms** (just an insert + queue publish).
- Export completion: **target P95 < 60s** for accounts up to the benchmark's stated scale; PDF rendering is the likely long pole, budgeted separately from the query itself.
- Rollup queue consumer: batch processing budget such that the `reporting-ingest` queue never sustains a backlog > 15 minutes under the benchmark's broadcast-burst workload (3,142 recipients / 17 broadcasts today, per `MIGRATION_MAP.md`, scaled up for the benchmark) — if it does, that's a signal to widen batch size or add consumer concurrency, not to move aggregation into the request path.
- Alert evaluation job: bounded per-tenant amortized cost so the job scales linearly with active accounts, not with message volume (it only ever reads rollup rows).

## 12. Testing

Mirrors the pattern already mandated for the wallet/conversation repositories in `NEW_REPO_PLAN.md`/`IMPLEMENTATION_PLAN.md` Phase 1:

- **`ReportingRepositoryContractTests`** run against both the D1 and Postgres adapters (once both exist per Phase 1), covering:
  - Rollup upsert idempotency (same event/bucket recompute twice → identical row).
  - Concurrent rollup writers targeting the same bucket (simulated broadcast-burst) → no lost update, final row is correct, not a race-dependent partial.
  - Tenant isolation: a query scoped to account A never returns account B's rows, including through the drill-down path.
  - Late-arriving event correction: a `read` status event delivered after the hourly bucket closed is reflected once the daily finalize pass runs.
  - Backfill/recompute equivalence: recomputing a stable historical range produces byte-identical rollup rows to the original event-driven computation.
- **Export pipeline tests**: enqueue → file produced → R2 object exists → signed URL valid and scoped → row transitions to `ready` → expired export's URL is rejected/regenerated correctly.
- **Alert rule tests**: threshold crossing produces exactly one `alert_events` row per crossing (not one per evaluation tick while still over threshold) and respects `is_active`/channel config.
- **RBAC tests**: each persona in [PRD §11](./PRD.md#11-rbac-on-reports) gets exactly the access matrix defined there — explicit denial tests for Operator hitting account-wide cost data, for a non-platform-admin hitting `/api/platform/reports/*`, etc.
- **Custom report builder tests**: every allow-listed dimension/metric combination per cube produces a valid, index-backed query (no combination should ever degrade to a full scan) — a lint-style test over the allow-list definitions themselves, run in CI.
