# Reporting & Analytics — UI/UX

Part of the Nexara WACRM rebuild (`docs/rebuild discussion/`). Companion docs: [PRD.md](./PRD.md) (report catalog, metric formulas, personas) · [TRD.md](./TRD.md) (data/query design behind every screen) · [SCHEMA.md](./SCHEMA.md) (DDL). Frontend stack per `ARCHITECTURE_MODEL.md`: Next.js 16 + shadcn/ui, Recharts for charting (already a dependency). Screens are described in structured detail — no mockup images needed to build from this doc.

## 1. Information architecture

```
/reports                          Overview dashboard (pinned metric cards + top charts, per-persona default)
/reports/conversations            Conversation & Inbox Analytics
/reports/agents                   Agent Performance & SLA
/reports/broadcasts               Broadcast/Campaign list + comparison
/reports/broadcasts/:id           Single campaign detail
/reports/templates                Template Performance
/reports/funnels                  Delivery/Read Funnels
/reports/contacts                 Contact Growth & Segmentation
/reports/pipeline                 Pipeline/Deal Analytics
/reports/credits                  Credit & Meta-Cost Analytics  (flagship — visually distinct entry)
/reports/automations              Automation/Flow Analytics
/reports/custom                   Custom report builder (list of saved reports + "New report")
/reports/custom/:id                Builder/edit view for a saved report
/reports/schedules                Scheduled reports admin
/reports/alerts                   Alert rules admin

/platform/reports                 Platform-admin cross-tenant overview (separate nav section, gated)
```

Left nav within the app shell gets a **Reports** section (new top-level item, not buried under Settings — reflects its USP status). The nine built-in reports are grouped under three visually-separated clusters matching the personas' mental model:

- **Team & Conversations** — Conversation & Inbox, Agent Performance
- **Growth & Campaigns** — Broadcasts, Templates, Funnels, Contacts, Pipeline, Automations
- **Cost** — Credit & Meta-Cost (its own cluster, single item, given a distinct icon/accent — it's the differentiator, don't let it get lost in a list of nine)

Custom Reports, Schedules, and Alerts sit below as a second nav group ("Manage").

## 2. Dashboard layout (`/reports` overview)

Persona-aware default (per [PRD §4](./PRD.md#4-personas)):

- **Business Admin default**: today's replacement for the current `dashboard-shell.tsx` layout, generalized. Row 1: metric cards (Active Conversations, New Contacts Today, Open Deals Value, Messages Sent Today, **Credit Balance / Runway** — new card, using the same `MetricCard` component pattern with a delta row). Row 2: Conversations-over-time chart (left, 2/3 width) + Pipeline donut (right, 1/3 width) — same split as today. Row 3: Response-time chart (left) + **Credit burn chart** (right, new). Row 4: Activity feed (full width) + a compact "Reports you might pin" suggestion strip for reports not yet on the dashboard.
- **Operator default**: My Response Time card, My Open Conversations, My SLA status (breach count this week), My Activity feed. No account-wide cost data unless the account enables team visibility (per RBAC matrix).
- **Platform Admin default** (`/platform/reports`): Active Accounts, Total Messages (platform), Total Credits Settled, Avg Margin %, Accounts-at-risk list (low balance / high failure rate flags only — no tenant content).

Every card and chart on the dashboard is **pinned** from somewhere — either a default set or user-added via "Pin to dashboard" from any report page's chart. Pinning writes to `saved_reports.pinned_to_dashboard` (or a lightweight per-user dashboard-layout preference for built-in reports).

## 3. Individual report page layout (shared template)

Every report under `/reports/*` follows one consistent template so a Business Admin learns it once:

```
┌─────────────────────────────────────────────────────────────────┐
│ Report title + description        [Date range] [Compare▾] [⋮]   │  Header
├─────────────────────────────────────────────────────────────────┤
│ Filter bar: dimension chips (agent, template, category, tag...) │  Filters
├─────────────────────────────────────────────────────────────────┤
│ Top-line metric cards (3–5, matching the report's key formulas)  │  Summary
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Primary chart (full width or split, per §4 mapping)             │  Chart(s)
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│ Detail table (sortable, paginated) — rows drill down (§6)        │  Table
└─────────────────────────────────────────────────────────────────┘
```

The `[⋮]` header menu holds: Export (CSV/PDF), Schedule, Pin to dashboard, Save as custom report (pre-fills the builder with this report's current filters as a starting point).

## 4. Chart types per report

| Report | Chart(s) | Recharts component |
|---|---|---|
| Overview — Conversations over time | Dual-line (in/out), 7/30/90d toggle | `LineChart` (replaces the current hand-rolled SVG in `conversations-chart.tsx`) |
| Overview — Pipeline value | Donut with legend | `PieChart` (`innerRadius` set for donut) — replaces the hand-rolled arc-path SVG in `pipeline-donut.tsx` |
| Conversation & Inbox — volume heatmap | Hour × day-of-week grid | Custom grid of colored cells (Recharts has no native heatmap; render as a `ResponsiveContainer` grid of `Cell`-colored rects, or a styled HTML table — either is fine, no external heatmap lib needed) |
| Conversation & Inbox — response time trend | Line, with SLA target as a `ReferenceLine` | `LineChart` + `ReferenceLine` (this is the concrete upgrade path noted as a TODO in today's `response-time-chart.tsx`, which fell back to a header pill because the vendored Tremor component didn't expose reference lines — Recharts does) |
| Agent Performance | Grouped bar per agent (handled, avg response, SLA breaches) | `BarChart` with multiple `Bar` series |
| Broadcast/Campaign comparison | Sortable table + a small multiples bar (delivery/read/reply rate per campaign) | `BarChart`, one bar group per campaign |
| Broadcast detail | Funnel-style stacked bar (sent→delivered→read→replied→failed) + recipient status table | `BarChart` stacked, or the funnel component below |
| Template Performance | Horizontal bar ranking + side-by-side comparison table | `BarChart layout="vertical"` |
| Delivery/Read Funnels | Funnel chart (stage widths proportional to conversion) | Recharts has no native funnel — render as a `BarChart layout="vertical"` with one bar per stage, width = stage count, annotated with conversion % between bars |
| Contact Growth | Area/line for growth + stacked bar for source breakdown | `AreaChart`, `BarChart` (stacked) |
| Pipeline/Deal | Funnel (stage conversion) + donut (value by stage, reusing Overview's donut) + line (win rate trend) | `BarChart` (funnel-style, as above), `PieChart`, `LineChart` |
| Credit & Meta-Cost | Burn-rate line + stacked area (cost by category) + runway gauge | `LineChart`, `AreaChart` (stacked), gauge = a simple radial `PieChart` with a single value/remainder split |
| Automation/Flow | Success/partial/failed stacked bar per automation + downstream-conversion callout | `BarChart` stacked |
| Custom report builder | User-selected: table / bar / line / pie | Renders whichever `Recharts` component matches the user's choice, fed the same shaped rows regardless |

Consolidating on Recharts (already a dependency, per the constraints) also **retires** the current split between a hand-rolled SVG chart (`conversations-chart.tsx`, `pipeline-donut.tsx`) and the vendored Tremor wrapper (`response-time-chart.tsx`'s `@/components/tremor/bar-chart`) — one charting system, one visual language, one place to fix a bug.

## 5. Filters and date-range/compare

- **Date range control**: a single popover, shared component across every report page. Presets (Today, Yesterday, 7d, 30d, 90d, MTD, QTD, YTD) as a left rail inside the popover, custom range calendar on the right — standard shadcn/ui date-range-picker pattern.
- **Compare toggle**: a switch next to the date range; when on, a second, muted-color series/bar appears on every chart on the page (previous period by default, with a dropdown to pick "same period last year" or a custom range). Metric cards show the delta row (reusing the existing `MetricCard` delta pattern — arrow + colored % change).
- **Filter chips**: report-specific dimension filters (agent, template, category, tag, source, pipeline) render as removable chips below the header, added via a "+ Filter" combobox. Selecting a chip re-queries; the URL's query string is the source of truth for the current filter state (shareable/bookmarkable report views, and what a "Save as custom report" snapshots).
- Every report respects the account's configured timezone for day-bucket boundaries (per [TRD.md §2](./TRD.md#2-aggregation-pipeline) / [PRD open question #2](./PRD.md#14-open-questions)) — the date picker's day boundaries visually match what the user expects as "today," not a UTC cutoff.

## 6. Drill-down interactions

- **Chart → filtered list**: clicking a bar/line-point/donut-slice applies that data point's dimension (day, agent, template, stage, etc.) as an additional filter chip and scrolls to the detail table below, now scoped to that click. This is the standard interaction across every report — a user never needs to learn a different gesture per report.
- **Table row → record detail**: clicking a table row navigates to the underlying record's normal page (conversation thread in the inbox, contact profile, deal card in the pipeline board, broadcast detail, template editor) — reporting never duplicates that page, it links to the single source of truth.
- **Breadcrumb back-nav**: drilled-down views show a breadcrumb ("Credit & Cost > Sept 3 > Marketing category") so the user can step back up without losing their place, rather than relying on the browser back button.
- Where the underlying period has been archived past the raw-data retention window ([TRD.md §4](./TRD.md#4-d1-vs-postgres-implications-for-analytical-queries)), the drill-down gracefully shows "Detailed records for this period have been archived — rollup totals only" instead of an empty/broken table.

## 7. Custom report builder UX

A 4-step linear flow (not a dense all-in-one form — keeps it approachable for a non-technical Business Admin):

1. **Choose a dataset** — a card grid of the nine cubes (same names/icons as the built-in reports), each with a one-line description of what it covers.
2. **Choose dimensions & metrics** — two-column picker: left = available dimensions/metrics for the chosen cube (checkboxes, grouped), right = a live-updating preview list of what's selected. Metrics and dimensions are clearly visually distinct (metrics = numbers with a Σ icon, dimensions = a grouping icon) so users don't confuse "group by" with "measure."
3. **Filter & date range** — same filter-chip + date-range component as every built-in report (§5), so nothing new to learn.
4. **Visualize & save** — chart-type picker (table/bar/line/pie) with a live preview pane updating as choices change; Name + Description fields; Visibility radio (Private / Shared with account); optional "Pin to dashboard" checkbox.

A running live preview (small chart, real query against the rollup tables — cheap per [TRD.md §11](./TRD.md#11-performance-budgets)) is visible from step 2 onward so the user sees what they're building, not just a config form.

## 8. Empty, loading, and error states

Extends the existing pattern already established by `EmptyState` and `Skeleton` in `src/components/dashboard/`:

- **Loading**: skeleton placeholders matching each chart/card's final shape (already the pattern for metric cards, the conversations chart, response-time chart, pipeline donut — extend the same `Skeleton` component to every new report page).
- **Empty (no data in range)**: report-specific empty state with an icon + one-line explanation + a hint action (e.g., Credit report with zero activity: "No WhatsApp usage yet — connect your WABA to start seeing cost data," linking to onboarding). Never a bare blank chart.
- **Partial/provisional data**: the Credit & Meta-Cost report, before Phase 6 ships real settlement, renders with a visible "Provisional — based on reservations, not final settlement" badge (per [PRD §6.8](./PRD.md#68-credit--meta-cost--spend-analytics--flagship-usp-report)) rather than silently showing numbers that will later change.
- **Error**: a retry-capable inline error card scoped to the failed widget only — one chart failing to load never blanks the whole dashboard (each card/chart fetches independently).
- **Export/schedule in-flight states**: export button shows a spinner → "Preparing your export…" → toast with download link on completion (or "Check your email" if large/slow); a failed export shows a retry action, never a silent failure.

## 9. Export and schedule UX

- **Export**: header `[⋮]` menu → "Export as CSV" / "Export as PDF." Triggers the async pipeline ([TRD.md §9](./TRD.md#9-export-pipeline)); UI shows a non-blocking toast progressing from "Preparing…" to a download link (auto-appears once ready, no need to keep the tab open — also emailed).
- **Schedule**: header `[⋮]` menu → "Schedule this report" opens a modal: cadence (Daily/Weekly/Monthly) → conditional day/time picker → recipients (multi-select of account members by default, "+ add external email" behind an explicit toggle per [PRD open question #4](./PRD.md#14-open-questions)) → format (CSV/PDF). Existing schedules for the current report show inline above the "New schedule" button so a user doesn't accidentally create duplicates.
- **Schedules admin** (`/reports/schedules`): flat table of all schedules across all reports for the account — report name, cadence, recipients, next run, active toggle, edit/delete.
- **Alerts admin** (`/reports/alerts`): rule list (metric, comparator, threshold, channels, active toggle) + an "Alert history" tab showing `alert_events` (when it fired, the value, acknowledge action).

## 10. Mobile read-only views (Expo, post-Phase-9)

Per `ARCHITECTURE_MODEL.md`, mobile ships after the web core is stable and reporting is explicitly **read-only** there in V1:

- A single **Reports** tab in the mobile nav, listing the same report catalog as simplified cards (metric summary + one primary chart, no filter builder, no custom report authoring, no schedule/alert management).
- Date range restricted to the preset list (no custom calendar picker — smaller surface for a first mobile pass).
- Drill-down works (tap a chart → filtered list → record detail) since the underlying detail pages (conversation thread, contact, deal) are core mobile screens anyway per the Phase 9 plan.
- Export/Schedule/Alerts management is web-only in V1 — mobile shows a "Manage on web" link rather than a half-built form.
- Charts render via a mobile-friendly subset (line/bar/donut only — skip the heatmap grid and stacked funnel bars, which need more screen width than a phone offers) with `react-native-svg`-based equivalents, not Recharts (web-only lib) — this is a rendering-layer detail for the mobile implementation phase, not a data/API change; the mobile app calls the exact same `/api/app/reports/*` endpoints.

## 11. Accessibility

- Every chart has a text-equivalent: an `aria-label` summary (matching the existing pattern in `conversations-chart.tsx`'s `role="img" aria-label={...}`) **and** the paired detail table below it is the real accessible data source — a screen-reader user never has to parse an SVG to get the numbers.
- Full keyboard navigation: date-range popover, filter comboboxes, table sorting, and the custom report builder's step flow are all operable without a mouse (tab order, `Enter`/`Space` activation, `Esc` to close popovers).
- Color is never the sole signal: delta arrows (already established via `MetricCard`'s `ArrowUp`/`ArrowDown`/`Minus` icon pattern) pair every red/green color cue with an icon and text label ("+3 vs yesterday," not just a green number).
- Minimum contrast ratios (WCAG AA) maintained across both themes for chart lines/bars, gridlines, and axis labels — chart colors pull from the same CSS custom properties (`var(--border)`, `var(--muted-foreground)`) already used in the existing chart components, not hard-coded hexes, so a future theme/contrast adjustment is a single source of truth.
- Data tables use proper `<table>` semantics with sortable-column `aria-sort` state, not div-grids styled to look like tables.

## 12. Light/dark

Follows the existing dashboard components' approach exactly — no new pattern needed:

- Structural colors (borders, backgrounds, muted text) via CSS custom properties (`var(--border)`, `var(--card)`, `var(--muted-foreground)`, etc.) so both themes fall out for free, as already done in `conversations-chart.tsx`/`pipeline-donut.tsx`/`response-time-chart.tsx`.
- Series/accent colors (chart lines, bars, donut segments) are the small set of brand accents already in use (`#3b82f6` blue, `#7c3aed` violet, plus a small extended palette for reports needing more categories — e.g., template category colors, funnel stage colors) — chosen to hold sufficient contrast in both themes rather than re-picked per theme.
- No report-specific dark-mode overrides needed beyond what the shared chart/card components already provide — consistency here is what makes the whole Reports section feel like one coherent product rather than nine separately-styled pages.
