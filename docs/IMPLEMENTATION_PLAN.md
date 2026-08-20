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
| 6 | Requests → leads → BA routing → trials → conversions | Done |
| 7 | Dashboard → analytics → attribution → reports | **Done (this doc)** |
| 8 | Meta hardening → catalogue sync → TTS/AI/translation providers | **Done, reduced scope (this doc)** — TTS and AI-assisted translation dropped by product decision, see below |

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

- **Correction (added during Phase 8's DoD review — the claim below
  was wrong when first written and went unverified):** `scripts/seed.ts`
  already seeds `customer_requests`, `trials` (including one
  `CONVERTED` row), `engagement_events`, `product_interactions`, and
  `whatsapp_sync_log` — that seeding was done in the Phase 1/2
  groundwork, before this phase, and this doc originally claimed
  "no seed data" without checking. The real, narrower gap: **`deals`
  (Lead) rows are not seeded at all** — no `seedDeals` function exists
  in `scripts/seed.ts`. Since Phase 7's funnel/campaign analytics use
  `deals.status = 'CONVERTED'` as the authoritative LEAD/BA-CONTACT/
  PURCHASE signal (not `trials.status`), a fresh seed shows real
  numbers for Reach/Join/Engage/Product Interest/Trial but **0 for
  Lead, BA Contact, and Purchase**, and every campaign's
  leads/conversions/cost-per-lead columns are 0 — even though the one
  seeded `CONVERTED` trial exists. Follow-up: add a `seedDeals`
  function creating Lead rows (with `source`/`campaign_id`/
  `market_id`/`region_id`) for at least the contacts that already have
  a `customer_requests`/`trials` row, so the funnel's later stages
  aren't structurally empty on a fresh seed.
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

## Phase 7 — Dashboard → analytics → attribution → reports

No schema changes. Every number in this phase reads tables Phases
1–6 already populate — `engagement_events`, `product_interactions`,
`customer_requests`, `deals`, `trials` — so this phase is pure
application layer: one new aggregation module, four new UI surfaces,
one new nav entry.

**On the Phase 6 gaps this phase inherits** (originally believed to be
"no seed data for the funnel stages" — corrected during Phase 8's DoD
review to the narrower real gap: `deals`/Lead rows specifically aren't
seeded, see that correction in the Phase 6 section above; and no
Markets/Regions management UI): decided to proceed rather than block
on either. Every query and every widget here is written to degrade to
real zeros/empty states, never an error or a fabricated number, on an
account with no funnel data yet — verified with a dedicated
"fully empty account" test on `loadFunnelMetrics`. Markets/Regions
specifically don't matter to this phase at all — funnel/campaign/
product analytics never key on them. Seeding `deals` is tracked as a
Phase 6 follow-up, not duplicated here.

### Reused as-is

- `queries.ts`, `types.ts`, and every existing dashboard widget
  (`MetricCard`, `SkeletonCard`, `EmptyState`, `Skeleton`,
  `ConversationsChart`, `PipelineDonut`, `ResponseTimeChart`,
  `ActivityFeed`) — this phase adds one more widget to the same page,
  it doesn't touch the originals.
- The vendored Tremor `BarChart` (`src/components/tremor/bar-chart.tsx`,
  wraps `recharts`) — already used by `ResponseTimeChart`; the funnel
  widget is its second consumer, in `layout="vertical"` (horizontal
  bars) rather than the default.
- `formatCurrency` (`src/lib/currency.ts`) for every cost figure —
  `accounts.default_currency`, never a hardcoded currency (§13).
- The campaign/product detail pages' own plain-English-copy convention
  (Phase 5) and the contact detail view's `next-intl` convention
  (pre-existing wacrm) — each new section matches the file it lands
  in rather than picking one global i18n policy (§7/§10 keep i18n
  scoped to UI chrome; page-level copy on Phase 5+-era pages was never
  translated, and this phase doesn't change that split).

### Net-new

- **`src/lib/dashboard/rimula-analytics.ts`** — `loadFunnelMetrics`,
  `loadCampaignAnalytics`/`loadAllCampaignsAnalytics`,
  `loadProductAnalytics`/`loadAllProductsAnalytics`. The batch
  variants fetch every relevant row once (scoped by `.in('campaign_id'
  , ids)` / `.in('product_id', ids)`) and aggregate client-side,
  rather than querying per campaign/product — same
  fetch-broad-then-aggregate posture `queries.ts`'s
  `loadPipelineDonut`/`loadActivity` already use.
- **`FunnelChart`** (`src/components/dashboard/funnel-chart.tsx`) —
  wired into `/dashboard`. A `null`-valued stage (REPEAT) is never
  plotted as a zero bar; it's listed separately with the reason,
  keeping §2's "never fabricate" rule visually honest, not just
  numerically.
- **`CampaignAnalytics`** (`src/components/campaigns/campaign-analytics.tsx`)
  — wired into `/campaigns/[id]`.
- **`ProductAnalytics`** (`src/components/products/product-analytics.tsx`)
  — wired into `/products/[id]`. Deliberately shows no product-level
  lead count (see the CHANGELOG 0.16.0 entry for why).
- **Contact detail view's "Engagement" tab** — §13's lightweight
  Customer profile, reusing the `deals` array `fetchDeals` already
  loads for the Leads/Conversions tiles instead of a redundant query.
- **`/reports`** (new nav entry, §7) — campaign and product
  performance comparison tables across the whole account.

### Known gaps / deferred

- **REPEAT is permanently `null`** — no order/purchase-history table
  exists in this schema to detect a second conversion by the same
  customer. Not a "seed data" gap like Phase 6's; building the
  underlying tracking is out of scope here and would need its own
  design pass (e.g. does a second Trial for the same contact count?
  A second Lead? Neither is quite "repeat purchase").
  Product-level lead counts are also permanently omitted (not
  deferred) — see the CHANGELOG 0.16.0 entry.
- Trials-per-campaign and trials-per-product both rely on the
  `deal_id`/`customer_request_id` link a Trial is created with (Phase
  6). A Trial created without either link (a walk-in trial with no
  prior CustomerRequest or Lead) is invisible to campaign attribution
  by design — it never touched that campaign, so it shouldn't count.
- No BA-level analytics yet (e.g. "conversion rate by BA") — §12's BA
  dashboard is still the "My queue only" filter from Phase 6, not a
  performance breakdown. Tracked as a follow-up alongside Phase 6's
  deferred Feedback entity.

### Testing

9 new tests in `src/lib/dashboard/rimula-analytics.test.ts` (a
generic fake Supabase query builder honoring `.eq`/`.in`/`.or`/count-
head queries, since the aggregation logic — not the wiring — is what
can silently produce a wrong number): every funnel stage on real rows
plus the fully-empty-account case, campaign scoping (including the
trial-via-deal-or-customer_request join and the no-cost-data null
cascade), and product scoping (interaction-type breakdown, trial/
conversion counts). No route/component tests this phase — every new
surface is a read-only client-side aggregation view with no
mutation/authorization logic to verify beyond what `loadX` already
covers.

Full §21 suite green: typecheck, lint (0 errors, unchanged 37
pre-existing warnings), test (995/995), build. `format:check` reports
the same pre-existing baseline as before this phase (four already-
failing files touched, zero newly introduced — see the CHANGELOG
0.16.0 entry for the exact list and how each was verified).

## Phase 8 — Meta hardening → catalogue sync → TTS/AI/translation providers

**Final phase, reduced scope by product decision** (stated at the
start of this phase, not discovered mid-build): drop TTS and
AI-assisted translation entirely rather than architect-and-stub them.

### Dropped: TTS and AI-assisted translation

**Decision: not built, not stubbed, no `TextToSpeechService` or a
second `TranslationService` implementation.** Rationale:

- §6 already names the P0 path as manual: "Localization (manual — bilingual
  BAs write translations directly, no AI required)." That path is real,
  complete, and shipped in Phase 3 (`ContentTranslation` rows, the
  localization panel, RTL handling for ur/ps/pa).
- §10 already names BA-recorded audio as the P0 voice-note path, and
  TTS as explicitly P1: "`TextToSpeechService` and synthesized audio
  are P1." That P0 path is also real, complete, and shipped in Phase 3
  (`voice_notes` table, `voice-note-recorder.tsx`, wired into Content
  Studio) — see the VoiceNote decision below.
- Unlike WhatsApp catalogue sync (a real Meta product this account
  simply lacks credentials for — worth architecting now so real
  credentials drop in later), TTS and AI-translation are a **choice of
  provider**, not a capability gap: any implementation would mean
  picking and integrating a specific AI/speech vendor. Building a
  provider abstraction with no real provider behind it and no decided
  vendor to target would be speculative work against a requirement
  the product has explicitly deprioritized — the "don't design for
  hypothetical future requirements" principle this build has followed
  throughout every other phase.
- `TranslationService` still exists exactly as Phase 3 left it: the
  abstraction point named in §10, currently satisfied by the
  manual-entry path (a BA typing into `ContentTranslation` fields
  *is* the interface's only implementation — there was never a
  separate no-op class to keep or remove). No new code needed here;
  this section exists to record the decision, per §24's requirement
  that a P1 item be "implemented or clearly marked
  architected-but-not-wired," not silently dropped.
- **If this decision is reversed later:** pick a translation vendor
  and a TTS vendor first (a product/vendor decision, not an
  engineering one), then add a second `TranslationService`
  implementation and a first `TextToSpeechService` implementation
  behind the existing manual/no-op default — same chokepoint pattern
  as `resolveWhatsAppService`. No rearchitecting needed; the interface
  seam already exists.

### VoiceNote — decided: keep, already correctly built

Investigated before assuming this needed work: `voice_notes`
(migration 046) already has `source TEXT CHECK (source IN ('recorded',
'tts'))`, `recorded_by`, and `storage_path` in the `chat-media` bucket
— schema shaped for exactly the P0 BA-recording path from day one.
Phase 3 already built the full stack on top of it: `POST/GET/DELETE
/api/content/[id]/voice-notes`, `voice-note-recorder.tsx` (reuses the
inbox's `opus-recorder`/`MediaRecorder` capture path per §10), wired
into the Content Studio localization panel. Every write hardcodes
`source: 'recorded'` — confirmed zero TTS references anywhere in the
recorder component or its API route.

**Decision: keep as-is, no changes.** This is not a half-built entity
— it's a complete, working P0 feature that happens to sit on a schema
column (`source`) wide enough to someday carry a `'tts'` value it will
never receive now that TTS is dropped. Narrowing the CHECK constraint
to `'recorded'`-only was considered and rejected: it would be a
schema change purely for documentation purposes (removing a value
nothing writes is not a safety improvement), and this codebase's own
convention elsewhere (e.g. `engagement_events.event_type` carrying
`LEAD`/`TRIAL`/`CONVERSION` values unused for two full phases before
Phase 6 wired them) is to let a CHECK constraint describe the full
intended domain rather than only what's currently wired.

### Reused as-is

- `MetaWhatsAppService` / `DemoWhatsAppService` (`src/lib/whatsapp/service.ts`)
  — the provider-abstraction pattern this phase's catalogue-sync
  design mirrors exactly.
- `whatsapp_sync_log` (migration 048) — schema already existed from
  Phase 1 with the exact §11 field set; this phase is what finally
  reads and writes it.
- The cron-drain / `AUTOMATION_CRON_SECRET` pattern, `chat-media`
  bucket convention, `is_account_member` RLS helper — no changes.
- `voice_notes` + its full Phase 3 application stack (see above).

### Extended

- **`src/lib/whatsapp/meta-api.ts`** — every message-send function
  (`sendTextMessage`, `sendMediaMessage`, `sendTemplateMessage`,
  `sendReactionMessage`, `sendInteractiveButtons`, `sendInteractiveList`)
  plus the inbound-media-mirror path (`getMediaUrl`, `downloadMedia`)
  and `verifyPhoneNumber` now route through a new `metaFetch` helper:
  exponential-backoff retry on 429/5xx and on `fetch()`-level network
  failures (honoring Meta's `Retry-After` header), a classified
  `MetaApiError` (httpStatus/code/type/isRetryable) on terminal
  failure instead of a bare `Error(message)`, and no retry at all on a
  non-retryable 4xx (would just burn the rate-limit budget on a
  request that can't succeed). The lower-frequency account-setup and
  template-lifecycle calls (`registerPhoneNumber`, `subscribeWabaToApp`,
  `submitMessageTemplate`, etc.) were deliberately left on the
  original `throwMetaError` path — lower risk/reward for this pass,
  not a gap.
- **`handleStatusUpdate`** (`src/lib/whatsapp/inbound-events.ts`) —
  Meta's `statuses[].errors[]` detail (previously discarded entirely)
  now persists onto `broadcast_recipients.error_message` and is always
  logged server-side, so a failed broadcast recipient is diagnosable
  instead of just labeled "failed" (§16: "handle explicitly, never
  silently").
- **`verifyPhoneNumber`** — now also requests `messaging_limit_tier`
  (§8). No new column, no migration: the Settings page already called
  this live on every load/test/save, so the tier is simply one more
  field read off the same live response and held in component state,
  never persisted or assumed stale-safe. Renders "Unknown" (not a
  guessed number) when Meta doesn't return it.

### Net-new

- **`src/lib/products/catalogue-service.ts`** — `ProductCatalogueService`
  interface, `StubProductCatalogueService` (the only implementation —
  every call throws `CatalogueNotConfiguredError`, never a fake
  success), `resolveProductCatalogueService()` as the single
  chokepoint a future `MetaProductCatalogueService` would branch from.
  The real Meta endpoint shape (`POST /{catalog_id}/items_batch`) is
  documented in the file's header — architected, not implemented
  against real network code, because it cannot be verified without a
  live Commerce Manager catalog this account doesn't have (§2: never
  ship unverifiable integration code presented as working).
- **`POST/GET /api/products/[id]/catalogue-sync`** — every sync
  attempt writes a real `whatsapp_sync_log` row (it's a log, not a
  single-status record — no `UNIQUE(product_id)` exists, confirmed
  against migration 048 before assuming an upsert was safe). A
  not-configured failure is recorded as `Sync Error` with the real
  message, returned as `200` with a `warning` field (the route itself
  didn't fail; the sync attempt's outcome is the error).
- **`CatalogueSyncCard`** (`src/components/products/catalogue-sync-card.tsx`)
  — wired into `/products/[id]`: status badge, last-synced time,
  error message, admin-only "Sync now."
- **`docs/WHATSAPP_FEASIBILITY.md`** — did not exist before this
  phase despite being required since §4 Step 1 of the original spec.
  Written now, verified against Meta's own developer documentation
  (not memory) via live fetch — see the doc itself for sourcing notes
  and why several third-party "Communities/Channels API" claims were
  rejected as unofficial-integration marketing rather than real Cloud
  API surface.

### Known gaps / deferred

- **Messaging-tier headroom is surfaced in Settings only, not on the
  Announcements/Broadcasts page, and there is no automatic
  queue-or-stagger enforcement** when a broadcast would exceed the
  tier ceiling. §8 asks for both. What's built: the real tier,
  fetched live, displayed with an honest "Unknown" fallback — the
  part of §8 this phase's own brief called out explicitly ("surface
  messaging-tier headroom... display Unknown rather than assuming a
  number"). What's not built: a rolling-24h "messages sent" counter
  computed from `broadcast_recipients` compared against the tier
  ceiling, displayed on the Announcements page, and dispatch-side
  throttling that defers a send rather than letting it fail mid-flight.
  This is a real, scoped follow-up (the data to compute "used" already
  exists in `broadcast_recipients.sent_at`), not a "some day" gap —
  flagged here rather than silently left off the DoD-relevant surface.
- **WhatsApp catalogue sync has no real Meta implementation** — by
  design, per this phase's brief. `MetaProductCatalogueService` is
  fully specified (endpoint, payload shape, required scope, one
  catalog per WABA) but not written, because it can't be tested
  against a real Commerce Manager catalog this account doesn't have.
  Also unresolved even for a future real implementation: `products`
  has no price/currency field (§9.1), and WhatsApp catalogue items
  require one — that's a data-model decision, not just a credential,
  for whoever picks this up.
- **`getSubscribedApps`, `editMessageTemplate`, `deleteMessageTemplate`,
  `uploadResumableMedia`** and the rest of the account-setup/template-
  lifecycle calls still use the original `throwMetaError` (no retry).
  Deliberate scope boundary for this pass (see "Extended" above), not
  an oversight — flagged so a future hardening pass knows exactly
  what's left rather than re-auditing the whole file.

### Testing

16 new tests:

- `src/lib/whatsapp/meta-api.retry.test.ts` (8) — first-try success
  makes exactly one `fetch` call; a 429 retries and succeeds; a 500
  retries `META_MAX_RETRIES` times then throws a classified retryable
  `MetaApiError`; Meta's `Retry-After` header is honored over the
  default backoff delay (verified with fake timers down to the
  second); a non-retryable 400 fails immediately with exactly one
  `fetch` call; a network-level `fetch()` rejection retries the same
  as a 5xx; the same retry/classification path applies to
  `getMediaUrl`, not just message sends.
- `src/lib/whatsapp/inbound-events.test.ts` (+2) — a `failed` status
  with Meta's `errors[]` persists a formatted `error_message` onto
  `broadcast_recipients`; a `failed` status with no `errors` array
  leaves `error_message` unset (not an empty string or "unknown").
- `src/lib/products/catalogue-service.test.ts` (2) — the resolver
  always returns the stub; the stub's `syncProduct`/`deleteProduct`
  both throw `CatalogueNotConfiguredError`, never a fake success.
- `src/app/api/products/[id]/catalogue-sync/route.test.ts` (4) —
  admin-only (GET and POST), 404 on a missing product, a
  not-configured sync records `Sync Error` and returns 200 with a
  `warning` (not a 500 — the route did its job), a successful sync
  records `Synced` with the returned catalogue id.

Full §21 suite green: typecheck, lint, format:check, test, build —
see the CHANGELOG 0.17.0 entry for exact counts and the format:check
baseline reconciliation.
