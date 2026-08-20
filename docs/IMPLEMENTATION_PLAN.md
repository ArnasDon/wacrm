# Rimula Implementation Plan

Tracks what's reused as-is from the wacrm fork, what's extended, and
what's net-new, phase by phase (§23 of `RIMULA_BUILD_SPEC.md`). Written
retroactively at the start of Phase 6 — Phases 1–5 are summarized from
`git log`/`CHANGELOG.md`; Phase 6 is documented in full as it's built.

## Phase status

| # | Phase | Status |
|---|---|---|
| 1 | Foundation + schema (net-new tables, markets/regions, member/BA fields) | Done |
| 2 | `WhatsAppService`/`DemoWhatsAppService` + Members/BAs/markets-regions | Done |
| 3 | Content → media → localization → approval → scheduling | Done |
| 4 | Demo WhatsApp end-to-end + engagement events | Done |
| 5 | Products → claims → vehicles → compatibility → campaigns | Done |
| 6 | Requests → leads → BA routing → trials → conversions | **Done (this doc)** |
| 7 | Dashboard → analytics → attribution → reports | Not started |
| 8 | Meta hardening → catalogue sync → TTS/AI/translation providers | Not started (architected: `TranslationService`/`TextToSpeechService` interfaces exist as manual/no-op P0 implementations per §10) |

Other §22 docs (`ARCHITECTURE.md`, `WHATSAPP_FEASIBILITY.md`, `API.md`,
`DATA_MODEL.md`) are not yet written — out of scope for this pass,
tracked as follow-up.

## Phase 6 — Requests → Leads → BA routing → Trials → Conversions

### Reused as-is

- `customer_requests`, `trials` — schema landed in Phase 1 (migrations
  044/045) with RLS already in place; this phase adds the
  `routing_reason` column and a `customer_requests.deal_id` forward
  link (migration 056), then wires the API/UI/routing logic on top.
- `engagement_events` — the `LEAD`/`TRIAL`/`CONVERSION` event types
  existed in the schema and the `writeEngagementEvent` writer
  (`src/lib/whatsapp/engagement.ts`) since Phase 4 but were unused.
  This phase is what finally writes them.
- `product_interactions`, `profiles.open_leads`/`capacity`/
  `region_id`/`market_id`/`ba_status`/`languages` (migration 051) —
  schema existed, application logic didn't.
- Pipelines Kanban UI/RLS, `automation_logs`-style RPC pattern
  (migration 018's `set_member_role` — mirrored for
  `set_ba_profile_fields`), the `requireRole`/`toErrorResponse`
  API-route convention, the campaigns/products list-page UI idiom.

### Extended

- **`deals` → `Lead`** (migration 055). `status` widened from
  `'open'|'won'|'lost'` to the 8-value funnel enum; old rows remapped
  (`open→NEW`, `won→CONVERTED`, `lost→LOST`). New columns: `source`,
  `campaign_id`, `original_content_id`, `market_id`, `region_id`,
  `next_follow_up`, `last_contacted`, `outcome`, `routing_reason`.
  `assigned_to` and `contact_id` already existed and map directly to
  `assignedBA`/`customer` — confirmed genuinely net-new per §9.0's
  correction table, no redundant columns added.
  **Product attribution is NOT a `deals` column** — §9.1 lists
  `product` on Lead, but it's reached via `campaign_id → campaigns.product_id`
  rather than a duplicate FK, since a Lead's product is normally the
  one its originating campaign is about.
- Every existing `deals.status` reader (Pipelines Kanban, dashboard
  queries, automations `create_deal` step, contact detail view) —
  updated for the new enum values. See `CHANGELOG.md`'s 0.15.0 entry
  for the full list.
- `GET /api/account/members` — now embeds each member's BA fields
  (region/market names, `ba_status`, `open_leads`, `capacity`,
  `languages`) so the BA routing Settings panel doesn't need a second
  round trip.

### Net-new

- **`ba_routing_settings`** (056) — one row per account: routing
  `strategy` (`round_robin` / `lowest_open_leads` / `manual`) +
  `round_robin_cursor`. Settings-class RLS (any member reads, admin+
  writes).
- **SECURITY DEFINER RPCs** (056): `set_ba_profile_fields` (admin
  edits a teammate's BA fields — `profiles_update` RLS only allows
  self-edit), `adjust_ba_open_leads` (atomic ±1 on a BA's open-lead
  counter, callable by any agent+ acting as the router, not just the
  target BA), `advance_ba_routing_cursor` (round-robin state).
- **`LeadRoutingService`** (`src/lib/routing/service.ts`) — the §2
  provider-abstraction pattern applied to §12's routing requirement.
  `routeAssignment()` resolves Market BA → Regional BA → Unassigned
  per the account's configured strategy and returns `{assignedBaId,
  reason}`; `commitAssignment()` applies the `open_leads` delta;
  `resolveMarketRegionFromContact()` lets `CustomerRequest`/`Trial`
  (which carry no market/region of their own — only `Member`/`BA`/
  `Lead` do, per §9.1) route off their linked Member's market/region.
- **`createLead()`** (`src/lib/routing/create-lead.ts`) — the shared
  Lead-creation path used by both `POST /api/leads` and
  `POST /api/customer-requests/[id]/convert`, so routing/pipeline-
  resolution/analytics-writes can't drift between the two entry
  points. Handles the one real schema gotcha in this phase:
  `deals.assigned_to` targets `profiles.id` (migration 002), while
  `customer_requests.assigned_ba_id`/`trials.assigned_ba_id` target
  `auth.users(id)` directly (migrations 044/045) — i.e. the same value
  as `profiles.user_id`. `LeadRoutingService` stays in `user_id` terms
  throughout; `createLead()` is the one place that translates to
  `profiles.id` for the `deals` write.
- **`writeProductInteraction()`** (`src/lib/analytics/product-interaction.ts`)
  — the `product_interactions` counterpart to `writeEngagementEvent`,
  same best-effort/service-role-client posture.
- **API routes**: `customer-requests` (GET/POST, `[id]` GET/PATCH/
  DELETE, `[id]/convert` POST), `leads` (GET/POST, `[id]` GET/PATCH/
  DELETE), `trials` (GET/POST, `[id]` GET/PATCH/DELETE),
  `settings/ba-routing` (GET/PATCH), `account/members/[userId]/ba-profile`
  (PATCH).
- **UI**: `/leads` (new nav entry, §7) — Requests/Leads/Trials tabs,
  status changes, "Convert to Lead," "My queue only" filter, creation
  dialogs for Requests/Trials. Settings → "BA routing" section
  (strategy selector + per-BA profile editor).

### Conversion cascade

`Trial.status → CONVERTED` writes the `CONVERSION` engagement event +
`product_interactions` row, decrements the Trial's own assignee's
`open_leads`, and — if `trials.deal_id` is set — also flips the linked
Lead to `CONVERTED` and decrements *its* assignee's `open_leads`,
without re-firing a second `CONVERSION` event for the same funnel
step. `Lead.status → CONVERTED` (reached directly, without a Trial)
fires the same event/interaction pair on its own.

### Known gaps / deferred

- **No seed data** for `customer_requests`/Lead-shaped `deals`/
  `trials` yet. §19's seed script still only covers Phases 1–5; the
  funnel is exercisable end-to-end via the UI/API but starts empty on
  a fresh seed run. Follow-up: extend the seed script to generate a
  request → lead → trial → conversion chain per the §19 volumes.
  Also skipped: `Feedback` (§12's category/member/market/message/
  status/admin-escalation type) — no schema or UI yet, tracked as a
  Phase 6 follow-up rather than folded into `CustomerRequest`.
- **No Markets/Regions management UI** (§15). The tables and RLS have
  existed since Phase 1 (migration 049); nothing before this phase
  built a way to create rows in them. Routing and the BA profile
  editor both degrade to "Unassigned"/empty pickers until an admin
  seeds at least one market or region directly.
- **Pipelines Kanban bypass**: marking a deal Won/Lost from
  `/pipelines` still writes directly to `deals` via the client-side
  Supabase pattern the Kanban board has always used, and does not
  invoke `LeadRoutingService`'s bookkeeping or fire a `CONVERSION`
  event. `/leads` is the intended surface for Lead lifecycle actions;
  documented in `CHANGELOG.md` so it isn't a surprise later.
- **BA dashboard** (§12's "My New Leads / My Product Questions / My
  Trial Requests / My Follow-ups / My Conversions") is implemented as
  a single "My queue only" filter across the three `/leads` tabs
  rather than five separate named views — the underlying data
  (assignment, type, status) supports building the fuller breakdown
  later without a schema change. Full Admin/BA analytics dashboards
  are Phase 7's job (§13).

### Testing

New `vitest` coverage (42 new tests, all under `src/**/*.test.ts`,
node environment, existing `requireRole`-mock convention):

- `src/lib/routing/service.test.ts` — strategy selection (manual/
  round-robin/lowest-open-leads), Market→Region→Unassigned cascade,
  capacity-aware candidate filtering, `commitAssignment`'s no-op and
  RPC-failure-swallowing behavior.
- `src/lib/routing/create-lead.test.ts` — default-pipeline reuse vs.
  auto-creation, and the `profiles.id`/`profiles.user_id` translation
  (the one place a routing bug would silently corrupt `deals.assigned_to`).
- `src/app/api/customer-requests/route.test.ts`,
  `src/app/api/trials/route.test.ts`,
  `src/app/api/leads/route.test.ts` — validation, authorization
  boundaries (403 without agent+), routed-vs-unassigned insert shape.
- `src/app/api/leads/[id]/route.test.ts` — the CONVERTED transition's
  side effects (open-lead decrement, event/interaction writes) vs. a
  non-terminal status change (neither fires).
- `src/app/api/settings/ba-routing/route.test.ts` — default strategy,
  validation, admin-only write.

Not covered by an isolated test (exercised only by `npm run build`'s
route-collection pass and manual reasoning): `customer-requests/[id]/convert`,
`trials/[id]`'s conversion cascade, `account/members/[userId]/ba-profile`.
Same shape as the already-tested `leads/[id]` conversion path; flagged
as a follow-up rather than skipped silently.

Full §21 suite green at the end of this phase: typecheck, lint (0
errors, unchanged 37 pre-existing warnings), test (986/986), build.
`format:check` reports the same pre-existing baseline as before this
phase (two files already failing it before Phase 6 touched them).
