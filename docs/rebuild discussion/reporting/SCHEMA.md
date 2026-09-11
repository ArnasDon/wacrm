# Reporting & Analytics — Schema

Part of the Nexara WACRM rebuild (`docs/rebuild discussion/`). Companion docs: [PRD.md](./PRD.md) (report catalog, metric formulas) · [TRD.md](./TRD.md) (pipeline, query patterns, idempotency) · [UIUX.md](./UIUX.md) (screens). DDL below is written in Postgres syntax (the richer of the two candidate dialects) with an explicit portability section — see [§0](#0-portability-d1sqlite-vs-postgres) — since the DB choice is pending the Phase-1 benchmark ([DATABASE_DECISION.md](../phase-0/DATABASE_DECISION.md)). Every table carries `account_id` and is indexed on `(account_id, <time column>)` at minimum, per the architecture's one hard rule.

> **Depends on Phase-2 operational-schema additions** (verified missing 2026-09-11): `accounts.timezone`, `conversations.closed_at` + reopen signal, `contacts.opt_out_at`, `contacts.source`, `deals.origin_conversation_id`/`origin_broadcast_id`/`source`. See [TRD Upstream schema prerequisites](./TRD.md#0a-upstream-schema-prerequisites). Rollup columns fed by these (`analytics_contact_source_daily`, `analytics_contact_growth_daily.opted_out`, `analytics_conversation_daily.resolution_avg_secs`/`reopened_conversations`, deal-origin joins) are inert until the source columns land.

## 0. Portability: D1/SQLite vs. Postgres

| Concept | Postgres (used below) | D1 / SQLite equivalent |
|---|---|---|
| Primary key / id | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | `TEXT PRIMARY KEY` — generate the UUID app-side (`crypto.randomUUID()` in the Worker) since SQLite has no native UUID type/generator |
| Timestamps | `TIMESTAMPTZ` | Store as `INTEGER` unix-epoch **milliseconds** (not `TEXT` ISO strings) — integer range comparisons are what make `(account_id, period_start)` index scans fast on SQLite; convert at the repository boundary |
| Date-only (`day` bucket) | `DATE` | `TEXT` in `YYYY-MM-DD` form (SQLite's canonical sortable date form) — still range-scannable |
| JSON columns | `JSONB` | `TEXT` holding a JSON string (SQLite's `json()` functions can still query into it, but treat it as opaque payload for reporting rollups — no rollup table below relies on querying inside a JSON column, only the report-builder/schedule/alert tables use JSON, and only for config payloads, not for filtering) |
| Money / credits | `NUMERIC(12,2)` | Store as `INTEGER` **minor units** (e.g., paise/cents) on both engines in practice to avoid float drift; `NUMERIC` shown below for readability, treat as "exact decimal, app-level minor-unit convention" regardless of engine |
| Booleans | `BOOLEAN` | `INTEGER` (0/1) |
| Upsert | `INSERT ... ON CONFLICT (...) DO UPDATE SET ...` | Same syntax works on D1/SQLite (`ON CONFLICT` is supported) — this is why the idempotent recompute-and-replace strategy in [TRD.md §7](./TRD.md#7-idempotency-for-rollups) is written the same way on either engine |
| Partitioning | Native `PARTITION BY RANGE` (see [§ retention](#retention--partitioning-notes)) | Not available — composite PK/index is the only lever; archival is the real mitigation |
| Generated columns | `GENERATED ALWAYS AS (...) STORED` (used for a couple of convenience rate columns below) | SQLite also supports `GENERATED ALWAYS AS (...) STORED` (3.31+) — same syntax works, keep expressions to simple arithmetic (division-by-zero guards) for compatibility |

All DDL below assumes the Postgres column types; a D1 migration file applies the left-column→right-column substitutions mechanically. Table/column names, PKs, and indexes are identical across both.

## 1. Rollup / summary tables

### `analytics_conversation_daily`

Feeds [PRD §6.1](./PRD.md#61-conversation--inbox-analytics).

```sql
CREATE TABLE analytics_conversation_daily (
  account_id              UUID NOT NULL,
  day                     DATE NOT NULL,
  new_conversations       INTEGER NOT NULL DEFAULT 0,
  closed_conversations    INTEGER NOT NULL DEFAULT 0,
  reopened_conversations  INTEGER NOT NULL DEFAULT 0,
  messages_in             INTEGER NOT NULL DEFAULT 0,
  messages_out            INTEGER NOT NULL DEFAULT 0,
  active_conversations    INTEGER NOT NULL DEFAULT 0,  -- distinct conversations with any activity that day
  first_response_median_secs INTEGER,
  first_response_p90_secs    INTEGER,
  resolution_avg_secs         INTEGER,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, day)
);
CREATE INDEX idx_analytics_conv_daily_account_day ON analytics_conversation_daily (account_id, day DESC);
```

### `analytics_conversation_hourly`

Intraday freshness for the volume heatmap + near-real-time SLA tracking. See [TRD.md §4](./TRD.md#4-d1-vs-postgres-implications-for-analytical-queries) for the D1 write-contention note on this table specifically.

```sql
CREATE TABLE analytics_conversation_hourly (
  account_id       UUID NOT NULL,
  hour_start       TIMESTAMPTZ NOT NULL,  -- truncated to the hour in **UTC**. Convert to accounts.timezone at query / daily-rollup time. (Do NOT store local-time buckets: a tenant changing timezone would misalign history and it breaks the platform cross-tenant roll.)
  messages_in      INTEGER NOT NULL DEFAULT 0,
  messages_out     INTEGER NOT NULL DEFAULT 0,
  new_conversations INTEGER NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, hour_start)
);
CREATE INDEX idx_analytics_conv_hourly_account_hour ON analytics_conversation_hourly (account_id, hour_start DESC);
-- Retention: 90 days of hourly detail, then purged — see retention notes. Daily rollup already covers the long-term trend.
```

### `analytics_agent_performance_daily`

Feeds [PRD §6.2](./PRD.md#62-agent-performance--response-time-sla).

```sql
CREATE TABLE analytics_agent_performance_daily (
  account_id                UUID NOT NULL,
  day                       DATE NOT NULL,
  agent_id                  UUID NOT NULL,   -- references users(id); no FK across module boundary tables at the DB level, enforced app-side
  conversations_handled     INTEGER NOT NULL DEFAULT 0,
  conversations_closed      INTEGER NOT NULL DEFAULT 0,
  messages_sent             INTEGER NOT NULL DEFAULT 0,
  responses_count           INTEGER NOT NULL DEFAULT 0,
  sla_target_secs           INTEGER NOT NULL DEFAULT 300,  -- snapshot of the account's SLA target at rollup time
  sla_breaches              INTEGER NOT NULL DEFAULT 0,
  sla_breach_rate           NUMERIC(5,4) GENERATED ALWAYS AS (
                               CASE WHEN responses_count = 0 THEN 0
                                    ELSE ROUND(sla_breaches::numeric / responses_count, 4) END
                             ) STORED,
  first_response_avg_secs    INTEGER,
  first_response_median_secs INTEGER,
  first_response_p90_secs    INTEGER,
  resolution_avg_secs         INTEGER,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, day, agent_id)
);
CREATE INDEX idx_analytics_agent_perf_account_agent_day ON analytics_agent_performance_daily (account_id, agent_id, day DESC);
```

### `analytics_broadcast_summary`

One finalized row per broadcast (not time-bucketed — a broadcast is a bounded campaign, not a stream). Feeds [PRD §6.3](./PRD.md#63-broadcast--campaign-analytics) and campaign comparison.

```sql
CREATE TABLE analytics_broadcast_summary (
  broadcast_id       UUID PRIMARY KEY,   -- 1:1 with broadcasts(id)
  account_id          UUID NOT NULL,
  template_id          UUID,              -- references message_templates(id), nullable if template was later deleted
  recipients           INTEGER NOT NULL DEFAULT 0,
  sent                 INTEGER NOT NULL DEFAULT 0,
  delivered             INTEGER NOT NULL DEFAULT 0,
  read                 INTEGER NOT NULL DEFAULT 0,
  replied               INTEGER NOT NULL DEFAULT 0,
  failed                INTEGER NOT NULL DEFAULT 0,
  credits_debited        NUMERIC(12,2) NOT NULL DEFAULT 0,
  meta_cost_estimate      NUMERIC(12,2),   -- filled once the Meta cost sync job (TRD §2b) has category cost data for the send window
  delivery_rate          NUMERIC(5,4) GENERATED ALWAYS AS (
                             CASE WHEN sent = 0 THEN 0 ELSE ROUND(delivered::numeric / sent, 4) END) STORED,
  read_rate              NUMERIC(5,4) GENERATED ALWAYS AS (
                             CASE WHEN delivered = 0 THEN 0 ELSE ROUND(read::numeric / delivered, 4) END) STORED,
  reply_rate              NUMERIC(5,4) GENERATED ALWAYS AS (
                             CASE WHEN delivered = 0 THEN 0 ELSE ROUND(replied::numeric / delivered, 4) END) STORED,
  cost_per_reply          NUMERIC(12,2) GENERATED ALWAYS AS (
                             CASE WHEN replied = 0 THEN NULL ELSE ROUND(credits_debited / replied, 2) END) STORED,
  started_at             TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  duration_secs           INTEGER,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_analytics_broadcast_summary_account ON analytics_broadcast_summary (account_id, completed_at DESC);
```

### `analytics_campaign_daily`

Account-wide daily roll of broadcast activity (for the "campaigns over time" trend, separate from per-broadcast summary above).

```sql
CREATE TABLE analytics_campaign_daily (
  account_id            UUID NOT NULL,
  day                   DATE NOT NULL,
  broadcasts_sent        INTEGER NOT NULL DEFAULT 0,
  total_recipients        INTEGER NOT NULL DEFAULT 0,
  total_delivered         INTEGER NOT NULL DEFAULT 0,
  total_read              INTEGER NOT NULL DEFAULT 0,
  total_replied            INTEGER NOT NULL DEFAULT 0,
  total_failed             INTEGER NOT NULL DEFAULT 0,
  total_credits_debited     NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, day)
);
CREATE INDEX idx_analytics_campaign_daily_account_day ON analytics_campaign_daily (account_id, day DESC);
```

### `analytics_template_daily`

Feeds [PRD §6.4](./PRD.md#64-template-performance).

```sql
CREATE TABLE analytics_template_daily (
  account_id     UUID NOT NULL,
  day            DATE NOT NULL,
  template_id     UUID NOT NULL,   -- references message_templates(id)
  category        TEXT NOT NULL,   -- 'Marketing' | 'Utility' | 'Authentication' — snapshot, templates can't change category post-approval
  sent            INTEGER NOT NULL DEFAULT 0,
  delivered        INTEGER NOT NULL DEFAULT 0,
  read            INTEGER NOT NULL DEFAULT 0,
  replied          INTEGER NOT NULL DEFAULT 0,
  failed           INTEGER NOT NULL DEFAULT 0,
  credits_debited   NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, day, template_id)
);
CREATE INDEX idx_analytics_template_daily_account_template ON analytics_template_daily (account_id, template_id, day DESC);
```

### `analytics_delivery_funnel_daily`

Feeds [PRD §6.5](./PRD.md#65-delivery--read-funnels).

```sql
CREATE TABLE analytics_delivery_funnel_daily (
  account_id   UUID NOT NULL,
  day          DATE NOT NULL,
  source        TEXT NOT NULL,   -- 'broadcast' | 'automation' | 'manual' | 'service'
  category      TEXT NOT NULL,   -- 'Marketing' | 'Utility' | 'Authentication' | 'Service'
  sent          INTEGER NOT NULL DEFAULT 0,
  delivered      INTEGER NOT NULL DEFAULT 0,
  read          INTEGER NOT NULL DEFAULT 0,
  replied        INTEGER NOT NULL DEFAULT 0,
  failed         INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, day, source, category)
);
CREATE INDEX idx_analytics_funnel_daily_account_day ON analytics_delivery_funnel_daily (account_id, day DESC);
```

### `analytics_contact_growth_daily` + `analytics_contact_source_daily`

Feeds [PRD §6.6](./PRD.md#66-contact-growth--segmentation). Source breakdown normalized into its own table rather than a JSON column, so it stays filterable/indexable.

```sql
CREATE TABLE analytics_contact_growth_daily (
  account_id         UUID NOT NULL,
  day                DATE NOT NULL,
  new_contacts        INTEGER NOT NULL DEFAULT 0,
  total_contacts       INTEGER NOT NULL DEFAULT 0,  -- cumulative snapshot as of end of day
  opted_out            INTEGER NOT NULL DEFAULT 0,
  active_30d           INTEGER NOT NULL DEFAULT 0,   -- messaged in trailing 30 days, snapshotted
  active_60d           INTEGER NOT NULL DEFAULT 0,
  active_90d           INTEGER NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, day)
);
CREATE INDEX idx_analytics_contact_growth_account_day ON analytics_contact_growth_daily (account_id, day DESC);

CREATE TABLE analytics_contact_source_daily (
  account_id   UUID NOT NULL,
  day          DATE NOT NULL,
  source        TEXT NOT NULL,  -- 'manual' | 'api' | 'broadcast_optin' | 'webhook' | 'import'
  new_contacts  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, day, source)
);
CREATE INDEX idx_analytics_contact_source_account_day ON analytics_contact_source_daily (account_id, day DESC);
```

### `analytics_pipeline_snapshot_daily` + `analytics_deal_outcome_daily`

Feeds [PRD §6.7](./PRD.md#67-pipeline--deal-analytics). Deals are a live/mutable table (`deals`), so trend reporting needs an explicit daily snapshot rather than relying on `updated_at` alone.

```sql
CREATE TABLE analytics_pipeline_snapshot_daily (
  account_id    UUID NOT NULL,
  day           DATE NOT NULL,
  pipeline_id    UUID NOT NULL,
  stage_id       UUID NOT NULL,
  deal_count     INTEGER NOT NULL DEFAULT 0,
  total_value     NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'USD',
  avg_age_days    NUMERIC(6,1),   -- avg days since deal creation, for deals currently in this stage
  PRIMARY KEY (account_id, day, pipeline_id, stage_id)
);
CREATE INDEX idx_analytics_pipeline_snapshot_account_day ON analytics_pipeline_snapshot_daily (account_id, day DESC);

CREATE TABLE analytics_deal_outcome_daily (
  account_id     UUID NOT NULL,
  day            DATE NOT NULL,
  pipeline_id     UUID NOT NULL,
  deals_won        INTEGER NOT NULL DEFAULT 0,
  deals_lost        INTEGER NOT NULL DEFAULT 0,
  won_value         NUMERIC(14,2) NOT NULL DEFAULT 0,
  lost_value         NUMERIC(14,2) NOT NULL DEFAULT 0,
  avg_cycle_secs     INTEGER,   -- avg (closed_at - created_at) for deals closed (won or lost) this day
  PRIMARY KEY (account_id, day, pipeline_id)
);
CREATE INDEX idx_analytics_deal_outcome_account_day ON analytics_deal_outcome_daily (account_id, day DESC);
```

### `analytics_credit_usage_daily` — flagship USP table

Feeds [PRD §6.8](./PRD.md#68-credit--meta-cost--spend-analytics--flagship-usp-report). Source is `credit_ledger`/`credit_reservations`/`usage_records` per `CREDITS_BILLING_DESIGN.md` (once Phase 6 ships) plus the Meta `pricing_analytics` sync ([TRD.md §2b](./TRD.md#2b-scheduled-cron-finalization-correctness-path)).

```sql
CREATE TABLE analytics_credit_usage_daily (
  account_id             UUID NOT NULL,
  day                    DATE NOT NULL,
  credits_purchased        NUMERIC(12,2) NOT NULL DEFAULT 0,  -- ledger reason IN ('purchase','monthly_grant','promotional_credit')
  credits_reserved          NUMERIC(12,2) NOT NULL DEFAULT 0,  -- sum of reservations created this day
  credits_settled            NUMERIC(12,2) NOT NULL DEFAULT 0,  -- ledger reason = 'whatsapp_usage', settled reservations
  credits_released            NUMERIC(12,2) NOT NULL DEFAULT 0,  -- released/expired reservations
  credits_refunded             NUMERIC(12,2) NOT NULL DEFAULT 0,
  ending_balance                NUMERIC(12,2) NOT NULL DEFAULT 0,  -- snapshot of credit_wallets.balance at end of day
  message_count_billed          INTEGER NOT NULL DEFAULT 0,
  meta_cost_marketing            NUMERIC(12,2),   -- from pricing_analytics, PRICING_CATEGORY = MARKETING
  meta_cost_utility               NUMERIC(12,2),
  meta_cost_authentication         NUMERIC(12,2),
  meta_cost_service_free            NUMERIC(12,2) NOT NULL DEFAULT 0,  -- always 0 cost, tracked for volume context
  meta_currency                     TEXT,   -- WABA's billing currency, from getWabaCurrency()
  is_provisional                     BOOLEAN NOT NULL DEFAULT FALSE,  -- true pre-Phase-6, based on reservations/estimates not final settlement
  updated_at                         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, day)
);
CREATE INDEX idx_analytics_credit_usage_account_day ON analytics_credit_usage_daily (account_id, day DESC);
```

### `analytics_automation_execution_daily`

Feeds [PRD §6.9](./PRD.md#69-automation--flow-analytics).

```sql
CREATE TABLE analytics_automation_execution_daily (
  account_id            UUID NOT NULL,
  day                   DATE NOT NULL,
  automation_id           UUID NOT NULL,
  trigger_event            TEXT NOT NULL,
  executions_success        INTEGER NOT NULL DEFAULT 0,
  executions_partial         INTEGER NOT NULL DEFAULT 0,
  executions_failed           INTEGER NOT NULL DEFAULT 0,
  contacts_reached             INTEGER NOT NULL DEFAULT 0,
  replied_within_24h            INTEGER NOT NULL DEFAULT 0,   -- downstream-conversion metric, PRD §6.9
  deal_stage_advanced            INTEGER NOT NULL DEFAULT 0,
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, day, automation_id, trigger_event)
);
CREATE INDEX idx_analytics_automation_exec_account_automation ON analytics_automation_execution_daily (account_id, automation_id, day DESC);
```

### `platform_analytics_daily`

The one sanctioned cross-tenant exception — see [TRD.md §8](./TRD.md#8-tenant-isolation-enforcement). **Deliberately has no `account_id` column.** Populated by aggregating already-tenant-scoped rollup rows; never joins back to per-tenant detail.

```sql
CREATE TABLE platform_analytics_daily (
  day                  DATE PRIMARY KEY,
  active_accounts        INTEGER NOT NULL DEFAULT 0,   -- accounts with any activity that day
  total_messages          BIGINT NOT NULL DEFAULT 0,
  total_credits_settled     NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_meta_cost            NUMERIC(14,2) NOT NULL DEFAULT 0,
  avg_margin_pct              NUMERIC(5,2),   -- (credits_settled - meta_cost) / credits_settled, averaged across active accounts
  accounts_at_risk_count        INTEGER NOT NULL DEFAULT 0,   -- low-balance or high-failure-rate flag count, no identities stored here
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Per-account risk identities (needed for the platform-admin "accounts at risk" list, [TRD.md §10](./TRD.md#10-api-surface-apiappreports)) live in a separate, explicitly platform-admin-permissioned table, not folded into this one:

```sql
CREATE TABLE platform_account_risk_flags (
  account_id       UUID PRIMARY KEY,
  low_balance       BOOLEAN NOT NULL DEFAULT FALSE,
  high_failure_rate  BOOLEAN NOT NULL DEFAULT FALSE,
  flagged_at         TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Read only via /api/platform/reports/accounts-at-risk, gated to platform_admin role. Intentionally minimal —
-- a flag + timestamp, not a dump of the account's actual numbers; the admin drills into a specific
-- account's normal (account_id-scoped) reports only after choosing to investigate that account.
```

## 2. Report-builder / scheduling / alerting tables

### `saved_reports`

```sql
CREATE TABLE saved_reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL,
  created_by       UUID NOT NULL,   -- references users(id)
  name             TEXT NOT NULL,
  description       TEXT,
  base_cube          TEXT NOT NULL,   -- one of the 9 cube keys, e.g. 'conversation', 'credit_usage'
  dimensions          JSONB NOT NULL DEFAULT '[]',  -- allow-listed dimension keys for base_cube
  metrics              JSONB NOT NULL DEFAULT '[]',  -- allow-listed metric keys for base_cube
  filters               JSONB NOT NULL DEFAULT '{}',  -- serialized filter chips (date range excluded — applied at view time)
  chart_type             TEXT NOT NULL DEFAULT 'table',  -- 'table' | 'bar' | 'line' | 'pie'
  visibility              TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'account')),
  pinned_to_dashboard       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_saved_reports_account ON saved_reports (account_id, updated_at DESC);
CREATE INDEX idx_saved_reports_account_pinned ON saved_reports (account_id) WHERE pinned_to_dashboard = TRUE;
```

### `report_schedules`

```sql
CREATE TABLE report_schedules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL,
  created_by         UUID NOT NULL,
  report_key          TEXT,           -- built-in report key, e.g. 'credits' — mutually exclusive with saved_report_id
  saved_report_id      UUID REFERENCES saved_reports(id) ON DELETE CASCADE,
  cadence               TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly')),
  send_time              TEXT NOT NULL,   -- 'HH:MM', interpreted in `timezone`
  timezone                TEXT NOT NULL DEFAULT 'UTC',
  day_of_week              INTEGER,   -- 0-6, required if cadence = 'weekly'
  day_of_month              INTEGER,   -- 1-28, required if cadence = 'monthly' (capped at 28 to avoid month-length edge cases)
  recipients                 JSONB NOT NULL DEFAULT '[]',  -- [{type:'user', id} | {type:'email', address}]
  format                       TEXT NOT NULL DEFAULT 'csv' CHECK (format IN ('csv', 'pdf')),
  is_active                     BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at                    TIMESTAMPTZ,
  next_run_at                     TIMESTAMPTZ,
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (report_key IS NOT NULL OR saved_report_id IS NOT NULL)
);
CREATE INDEX idx_report_schedules_account ON report_schedules (account_id);
CREATE INDEX idx_report_schedules_due ON report_schedules (next_run_at) WHERE is_active = TRUE;
```

### `report_exports`

```sql
CREATE TABLE report_exports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL,
  requested_by        UUID,   -- nullable: NULL when triggered by a schedule rather than a direct user click
  schedule_id           UUID REFERENCES report_schedules(id) ON DELETE SET NULL,
  report_key             TEXT,
  saved_report_id          UUID REFERENCES saved_reports(id) ON DELETE SET NULL,
  params                     JSONB NOT NULL DEFAULT '{}',  -- resolved date range + filters used for this specific export
  format                      TEXT NOT NULL CHECK (format IN ('csv', 'pdf')),
  status                       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'ready', 'failed', 'expired')),
  r2_key                        TEXT,
  download_url_expires_at          TIMESTAMPTZ,
  error_message                     TEXT,
  created_at                         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at                        TIMESTAMPTZ
);
CREATE INDEX idx_report_exports_account ON report_exports (account_id, created_at DESC);
CREATE INDEX idx_report_exports_cleanup ON report_exports (download_url_expires_at) WHERE status = 'ready';
```

### `alert_rules` + `alert_events`

```sql
CREATE TABLE alert_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL,
  created_by            UUID NOT NULL,
  name                    TEXT NOT NULL,
  metric_key                TEXT NOT NULL,   -- e.g. 'sla_breach_rate', 'credit_balance', 'broadcast_failure_rate'
  comparator                  TEXT NOT NULL CHECK (comparator IN ('lt', 'lte', 'gt', 'gte', 'eq')),
  threshold                     NUMERIC(14,4) NOT NULL,
  evaluation_window               TEXT NOT NULL DEFAULT 'hourly' CHECK (evaluation_window IN ('hourly', 'daily')),
  channels                          JSONB NOT NULL DEFAULT '["in_app"]',  -- subset of ['in_app','email']
  is_active                           BOOLEAN NOT NULL DEFAULT TRUE,
  last_triggered_at                     TIMESTAMPTZ,
  created_at                              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_alert_rules_account ON alert_rules (account_id) WHERE is_active = TRUE;

CREATE TABLE alert_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL,
  alert_rule_id        UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  triggered_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metric_value               NUMERIC(14,4) NOT NULL,
  threshold                    NUMERIC(14,4) NOT NULL,
  message                        TEXT,
  acknowledged_at                  TIMESTAMPTZ,
  acknowledged_by                    UUID,
  created_at                           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_alert_events_account_rule ON alert_events (account_id, alert_rule_id, triggered_at DESC);
-- Idempotency note (TRD §7 applies to alerts too): a unique partial index prevents duplicate
-- "still over threshold" events firing on every evaluation tick while the condition remains true —
-- the evaluator only inserts a new event on a *transition* into breach, not on every tick it stays breached.
```

### `rollup_job_runs`

Bookkeeping for cron finalize jobs — see [TRD.md §7](./TRD.md#7-idempotency-for-rollups).

```sql
CREATE TABLE rollup_job_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name         TEXT NOT NULL,          -- e.g. 'finalize_conversation_hourly', 'finalize_credit_usage_daily', 'meta_cost_sync'
  account_id         UUID,                   -- NULL for platform-wide jobs (e.g. meta_cost_sync iterates all WABAs itself)
  period_grain          TEXT NOT NULL CHECK (period_grain IN ('hour', 'day', 'month')),
  period_start             TIMESTAMPTZ NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  attempt                       INTEGER NOT NULL DEFAULT 1,
  started_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at                         TIMESTAMPTZ,
  error_message                          TEXT,
  UNIQUE (job_name, account_id, period_grain, period_start)
);
CREATE INDEX idx_rollup_job_runs_lookup ON rollup_job_runs (job_name, period_start DESC);
```

## 3. Rollup source→target mapping

| Target rollup table | Source table(s) | Trigger |
|---|---|---|
| `analytics_conversation_daily` / `_hourly` | `conversations`, `messages` | `message.sent`, `message.status_updated`, `conversation.closed` events (§2a) + hourly/daily cron finalize (§2b) |
| `analytics_agent_performance_daily` | `messages` (sender_type/sender_id), `conversations` (assigned_agent_id, closed timestamps) | same as above, grouped by agent |
| `analytics_broadcast_summary` | `broadcasts`, `broadcast_recipients`, `credit_ledger` (reference_type='broadcast') | `broadcast.recipient.updated` events, finalized on broadcast completion + daily cron catch-up |
| `analytics_campaign_daily` | `analytics_broadcast_summary` (re-aggregated by day, not raw tables — a rollup-of-rollup) | daily cron |
| `analytics_template_daily` | `broadcast_recipients` (joined via `broadcasts.template_id`), `automation_logs` (template sends via automation), `message_templates` (category) | daily cron |
| `analytics_delivery_funnel_daily` | `messages` (or `broadcast_recipients` for broadcast source), `automation_logs` for automation source | daily cron |
| `analytics_contact_growth_daily` / `_contact_source_daily` | `contacts` | daily cron |
| `analytics_pipeline_snapshot_daily` | `deals`, `pipeline_stages` | daily cron (point-in-time snapshot, not event-driven — deals move stages fluidly and a daily snapshot is the meaningful grain per PRD) |
| `analytics_deal_outcome_daily` | `deals` (status transitions to won/lost) | `deal.stage_changed` events + daily cron finalize |
| `analytics_credit_usage_daily` | `credit_ledger`, `credit_reservations`, `credit_wallets`, plus external Meta `pricing_analytics` (via `getPricingAnalytics`/`getWabaCurrency`) | `credit.reserved`/`credit.settled`/`credit.released` events + daily cron finalize + separate Meta-cost-sync cron (§2b) |
| `analytics_automation_execution_daily` | `automation_logs`, plus a join against `messages`/`deals` for the downstream-conversion columns (`replied_within_24h`, `deal_stage_advanced`) | `automation.executed` events + daily cron finalize |
| `platform_analytics_daily` / `platform_account_risk_flags` | all `analytics_*_daily` tables (aggregated across accounts, never raw per-tenant tables) | daily cron, platform-wide job, after all per-tenant daily finalize jobs complete |

## Retention & partitioning notes

- **Daily-grain rollups**: retained indefinitely. Row volume is bounded (`accounts × days × low-cardinality dimension`), not by raw message/event count, so this stays cheap regardless of a tenant's message history — this is the entire point of the pre-aggregation architecture ([TRD.md §1](./TRD.md#1-data-model-raw-vs-pre-aggregated)).
- **Hourly-grain rollups** (`analytics_conversation_hourly`): retained 90 days, then purged by a cron sweep — the daily rollup already preserves the long-term trend; only the intraday heatmap/SLA views need hour granularity, and those are inherently a recent-window use case.
- **`analytics_broadcast_summary`**: retained indefinitely (one row per broadcast ever sent — bounded by campaign count, not message count).
- **Raw operational tables** (`messages`, `broadcast_recipients`, etc.): retention is owned by their respective modules, not this schema, but reporting's design assumes a default 13-month raw-data retention window before archival to R2 — see [TRD.md §4](./TRD.md#4-d1-vs-postgres-implications-for-analytical-queries) for why this becomes **mandatory** if D1 is the chosen database, and the drill-down UX fallback in [UIUX.md §6](./UIUX.md#6-drill-down-interactions) for what happens when a user drills into an archived period.
- **`report_exports`**: rows (and their R2 objects) purged 30 days after `completed_at` by a daily cron sweep; `status='expired'` is set once `download_url_expires_at` passes even before the row itself is purged, so a stale link fails cleanly rather than 404ing without explanation.
- **`alert_events`**: no automatic purge in V1 (it's a low-volume audit trail — one row per threshold *transition*, not per tick); revisit if volume proves otherwise.
- **Partitioning**: not needed at V1 scale for any table here — every rollup table's row count is bounded by `accounts × time buckets × low-cardinality dimensions`, which stays modest even at hundreds of large tenants. If the platform later has enough tenants that the *shared* `analytics_conversation_hourly` table (the single highest-cardinality rollup, given the 90-day hourly retention) becomes large platform-wide, Postgres deployments can add `PARTITION BY RANGE (hour_start)` monthly without changing the table's public shape; D1 has no equivalent lever, so the 90-day purge above is the primary control on that specific table if D1 is chosen.
