# Reporting & Analytics — PRD

Part of the Nexara WACRM rebuild (`docs/rebuild discussion/`). Companion docs: [TRD.md](./TRD.md) (technical design) · [UIUX.md](./UIUX.md) (screens/interactions) · [SCHEMA.md](./SCHEMA.md) (DDL). Sits under the master [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md) as part of Phase 8 (Web parity) with foundations laid in Phase 2 (schema) and Phase 6 (credits) — reporting on credits cannot report real settlement data until Phase 6 ships, but the schema and UI should exist earlier against reservation/estimate data.

## 1. Problem

Every WhatsApp-CRM in this category (WATI, AiSensy, Interakt, Zoko, Gallabox and similar) ships a dashboard that stops at "messages sent" and "conversations open." None of them answer the questions an operator running a real WhatsApp commercial program actually has:

- *Is my team meeting response-time SLAs, and which agents are the bottleneck?*
- *Which templates and campaigns actually convert into replies and deals — not just deliveries?*
- *What is this costing me, broken down by category (marketing/utility/auth), and how many days of runway does my credit balance have at the current burn rate?*
- *Where exactly is the funnel leaking — sent→delivered→read→replied — and for which segment?*

Nexara WACRM's reporting module is a named strategic USP (per `docs/rebuild discussion/billing-and-branding-direction.md` positioning and the master plan). It must be the reason a prospect picks WACRM over a cheaper competitor, not an afterthought bolted onto the dashboard.

## 2. Goals

- Give every persona a report that answers their specific question in ≤2 clicks from login.
- Make **cost/credit analytics** (unique among WhatsApp-CRM competitors) a first-class, prominent report, not a billing-page footnote.
- Support drill-down from any aggregate number down to the underlying conversation/message/contact/deal record.
- Let account admins build and save their own report views without engineering involvement (custom report builder).
- Support scheduled delivery (email) and on-demand export (CSV/PDF) of any report.
- Alert proactively on thresholds (SLA breach rate, low credit balance, delivery-rate drop) rather than requiring the user to go looking.
- Do all of this within the Cloudflare Workers 10ms-CPU-class request budget — see [TRD.md §5](./TRD.md#5-performance-budgets) for how pre-aggregation makes this possible.
- Preserve strict multi-tenant isolation: every report, every row, every export is scoped to `account_id`; platform admin cross-tenant views are aggregate-only, never per-tenant detail (see [TRD.md §8](./TRD.md#8-tenant-isolation-enforcement)).

## 3. Non-goals (V1)

- Predictive/ML analytics (churn prediction, demand forecasting).
- CSAT/NPS survey collection and reporting (no survey infrastructure exists yet).
- A general-purpose BI / arbitrary-SQL query tool.
- Cross-tenant benchmarking shown *to tenants* ("you vs. industry average").
- Sub-second real-time streaming dashboards — near-real-time (5–15 min freshness) is the target; see [TRD.md §6](./TRD.md#6-realtime-vs-near-real-time).
- Report editing from the mobile app (mobile is read-only for V1 — see [PLAN Phase 9](../IMPLEMENTATION_PLAN.md)).

Full out-of-scope list: [§13](#13-out-of-scope).

## 4. Personas

| Persona | Who | Primary questions | Access level |
|---|---|---|---|
| **Business Admin** | Account owner/admin — runs the WhatsApp program commercially | Team performance, campaign ROI, cost/credit runway, pipeline health | Full account reporting, billing/cost reports, export & schedule, alert config |
| **Operator** | Agent/support rep working the inbox | My response time, my open conversations, my SLA status | Own performance + shared team dashboards; no account-wide cost/margin data by default |
| **Platform Admin** | Nexara operator managing many tenant accounts | Platform health, adoption, aggregate usage/margin across accounts, which accounts are at risk (low balance, failing broadcasts) | Cross-tenant **aggregate-only** reports — never a specific tenant's conversation content or contact PII |

Role names track whatever `AUTH_EXTENSION.md`'s `PermissionService` finalizes; §11 defines the report-permission matrix independent of exact role-table shape so it doesn't need rework if role names change.

## 5. USP positioning vs. typical WhatsApp-CRM dashboards

| Capability | Typical WA-CRM dashboard | Nexara WACRM Reporting |
|---|---|---|
| Message/conversation counts | ✅ basic | ✅ plus trend, compare-to-prior-period, hourly heatmap |
| Agent performance | Rare / manual | ✅ SLA-target breach tracking, p50/p90 response time, workload balance |
| Campaign analytics | Sent/delivered counts | ✅ full funnel + reply rate + **cost per reply** + cross-campaign comparison |
| Template analytics | Not offered | ✅ performance & cost by template, category, language |
| Cost/credit analytics | Billing page shows a balance | ✅ **dedicated report**: burn rate, runway, cost by category, cost per conversation, tied to actual Meta pricing data |
| Pipeline/deal analytics | Separate CRM feature, not linked to messaging | ✅ correlated with the conversation/campaign that originated the deal |
| Automation analytics | Not offered or execution log only | ✅ success/failure rates, downstream conversion (did the automation lead to a reply/deal) |
| Custom report builder | Not offered | ✅ save/share account-defined views |
| Scheduled reports + export | CSV export at best | ✅ CSV + PDF, scheduled email delivery |
| Alerts/thresholds | Not offered | ✅ SLA, balance, delivery-rate, failure-rate alerts |
| Drill-down | Aggregate numbers only | ✅ every chart/table cell drills to record level |

The **credit + Meta-cost report** (§6.8) is the single biggest differentiator: no competitor in this space exposes true unit economics (cost per conversation, cost per category, burn/runway) because none of them operate a metered credit system tied to real Meta billing data the way Nexara does.

## 6. Report catalog

Each report is backed by a pre-aggregated rollup table (never raw-table aggregation in the request path — see [TRD.md §1](./TRD.md#1-data-model-raw-vs-pre-aggregated)). All reports support the shared filter set in §10 unless noted.

> **† Schema-prerequisite metrics.** Verified against the current schema (`supabase/migrations/`), four metrics below have **no backing column today** and are gated on new operational columns added in Phase 2 (consolidated in [TRD "Upstream schema prerequisites"](./TRD.md#0a-upstream-schema-prerequisites)). If a prerequisite column is not added, that metric is **cut**, not faked: **avg resolution time / reopen rate** (need `conversations.closed_at` + a reopen signal), **opt-out rate / growth-by-source** (need `contacts.opt_out_at` + `contacts.source`), **deal origin** (needs `deals.origin_conversation_id` / `origin_broadcast_id` / `source`). All date/hour bucketing also requires `accounts.timezone` (see §14).

### 6.1 Conversation & Inbox Analytics
**Audience:** Business Admin, Operator. **Question:** "What's happening in my inbox?"

| Metric | Formula |
|---|---|
| New conversations | count of conversations created in period |
| Open / Pending / Closed | current status snapshot count |
| Messages in / out | count by `sender_type` (`customer` = in; `agent`+`bot` = out) |
| Median / P90 first-response time | time from first inbound message in a conversation to the first subsequent outbound message, per conversation, aggregated |
| Avg resolution time † | `closed_at - created_at` for conversations closed in period — **needs `conversations.closed_at`** |
| Reopen rate † | conversations reopened after close / conversations closed — **needs a reopen signal (status-transition log or reopen counter)** |
| Volume heatmap | inbound/outbound message counts by hour-of-day × day-of-week |

Drill-down: day/hour cell → conversation list (filtered) → conversation detail (inbox thread).

### 6.2 Agent Performance & Response-Time SLA
**Audience:** Business Admin (all agents), Operator (self + team, if permitted). **Question:** "Is my team meeting SLA, and who's the bottleneck?"

| Metric | Formula |
|---|---|
| Conversations handled | distinct conversations with ≥1 outbound message by the agent in period |
| Avg / Median / P90 first-response time | per-agent version of 6.1's metric |
| SLA breach count / rate | responses where `response_time > sla_target_secs` (account-configurable, default 300s) ÷ total responses |
| Avg resolution time | per-agent, conversations they closed |
| Workload | currently assigned open conversations |

Drill-down: agent row → their conversation list → thread. SLA target is an account setting surfaced in this report's header.

### 6.3 Broadcast / Campaign Analytics
**Audience:** Business Admin. **Question:** "Did this campaign work, and what did it cost?"

| Metric | Formula |
|---|---|
| Delivery rate | `delivered / sent` |
| Read rate | `read / delivered` |
| Reply rate | `replied / delivered` |
| Failure rate | `failed / recipients` |
| Cost | credits debited for the broadcast (from `credit_ledger`, reason=`whatsapp_usage`, reference=broadcast) |
| Cost per reply | `cost / replied` (the single number that tells an admin if a campaign was worth running) |
| Pacing duration | `completed_at - started_at` |

Cross-campaign comparison table (sortable by any metric above) plus per-campaign detail page. Drill-down: campaign row → recipient list by status → contact detail.

### 6.4 Template Performance
**Audience:** Business Admin. **Question:** "Which templates should I keep using?"

| Metric | Formula |
|---|---|
| Usage count | sends across broadcasts + automations + manual sends |
| Delivered / Read / Reply rate | same formulas as 6.3, scoped to the template |
| Rejection rate | Meta template review rejections / submissions (from template status history) |
| Cost per send | credits debited ÷ sends |

Side-by-side comparison across templates, filterable by category (Marketing/Utility/Authentication) and language.

### 6.5 Delivery / Read Funnels
**Audience:** Business Admin. **Question:** "Where is the funnel leaking?"

Funnel stages: **Sent → Delivered → Read → Replied**, with a **Failed** branch off any stage. Segmentable by source (`broadcast` / `automation` / `manual` / `service`) and by template category.

| Metric | Formula |
|---|---|
| Stage conversion | `stage_n_count / stage_(n-1)_count` |
| Drop-off | `1 - stage conversion` |
| Failure rate by reason | failed count grouped by Meta error/status reason |

### 6.6 Contact Growth & Segmentation
**Audience:** Business Admin. **Question:** "Is my contact base growing, and who's actually engaged?"

| Metric | Formula |
|---|---|
| New contacts | count created in period |
| Growth rate | `(new_this_period - new_last_period) / new_last_period` |
| Active / dormant | messaged in last 30/60/90 days vs. not |
| Opt-out rate † | contacts that unsubscribed/blocked ÷ total contacts — **needs `contacts.opt_out_at` (no such field today)** |
| Growth by source † | breakdown of new-contact source (manual entry, API, broadcast opt-in, webhook) — **needs `contacts.source` (no such field today)** |

Segmentation filters (tag, custom field, source, activity recency) feed directly into the custom report builder's dimension picker (§7).

### 6.7 Pipeline / Deal Analytics
**Audience:** Business Admin. **Question:** "Is the sales pipeline healthy, and is WhatsApp driving it?"

| Metric | Formula |
|---|---|
| Deals by stage | count + total value, snapshotted daily |
| Win rate | `won / (won + lost)` |
| Avg cycle time | `closed_at - created_at` for won/lost deals |
| Pipeline velocity | `(won_count × avg_won_value) / avg_cycle_time_days` |
| Stage conversion funnel | deals reaching stage *n* ÷ deals reaching stage *n-1* |
| **Deal origin** (USP) † | deals whose originating conversation/broadcast links back to a specific campaign — surfaces which campaigns generate pipeline, not just replies. **`deals` has NO such link today — needs `deals.origin_conversation_id`, `origin_broadcast_id`, `source` (Phase-2 prerequisite). Without them this flagship pipeline USP is cut.** |

### 6.8 Credit & Meta-Cost / Spend Analytics — **flagship USP report**
**Audience:** Business Admin (own account); Platform Admin (aggregate + margin, cross-tenant). **Question:** "What is my WhatsApp program actually costing me, and how long will my balance last?"

| Metric | Formula |
|---|---|
| Credits purchased / consumed | from `credit_ledger` reasons `purchase`/`monthly_grant`/`promotional_credit` vs `whatsapp_usage` |
| Ending balance | daily snapshot from `credit_wallets` |
| Burn rate | avg daily net credit consumption over trailing N days |
| Runway | `ending_balance / burn_rate` (days) |
| Cost per conversation / per message | credits settled ÷ conversations or messages in period |
| Cost by category | Marketing / Utility / Authentication / Service(free), pulled from Meta's `pricing_analytics` edge (`src/lib/whatsapp/pricing-analytics.ts` today) synced into the rollup — see [TRD.md §2](./TRD.md#2-aggregation-pipeline) |
| Top N most expensive broadcasts/templates | ranks by credits debited |
| **Margin** (platform-admin only) | `credit price charged - actual Meta cost`, never shown to the tenant |

This report only shows real settlement data once Phase 6 (credits) ships; until then it renders from `credit_reservations`/estimated usage with a clear "provisional" label.

### 6.9 Automation / Flow Analytics
**Audience:** Business Admin. **Question:** "Are my automations working, and are they worth it?"

| Metric | Formula |
|---|---|
| Executions (success/partial/failed) | counts from `automation_logs.status` |
| Failure rate | failed ÷ total executions |
| Trigger volume | executions grouped by `trigger_event` |
| Contacts reached | distinct contacts touched by the automation |
| **Downstream conversion** (USP) | of contacts reached, % that replied within 24h or advanced a deal stage — ties automation activity to real outcomes |

## 7. Custom report builder

Business Admins can compose a new report without engineering:

1. **Base dataset ("cube")** — one of the nine rollup families above (never raw operational tables, to keep every custom query index-backed and cheap; see [TRD.md §3](./TRD.md#3-query-patterns-behind-databaseprovider)).
2. **Dimensions** — the cube's allowed grouping columns (e.g., day/week/month, agent, template, broadcast, tag, pipeline stage, contact source).
3. **Metrics** — the cube's allowed metric columns/formulas (a fixed, curated list per cube — not arbitrary SQL, both for safety and to guarantee the query stays index-backed).
4. **Filters** — date range + dimension filters (multi-select) + saved segments.
5. **Visualization** — table, bar, line, or pie (mapped in [UIUX.md §4](./UIUX.md#4-chart-types-per-report)).
6. **Save** — private to the creator or shared account-wide; optionally pinned to the account's Overview dashboard.

No free-SQL mode in V1 — see [§13](#13-out-of-scope).

## 8. Scheduled reports + exports

- **Export**: any built-in or custom report has an "Export" action → CSV or PDF, generated asynchronously (queue → file → signed R2 URL), delivered as an in-app download link and emailed when ready. Typically seconds; large exports bounded by the performance budget in [TRD.md §5](./TRD.md#5-performance-budgets).
- **Schedule**: any report can be scheduled — daily / weekly / monthly, a chosen send time + account timezone, recipient list (account members by default; external emails require explicit opt-in per [TRD open question](#14-open-questions)), CSV or PDF attachment.
- Exported files expire and are purged from storage after a retention window (default 30 days) — see [SCHEMA.md](./SCHEMA.md#retention--partitioning-notes).

## 9. Alerts & thresholds

Business Admins define threshold rules evaluated on the same 5–15 minute cadence as rollups (not instant — see [TRD.md §6](./TRD.md#6-realtime-vs-near-real-time)):

| Alert type | Example default |
|---|---|
| SLA breach rate | > 20% of responses over target in the last hour |
| Low credit balance | balance < configurable threshold (same field already used by `account_wallets.low_balance_threshold` in the current schema) |
| Unusual burn rate | daily burn > 2× trailing 7-day average |
| Broadcast failure rate | > 10% failed on a completed broadcast |
| Template rejection | any template moves to `Rejected` |
| Automation failure spike | failure rate > 25% in the last hour for an active automation |

Delivery channels: in-app notification (always) + email (opt-in). Webhook delivery is a plausible V2 addition, not built now.

## 10. Drill-down, date range & compare (shared across all reports)

- **Drill-down**: every chart segment / table row is clickable and navigates to a filtered detail list (e.g., the conversations behind a data point), which in turn links to the individual record (conversation/contact/deal/broadcast/template) in its normal WACRM page. Rollup rows never store full record-level detail — drill-down issues a fresh, cheap, indexed query against the operational tables scoped by the dimension key clicked (see [TRD.md §3](./TRD.md#3-query-patterns-behind-databaseprovider)).
- **Date range**: presets (Today, Yesterday, 7d, 30d, 90d, MTD, QTD, YTD) + custom range, evaluated in the account's configured timezone so day buckets match the business's calendar, not UTC.
- **Compare**: toggle to overlay the previous equivalent period, the same period last year, or a custom comparison range — applies to every chart, not just the top-line metric cards (today's dashboard only compares "today vs yesterday" on a few cards; this generalizes it).

## 11. RBAC on reports

| Report / action | Platform Admin | Business Admin | Operator |
|---|---|---|---|
| Conversation & Inbox | aggregate, cross-tenant | full account | own + team (if account enables team visibility) |
| Agent Performance | aggregate only | full account | own only by default |
| Broadcast/Campaign, Template, Funnel | account list only (no content) | full account | read-only if role permits |
| Contact Growth & Segmentation | aggregate only | full account | — |
| Pipeline/Deal | account list only | full account | assigned deals only |
| **Credit & Meta-Cost** | aggregate + margin (own view) | full account (no cross-tenant, no margin) | — |
| Automation/Flow | account list only | full account | — |
| Custom report builder | — (platform reports are fixed) | create/save/share | create/save private only (if permitted) |
| Scheduled reports & exports | platform-level only | full | own reports only |
| Alerts | platform-level only | full config | view own-scoped alerts |

Enforced server-side by `PermissionService` before any repository call executes — never by hiding UI alone (see [TRD.md §8](./TRD.md#8-tenant-isolation-enforcement)).

## 12. Success metrics (for the reporting module itself)

- Dashboard P95 load time under the Workers performance budget ([TRD.md §5](./TRD.md#5-performance-budgets)).
- ≥40% of accounts create at least one saved custom report within 30 days of onboarding.
- ≥25% of accounts have an active scheduled report within 60 days.
- Measurable drop in support tickets of the form "how many messages did I send / what's my balance."
- Reporting cited as a top-3 competitive reason in sales win/loss notes within two quarters of launch.

## 13. Out of scope (V1)

- Predictive/ML analytics (forecasting, churn scoring).
- CSAT/NPS ingestion and reporting (no survey capability exists).
- Free-form/arbitrary-SQL report builder ("BI mode").
- Cross-tenant benchmarking exposed to tenants.
- Sub-second real-time / streaming dashboards.
- Mobile report authoring (mobile is read-only).
- Webhook-based alert delivery.
- White-labeled embeddable report widgets for a tenant's own end customers.
- Postpaid billing reporting (postpaid is schema-ready but not built per `CREDITS_BILLING_DESIGN.md`).

## 14. Open questions

1. **DB decision dependency**: hourly-grain rollups (needed for intraday SLA/heatmap) are cheap on Postgres but a real write-contention risk on D1 at broadcast-burst scale — the benchmark in `DATABASE_DECISION.md` needs to settle before hourly-grain reports are locked in as V1 scope vs. daily-only. See [TRD.md §2](./TRD.md#2-aggregation-pipeline).
2. **Account timezone — RESOLVED (verified 2026-09-11): `accounts.timezone` does NOT exist.** Now a **required Phase-2 prerequisite**, not an open question — every day/hour bucket depends on it. Add `accounts.timezone` (IANA string, default `UTC`). See [TRD Upstream schema prerequisites](./TRD.md#0a-upstream-schema-prerequisites).
3. **Platform-admin cross-tenant aggregates**: these necessarily read *across* tenant rollups (already-aggregated, never raw), which is a deliberate, narrow exception to "every query filters `account_id`" — needs explicit architect sign-off as the one sanctioned exception.
4. **External email recipients** on scheduled reports — allowed, or restricted to verified account members only (DLP/security posture question)?
5. **Export URL exposure**: should R2 signed export URLs require an authenticated re-fetch (proxy through the app) rather than a bare signed link that could be forwarded?
6. **Meta cost staleness**: `pricing_analytics` is currently fetched live per-request (`src/lib/whatsapp/pricing-analytics.ts`). The TRD proposes syncing it into rollups on a schedule (≤24h staleness). Confirm that's acceptable for the cost report, or whether the credit report needs a "live Meta cost" drill-through separate from the rollup.
