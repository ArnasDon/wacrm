# RIMULA COMMUNITY GROWTH PLATFORM — MASTER BUILD PROMPT (v3, wacrm fork)

你是本项目的 Senior Full-Stack Engineer + Product Architect + UX Designer + Automation Engineer + Technical Lead。
任务不是写方案，是直接在当前 workspace 中 **BUILD** this application — real code, real migrations, real tests, real docs. Not mockups, not a plan-only response.

## 0. LANGUAGE RULE

All artifacts you produce — UI text, labels, DB column names, API responses, docs, error messages, seed/demo data, user-facing code comments, and your final response — must be in **English**. Do not translate technical identifiers (API names, table names, service names, status enums, file paths).

## 1. MISSION

Build a working internal Rimula Community Growth Platform covering this funnel:

`CONTENT → LOCALIZATION → APPROVAL → DISTRIBUTION → ENGAGEMENT → CUSTOMER REQUEST → LEAD → BA ASSIGNMENT → TRIAL → CONVERSION → ANALYTICS`

Scope: community members, WhatsApp announcements, content creation, localization, voice notes, scheduling, products, customer requests, leads, BA routing, trials, feedback, campaigns, engagement, conversion analytics. This is **not** a general CRM/ERP — stay scoped to Rimula community + commercial conversion.

**Foundation — this is a fork, not a greenfield build.** The workspace is a fork of [`ArnasDon/wacrm`](https://github.com/ArnasDon/wacrm) v0.8.1 (MIT — keep `LICENSE`; rebrand the wacrm name/favicon/`wacrm.tech` URLs per its CONTRIBUTING guidance). It already ships: shared WhatsApp inbox on the Meta Cloud API, contacts with tags/custom fields/CSV import/dedup, pipelines + deals (Kanban), template broadcasts with delivery/read counters, an automations engine, a branching Flows engine, a BYO-key AI assistant with a pgvector knowledge base, multi-user accounts with RBAC, a public REST API, and an MCP server. Do not scaffold a new app, do not change the stack, do not rebuild what exists. §9.0 maps the existing schema onto Rimula's entities.

## 2. NON-NEGOTIABLE RULES

**Build, don't describe.** Create/modify real files, install real dependencies, run the app, run tests, fix failures. Do not stop after scaffolding or produce an architecture doc in place of code.

**Read `AGENTS.md` first, and obey it.** The repo ships an agent rule: *"This is NOT the Next.js you know — this version has breaking changes; read the relevant guide in `node_modules/next/dist/docs/` before writing any code."* Next.js 16.2.12 + React 19.2.4 + TypeScript 6 differ from your priors. Consult those bundled docs before writing routes, server actions, caching, or params handling. Do not pattern-match from older Next.js.

**Data integrity (canonical rule, applies everywhere below).** Never invent facts: product claims, specs, vehicle compatibility, customer data, WhatsApp/API capabilities, analytics, business results. If data isn't available, render/return `Unavailable` / `Unknown` — never a plausible-sounding guess. Any later section that says "never fabricate X" is this rule applied locally.

**Provider abstraction (canonical pattern).** For each of `WhatsAppService`, `TranslationService`, `TextToSpeechService`, `AIContentService`, `ProductCatalogueService`, `NotificationService`, `LeadRoutingService`, `AnalyticsService`: define one interface, keep business logic coupled to the interface only. Never let a route import a provider SDK directly. Note the repo already does this for AI (OpenAI + Anthropic behind one interface) — follow that existing pattern rather than inventing a second one.

**Security.** No secrets in frontend code (`NEXT_PUBLIC_*` is inlined into the client bundle at build time — never put a secret there). Secrets are read at runtime from env. Reuse the existing AES-256-GCM encryption helper (`src/lib/.../encryption.ts`, keyed by `ENCRYPTION_KEY`) for any new provider key you store, exactly as `whatsapp_config` and `ai_configs` already do. Every endpoint enforces server-side authorization via the existing account/role model (§14).

## 3. WHATSAPP POLICY

Official Meta WhatsApp Business Platform / Cloud API only — which is what the foundation already uses. Never: WhatsApp Web automation, Selenium/Puppeteer against WhatsApp, QR bots, unofficial APIs, scraping, session hijacking.

Before building any Meta-backed feature, verify current official capabilities (don't assume from memory) and write `/docs/WHATSAPP_FEASIBILITY.md` classifying each as `SUPPORTED / PARTIALLY SUPPORTED / NOT SUPPORTED / REQUIRES CONFIGURATION`. Cover: messages, templates, images/video/audio/voice notes, interactive buttons + lists, product messages, catalogue, groups, communities, channels, reactions, read receipts, delivery status, incoming messages, webhooks, opt-ins, scheduling, analytics. If Meta doesn't support something: document the limitation, build the abstraction anyway, wire it to the best supported alternative. Do not fake it.

**Demo Mode gap — fix this early (Phase 1–2).** The foundation calls Meta directly and has no simulation layer: `/api/whatsapp/send`, the webhook at `/api/whatsapp/webhook`, the broadcast sender, the automations engine, and the Flows runner all reach the Cloud API. The whole app must run with **zero Meta credentials** via `DemoWhatsAppService` (simulated send, delivery, read, reaction, inbound) implementing the same `WhatsAppService` interface as `MetaWhatsAppService`. Refactor every one of those call sites behind that interface **before** building ScheduledPost/EngagementEvent/analytics on top — everything downstream, including the §20 demo funnel, depends on it. Never let demo-only logic leak into the production implementation or vice versa. Keep the existing HMAC-SHA256 webhook signature verification and rate limits intact on the Meta path.

## 4. FOUNDATION REPOSITORY & STARTING POINT

**Step 1 — get it running unmodified.** `npm install`, `cp .env.local.example .env.local`, configure a Supabase project, apply **all** existing migrations in `supabase/migrations/` in order (001 → 036), `npm run dev`. Confirm inbox, contacts, pipelines, broadcasts, and auth actually work before changing anything. This is your regression baseline.

**Step 2 — read the real schema; the §9.0 map is verified at table level, not column level.** Read every file in `supabase/migrations/`, all of `src/lib/`, and `CHANGELOG.md` (it documents every migration and why it exists). §9.0's table names come from the changelog and are reliable; exact column names are not — confirm them in the SQL and correct §9.0 before writing a migration against it.

**Step 3 — extend, don't replace.** The stack is fixed and must not be swapped:

| Layer | What's there — use it |
|---|---|
| Framework | Next.js 16.2.12 App Router, React 19.2.4, TypeScript 6 (`strict`), `@/*` → `./src/*` |
| Data | Supabase Postgres + Auth + Storage + RLS via `@supabase/ssr`. **No ORM** — direct queries. Don't add Prisma/Drizzle. |
| UI | Tailwind v4 (PostCSS, no config file), shadcn `base-nova` style on **`@base-ui/react`** (not Radix), `lucide-react` icons, `sonner` toasts. Add components in this idiom. |
| Charts | `recharts` — already a dependency. Don't add a second charting library. |
| i18n | `next-intl` (`src/i18n/request.ts`, `NEXT_PUBLIC_APP_LOCALE`) for **UI chrome only** — see §10. |
| Audio | `opus-recorder` + `MediaRecorder`; CSP already allows `microphone=(self)`. |
| Builders | `@xyflow/react` + `@dagrejs/dagre` (Flows), `@dnd-kit/*` (Kanban) |
| Tests | `vitest` (node env, `src/**/*.test.ts(x)`), dummy `ENCRYPTION_KEY`/`META_APP_SECRET` injected via `vitest.config.ts` |

Follow the existing layout (`src/app`, `src/components`, `src/lib`, `src/i18n`, `supabase/migrations`) and existing conventions rather than introducing a parallel pattern.

**Step 4 — migrations.** New migrations start at **`040_`** and continue sequentially — the repo's highest existing file is `039_inbound_media_mirror.sql`, not `036` as originally assumed here. (Note: migrations `037`–`039` exist in `supabase/migrations/` but have no corresponding `CHANGELOG.md` entry yet — `CHANGELOG.md`'s newest entry only documents through `036`. Reconcile that gap, don't just continue past it.) Match the existing house style: idempotent (safe to re-run), RLS policies on every new table using the existing helper (§14), `account_id NOT NULL` on every account-scoped table, indexes on hot lookup paths, and a `CHANGELOG.md` entry with a **Migration required** note naming the file — that's how self-hosters (and you, later) know what to apply.

**Step 5 — preserve the agent rules file.** `CLAUDE.md` currently contains only `@AGENTS.md`. Do **not** overwrite it. Add the Rimula build spec as a separate file and reference it with an additional import line, so the Next.js 16 warning in `AGENTS.md` keeps loading every session.

**Step 6 — write `/docs/IMPLEMENTATION_PLAN.md`** covering what's reused as-is, what's extended (with real column names once confirmed), what's net-new, phases, and testing strategy — then start building immediately. Don't wait for sign-off unless something is a genuine, irreversible blocker.

## 5. ARCHITECTURE

Modular monolith — already true, keep it that way. `src/app` + `src/components` → `src/app/api` routes → Supabase (Postgres + RLS), with external services behind the §2 abstractions, implemented in `src/lib`. No microservices, Kubernetes, event buses, ORM, or GraphQL layer. Match the repo's stated "no ORM, no GraphQL, no dedicated backend" posture.

## 6. SCOPE PRIORITY

App shell, auth, RBAC, database, contacts, broadcasts, pipelines, the shared inbox, and the AI assistant **already exist**. "Must work end-to-end" below means end-to-end for Rimula's flows — verify and extend what's there, and spend the saved effort on the genuinely net-new pieces (Products, Vehicles, BA fields, Trials, the demo WhatsApp layer, the commercial funnel, analytics).

**P0 (must work end-to-end):** app shell, auth/authz, database, Members, BAs, Products, Content Studio, Localization (manual — bilingual BAs write translations directly, no AI required), Approval workflow, Demo WhatsApp publishing, Customer Requests, Leads, BA routing, Trials, Conversions, Analytics, Dashboard.

**P1 (architect + implement where feasible):** Meta WhatsApp integration hardening + webhooks, WhatsApp product catalogue, automated vehicle-compatibility matching + auto BA handoff, TTS, AI-assisted translation drafting, media storage.

**P2 (nice to have):** advanced campaign analytics/reporting, extra routing strategies, further automation.

Never trade P0 depth for P1/P2 breadth. The single most important thing to prove working is the full funnel: `CONTENT → TRANSLATE → APPROVE → DEMO PUBLISH → CUSTOMER REQUEST → LEAD → BA → TRIAL → CONVERSION → ANALYTICS`.

## 7. NAVIGATION & VISUAL DIRECTION

Target nav: Dashboard, Members, Announcements, Content, Campaigns, Products, Leads, Engagement, Reports, Settings. Map onto the existing sidebar — rename/repurpose existing entries (Inbox, Contacts, Pipelines, Broadcasts, Flows, AI Agents) rather than building a second navigation system beside them.

Feel: polished enterprise marketing-ops platform in Shell/Rimula colours (Shell Red, Rimula Gold, off-white, deep slate, charcoal). The repo already has a **5-theme system** — CSS variables scoped under `html[data-theme="..."]`, applied via `dataset.theme`, persisted to `localStorage`, with an inline boot script in `layout.tsx` preventing flash-of-default, and every colour tokenized to `primary` rather than hardcoded. Add a Rimula theme to that system and make it the default. Do **not** hardcode hex values across components or reintroduce literal colour classes — that undoes migration-era work (`#133`). Don't copy Shell's actual website.

## 8. COMMUNITY MODEL

One MVP destination, "Rimula Announcements," modeled as a generic `CommunityGroup` so more destinations can be added later. Audience roles: Mechanics, Truck Drivers, Truck Owners, BAs, Other. Model is brand → audience broadcast, not open group chat. Only implement interaction methods Meta officially supports.

## 9. DATA MODEL

### 9.0 Map onto the existing schema first

Table names below are confirmed from `CHANGELOG.md`; **column names still need verifying against the SQL** (§4 Step 2). Never create a table that already exists under another name.

> **Verified against real SQL/code (§4 Step 2, all 39 migrations + `src/lib/`).** The table below has been corrected accordingly — see inline notes. Two systemic corrections that apply everywhere: (1) every domain table also still carries a legacy `user_id` column (pre-multi-tenancy) that is **no longer used for isolation** — only `account_id` is, per §14; don't confuse the two. (2) `profiles.role` (plain `TEXT`, legacy, unused) is a **different column** from `profiles.account_role` (`account_role_enum`, the real tenancy/permission field `is_account_member()` checks) — extend the BA-facing profile via `account_role`-adjacent new columns, never touch `role`.

| Exists today | Rimula concept | Action |
|---|---|---|
| `accounts`, `profiles`, `account_invitations`, `account_role_enum` (confirmed exact values: `owner`/`admin`/`agent`/`viewer`) | Tenancy + Admin/BA identity | Reuse wholesale. Extend the BA-facing profile with region, market, capacity, openLeads, `languages` — **confirmed these do not exist under any name**; all net-new columns. Do **not** build a parallel user system, and do not add them to the legacy `profiles.role` column (see note above). |
| `contacts` — has `phone_normalized` (generated), `UNIQUE (account_id, phone_normalized)`, tags, custom fields, CSV import, avatar | `Member` | Extend: role, region, market, vehicle, vehicleType, optInStatus, whatsappStatus, communityStatus, joinedDate, lastEngagement. The dedup/import machinery is done — reuse it, don't reimplement §9's CSV requirement. |
| `conversations` — `UNIQUE (account_id, contact_id)`, status, assignment, notes, `ai_handoff_summary` | WhatsApp thread per member | Reuse as-is. **One conversation per contact is enforced at the DB level** — don't design anything assuming multiple threads per member. Note: that uniqueness only landed in migration `036`, not from day one. |
| `messages` — direction, status, `content_type` CHECK, `interactive_reply_id`, `reply_to_message_id`, `ai_generated`; plus `message_reactions` | `WhatsAppMessage` | Reuse. Widen the `content_type` CHECK if you add a type (that's the established pattern, cf. `010_flows.sql`). Confirmed current values: `text, image, document, audio, video, location, template, interactive`. Reactions live in `message_reactions`, **not** as fake text messages. |
| `broadcasts` — recipients, accepted/rejected, delivered_count, read_count, per-recipient variables | `ScheduledPost` / Announcements | Extend: language, campaignId, contentId, approval status, scheduled time. Its counters already supply most of the §10 Announcements dashboard. Creation is atomic via RPC `create_broadcast_with_recipients(...)` (8-arg signature as of `038`, includes `p_template_params JSONB[]`) — call that RPC rather than inserting `broadcasts`/`broadcast_recipients` directly. |
| **`message_templates`** — Meta-approved, synced | Approved WhatsApp templates | **Correction: the real table name is `message_templates`, not `templates`.** Reuse. Content Studio "Approved" should produce/reference one before a broadcast can send. `status` is Meta's raw enum (`DRAFT, PENDING, APPROVED, REJECTED, PAUSED, DISABLED, IN_APPEAL, PENDING_DELETION`), not a simplified four-value set. |
| `pipelines`, `deals` (+ `accounts.default_currency`) | `Lead` (+ conversion value) | Extend `deals` into Lead: status enum, source, campaign, originalContent, market, region, assignedBA, nextFollowUp, lastContacted, outcome. Reuse the Kanban UI and currency handling. **Correction: `deals.status` today is only `CHECK (status IN ('open','won','lost'))`** — getting to Lead's 8-value status enum (`NEW, ASSIGNED, CONTACTED, INTERESTED, TRIAL_REQUESTED, TRIAL_COMPLETED, CONVERTED, LOST`) means dropping and recreating that constraint (same pattern as migrations `002`/`014`/`016`), not just adding values. `assigned_to` (FK→`profiles`) already exists and maps directly to `assignedBA`. `source`/`campaign`/`originalContent`/`market`/`region`/`nextFollowUp`/`lastContacted`/`outcome` are **all genuinely net-new columns** — none exist under another name. |
| `automations`, `automation_logs`, `automation_pending_executions` + `flows`, `flow_nodes`, `flow_runs`, `flow_run_events` | BA routing triggers, follow-ups, keyword→CustomerRequest | Reuse both engines. **Do not build a third rules engine.** Flows is already idempotent on Meta's `message_id` and enforces one active run per contact. |
| `ai_configs`, `ai_knowledge_documents`, `ai_knowledge_chunks` (pgvector), `ai_usage_log` | `AIContentService` + AI product Q&A (§11) | Reuse. Point the knowledge base at approved Product data. The existing "hand off to a human when the KB doesn't cover it" behaviour is exactly §11's requirement — keep it. The retrieval RPCs (`match_ai_knowledge_fts`/`_semantic`) are `SECURITY INVOKER` as of migration `032` (a cross-tenant-read security fix) — any new retrieval RPC on the same pattern must gate the same way, not just filter by a passed `account_id`. |
| `whatsapp_config` — `UNIQUE(account_id)`, `UNIQUE(phone_number_id)`, AES-256-GCM token | Meta credentials | Reuse unchanged. Also carries `mirror_inbound_media` (bool, migration `039`) — relevant if Rimula content ever includes inbound customer media. |
| `api_keys` (scoped, hashed), `webhook_endpoints` (HMAC-signed, auto-disable on repeated failure) | Public API + outbound events | Reuse; add scopes for new resources rather than a second key system. |
| Storage buckets `avatars`, `flow-media`, **`chat-media`** (path `account-<account_id>/...`) | Content media, voice notes | **Correction: a third bucket exists — `chat-media`** (migration `023`, MIME list widened `039`), 16MB cap, account-scoped path, and its MIME allow-list already covers voice-note audio types (`audio/ogg`, `audio/aac`, `audio/mp4`, `audio/amr`, `audio/opus`) — likely the better fit for Rimula voice notes than `flow-media`. Reuse the bucket + RLS convention for new media rather than inventing a new path scheme. |
| **`quick_replies`** — account-scoped reusable snippets, text or interactive (migration `035`) | Reusable BA response snippets | **Not previously listed in this map — already exists.** `account_id`-scoped, any member reads, agent+ writes. Consider reusing this for Content Studio canned responses / standard customer-request replies before building a parallel snippets system. |
| — nothing yet | `Product`, `ProductCategory`, `ProductImage`, `ProductApplication`, `ProductClaim`, `Vehicle`, `ProductVehicle`, `Trial`, `CustomerRequest`, `Campaign`, `EngagementEvent`, `ProductInteraction`, `Content`, `ContentTranslation`, `VoiceNote`, `CommunityGroup`, `WhatsAppSyncLog` | Net-new. FK into `contacts`/`conversations`/`accounts`; never invent a parallel customer identity. |

### 9.1 Field sets for net-new / extended entities

| Entity | Fields |
|---|---|
| `Member` (extends `contacts`) | role (Mechanic/Truck Driver/Truck Owner/BA/Other), region, market, vehicle, vehicleType, optInStatus, whatsappStatus, communityStatus, joinedDate, lastEngagement |
| BA (extends profile) | region, market, status, openLeads, capacity, languages (Urdu/Pashto/Punjabi — drives manual-localization routing) |
| `Product` | productName, productCode, category, description, shortDescription, longDescription, keyFeatures, benefits, vehicleTypes, recommendedVehicles, engineTypes, applications, packaging, approvedClaims, status |
| `CustomerRequest` | type (`PRODUCT_INFORMATION, PRODUCT_SUITABILITY, TRIAL_REQUEST, BA_CALL_REQUEST, PRODUCT_QUESTION, FEEDBACK, PURCHASE_REQUEST, CONVERSION_REQUEST, GENERAL_ENQUIRY`), source, member, product, status |
| `Lead` (extends `deals`) | status (`NEW, ASSIGNED, CONTACTED, INTERESTED, TRIAL_REQUESTED, TRIAL_COMPLETED, CONVERTED, LOST`), customer, product, campaign, source, originalContent, market, region, assignedBA, nextFollowUp, lastContacted, notes, outcome |
| `Trial` | name, phone, role, market, vehicle, product, notes, status (`NEW → REQUESTED → ASSIGNED → SCHEDULED → COMPLETED → CONVERTED / CANCELLED`) |
| `Campaign` | campaignName, product, startDate, endDate, objective, content, audience, status, cost |
| `EngagementEvent` | memberId, postId, campaignId, eventType (`DELIVERED, READ, REACTION, REPLY, CLICK, LEAD, TRIAL, CONVERSION`), eventValue, timestamp, source, metadata |
| `Content` / `ContentTranslation` | status (`Draft, In Review, Approved, Scheduled, Published, Failed, Archived`); translation rows keyed by language |

Every new table: `account_id NOT NULL`, RLS via `is_account_member(...)`, FKs, indexes, enums, created/updated timestamps, sane cascades.

## 10. CONTENT PIPELINE

`CREATE → UPLOAD MEDIA → WRITE ORIGINAL COPY → SELECT LANGUAGES → ENTER LOCALIZATION → RECORD/GENERATE VOICE → REVIEW → APPROVE → SCHEDULE/PUBLISH`

Content types: posters, images, videos, text posts, voice notes, product posts, campaign posts. No AI-generated content auto-publishes unless explicitly enabled in Settings.

**Localization — two different things, don't conflate them.** `next-intl` in the repo localizes **UI chrome** (labels, buttons) via `NEXT_PUBLIC_APP_LOCALE`. Rimula's requirement is **content data** localization: Urdu, Pashto, Punjabi, Roman Urdu stored as `ContentTranslation` rows. These are separate systems; build the latter as data, don't try to force it through `next-intl`.

P0 path is manual — a bilingual BA (matched by their `languages` field) writes each language's translation into its own editable field; never overwrite the source copy. No AI translation is required to ship. `TranslationService` stays as the abstraction point but can be a manual-entry/no-op implementation for P0; wire a real provider behind it later (P1) as an optional "AI draft" a BA edits and approves — never an auto-publish path. Note RTL: Urdu and Pashto are right-to-left, and `components.json` currently has `"rtl": false` — translation editors and any rendered preview need `dir="rtl"` handling even though the admin UI stays LTR.

**Voice notes:** recording already exists — the inbox composer records via `opus-recorder`/`MediaRecorder`, and CSP already permits `microphone=(self)`. Reuse that capture path for BA-recorded voice notes in Urdu/Pashto/Punjabi, which is the P0 path (a bilingual BA records directly, mirroring manual localization). `TextToSpeechService` and synthesized audio are P1. Workflow: `SCRIPT → TRANSLATE → RECORD (P0) or TTS (P1) → PREVIEW → APPROVE → PUBLISH`. Store audio in a Supabase bucket following the `account-<account_id>/...` convention.

**Scheduling:** `ScheduledPost` extends `broadcasts`. A cron-drain pattern already exists — the automations Wait-step drain and `GET /api/flows/cron` guarded by `AUTOMATION_CRON_SECRET` with a `crypto.timingSafeEqual` constant-time compare. Follow that exact pattern for the post scheduler; don't invent a new scheduling mechanism or a new secret convention. The scheduler must be idempotent — a post must never send twice (mirror the atomic `SECURITY DEFINER` counter-increment RPC the flows/automations engines use to avoid lost updates under concurrent runs). Demo mode simulates sending; production uses the real Cloud API.

**Announcements dashboard:** per-post destination, content, language, date, status, reach, reads, reactions, engagement, with a "View Analytics" drill-down. `broadcasts.delivered_count` / `read_count` and `message_reactions` already supply most of this.

## 11. PRODUCTS & COMPATIBILITY

`Product`, `ProductCategory`, `ProductImage`, `ProductApplication`, `ProductClaim`; product page shows info, images, features, applications, compatibility, approved claims, campaigns, analytics, WhatsApp sync. Only administrator-approved data may be shown as fact (§2).

`Vehicle` + `ProductVehicle` model verified `Vehicle Type/Manufacturer/Model/Engine/Application → Verified Product` relationships. AI must never invent a compatibility match.

For P0 keep this to data entry and display: admins enter verified compatibility, product pages show it, and a compatibility question with no verified match becomes an ordinary `CustomerRequest` routed to a BA like any other enquiry (§12) — no automated matching engine. Automated "no match → auto-handoff" and WhatsApp catalogue sync are P1; build the schema now, wire the automation later.

**WhatsApp catalogue (`ProductCatalogueService`, P1):** implement only methods current official Meta docs confirm. Track `whatsappCatalogueId`, `syncStatus`, `lastSynced`, `syncError` in `WhatsAppSyncLog`; statuses `Draft, Pending Review, Published, Synced, Sync Error, Archived`.

**AI product Q&A:** reuse the existing assistant + knowledge base (§9.0). Ground it in approved product info, approved claims, verified compatibility, approved FAQs only. Missing/uncertain → hand off to a human via the existing handoff mechanism (routes to a configured agent or the unassigned queue and leaves an internal summary note). Respect the existing per-conversation cap and account-wide rate limit; log spend to `ai_usage_log`.

**Content generation from a product page (P1):** options for language, audience, content type (introduction, educational, trial offer, technical tip, announcement, voice note), tone, length — using only approved product data, with mandatory review unless auto-publish is explicitly enabled.

## 12. REQUESTS → LEADS → BA → TRIAL → CONVERSION

`CustomerRequest` can originate from demo WhatsApp, real WhatsApp, product pages, campaigns, manual entry, or Flows (a `collect_input`/`condition` branch is a natural capture point — reuse it).

**Routing (`LeadRoutingService`):** Market BA → Regional BA → Unassigned, with configurable strategy (round robin, lowest open-lead-count, manual). Record *why* a BA was chosen. Reuse the existing assignment + notification path that AI handoff and conversation assignment already use.

**BA dashboard:** My New Leads / My Product Questions / My Trial Requests / My Follow-ups / My Conversions, scoped to that BA's records.

**Admin dashboard:** all BAs, all markets, all leads, open leads, overdue leads, conversions.

**Feedback:** category (Product, Service, Campaign, Community, BA Experience, Other) + member, market, message, date, status, with admin escalation.

## 13. FUNNEL, ENGAGEMENT, ANALYTICS

Track `ProductInteraction` (viewed/clicked/enquiry/interest/trial request/lead/conversion) linking `PRODUCT → CAMPAIGN → CONTENT → CUSTOMER → LEAD → TRIAL → CONVERSION`.

Dashboard visualizes `REACH → JOIN → ENGAGE → PRODUCT INTEREST → LEAD → BA CONTACT → TRIAL → PURCHASE → REPEAT`, computed from real DB/integration events — never fabricated. If a metric isn't obtainable from the current WhatsApp integration, render `Unavailable through current WhatsApp integration` rather than omitting or faking it. Build on the existing real-time dashboard (response times, daily volume, pipeline value, activity feed) and chart with `recharts`.

Campaign analytics (reach, engagement, leads, trials, conversions, cost, cost/lead, cost/trial, cost/conversion) show cost metrics only when real cost data exists. Use `accounts.default_currency` — don't hardcode a currency.

**Customer profile** (lightweight, not a full CRM): profile (name, role, market, region, vehicle), engagement (posts read, reactions, questions, campaign interactions), commercial (product interests, trial requests, leads, conversions).

## 14. AUTHORIZATION

Tenancy is **per-account, not per-user**: every domain row carries `account_id`, and RLS checks membership via the existing `SECURITY DEFINER` helper `is_account_member(account_id, min_role)`. `user_id` columns exist for assignment/audit only and do **not** enforce isolation. Every new table follows this exact pattern.

Map Rimula roles onto the existing `account_role_enum`:

- **Admin** → `owner` / `admin`: full internal platform access.
- **BA** → `agent`: sees only their own assigned/authorized leads and conversations; may edit `ContentTranslation` rows for languages in their own `languages` field.
- **Read-only stakeholder** → `viewer`.
- **Customer**: not an app user. Customers interact over WhatsApp only and must never see other customers' data, phone numbers, internal BA notes, internal lead status, or internal analytics.

Follow the established UI convention: role-gated actions are **shown but disabled with a tooltip**, not hidden. Never attempt to bypass WhatsApp's own privacy restrictions.

## 15. SETTINGS

Extend the existing Settings area (which already has Members, API keys, Deals, Appearance, and the AI Agents section) rather than creating a second settings surface: WhatsApp API config, Meta webhook config, AI/Translation/TTS providers, BA routing rules, Markets, Regions, Product Categories, Approved Claims, Notifications, **Demo Mode**, Auto-Publishing. Secrets via env / encrypted columns, documented in `.env.local.example`, never client-exposed.

## 16. WEBHOOKS & RELIABILITY

Reuse the existing inbound path: HMAC-SHA256 signature verification → find-or-create contact by normalized phone (SQL-side pre-filter, then `phonesMatch`) → resolve the single conversation → insert message → dispatch to Flows, then automations for anything Flows didn't consume → fan out over Supabase Realtime. Add `EngagementEvent` writes into that pipeline rather than building a parallel ingestion path.

Webhook processing must be idempotent — the Flows runner is already idempotent on Meta's `message_id`; match that. Heed the failure modes this codebase has already hit: never use `.single()` where 0 or ≥2 rows are possible (it errors identically for both and silently drops messages — cf. 0.2.1 and 0.8.1), and enforce uniqueness at the DB level rather than in application code.

Handle explicitly, never silently: API failures, invalid credentials, rate limits (60/min send, 30/min auto-reply), webhook failures, duplicate events, scheduling failures, TTS/translation failures, missing BA, missing product info, DB failures.

Redact PII from event payloads — `flow_run_events` stores reply *length*, not customer text, precisely to avoid persisting sensitive input. Apply the same discipline to any new event table.

## 17. AUDIT LOG

Record: content created/approved/published, product claims changed, lead assigned/status changed, routing config changed, settings changed. Use a real audit table following the `automation_logs` precedent, not just app logs.

## 18. UI/UX BASELINE

Loading, empty, error, and success states everywhere; confirmation dialogs for destructive actions; search, filtering, pagination (the public API's cursor contract `{ data, meta: { next_cursor } }` is the house pattern); responsive layout; reusable components from the existing shadcn/`@base-ui/react` set; accessible forms; clear CTAs; real data tables and `recharts` charts; consistent nav. Don't duplicate screens or introduce a second component idiom.

## 19. SEED DATA

Seed Members, BAs, Markets, Products, Vehicles, verified compatibility, Campaigns, Content, Translations, Scheduled posts, Engagement events, Leads, Trials, Conversions — via a real, re-runnable seed script.

Reference volumes (illustrative seed values, **not** hardcoded business rules — every dashboard number must be computed from seeded rows):

| Segment | Total contacts | WhatsApp confirmed |
|---|---|---|
| Mechanics | 202 | 154 |
| Truck Owners | 255 | 187 |
| Drivers | 387 | 278 |
| **Total** | **844** | **619** (597 reachable/verified) |

20 markets. Seed phone numbers must satisfy the `UNIQUE (account_id, phone_normalized)` index — generate valid distinct E.164 numbers or the seed will fail.

## 20. DEMO MODE END-TO-END

Demo mode must simulate the real workflow, writing into the **same** tables production analytics reads — no parallel fake analytics system:

`Admin publishes campaign → Demo WhatsApp message created → simulated delivery → simulated read/reaction → customer request → lead → BA assignment → trial → conversion → dashboard updates`

## 21. TESTING

Not done because it compiles. Run and fix — don't just report:

```
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run format:check # prettier
npm run test         # vitest run
npm run build        # production build (Next also typechecks here)
```

CI runs typecheck + build on every PR and must stay green. Add `vitest` tests under `src/**/*.test.ts(x)` (node environment). Cover at minimum: member creation, CSV import, content creation, translation entry, approval, scheduling, demo publishing, customer request, lead creation, BA routing, trial, conversion, analytics computation, authorization boundaries, and duplicate-webhook handling. Existing tests must keep passing — they're your regression signal that the WhatsApp refactor in §3 didn't break the inbox.

## 22. DOCUMENTATION

Update the existing `README.md` **in place** — keep its MIT/licence notice; rebrand wacrm→Rimula naming and drop or retarget the upstream Hostinger/`wacrm.tech` marketing sections as appropriate. Add a `CHANGELOG.md` entry for every migration (house convention: a **Migration required** note naming the SQL file). Create/update `/docs/ARCHITECTURE.md`, `/docs/IMPLEMENTATION_PLAN.md`, `/docs/WHATSAPP_FEASIBILITY.md`, `/docs/API.md`, `/docs/DATA_MODEL.md`, `.env.local.example`. `/docs/DATA_MODEL.md` must record which tables were reused as-is, which were extended, and which are net-new (§9.0) — that record is what keeps the fork maintainable and mergeable against upstream. The marketing site (`wacrm-site`) is a separate repo you don't control; keep all Rimula docs here.

## 23. IMPLEMENTATION PHASES & CHECKPOINTS

1. Run the foundation unmodified → read the real schema → correct §9.0 → extend schema (migrations from `040_`) → seed data
2. `WhatsAppService` abstraction + `DemoWhatsAppService` (§3) → Members (extend `contacts`) → BAs (extend profiles) → markets/regions
3. Content → media → localization (manual BA entry) → approval → scheduling
4. Demo WhatsApp end-to-end → messages → engagement events
5. Products → claims → vehicles → compatibility (data entry/display) → campaigns
6. Requests → leads (extend `deals`) → BA routing → trials → conversions
7. Dashboard → analytics → attribution → reports
8. Meta hardening → catalogue sync → TTS/AI/translation providers

**After each phase:** run the full §21 command list, `git commit` with a clear message describing what became functional, then post a short status update (what works end-to-end, what's stubbed, what's next) before continuing. Don't barrel through all 8 phases in one uninterrupted pass — the checkpoints are recovery points, not requests for approval.

## 24. DEFINITION OF DONE

Verify each by re-running the relevant check — don't assert from memory:

- [ ] Fresh clone + `.env.local` + migrations 001→N + seed script produces a working app
- [ ] Full funnel (§6) is exercisable end-to-end in demo mode with **zero Meta credentials**
- [ ] `typecheck`, `lint`, `format:check`, `test`, and `build` all pass; CI green
- [ ] Every workflow test in §21 passes, including duplicate-webhook handling
- [ ] Every new table has `account_id NOT NULL` + RLS via `is_account_member(...)`; authorization is enforced server-side, not just hidden in the UI
- [ ] Dashboard/analytics numbers are traceably computed from seeded rows, not hardcoded
- [ ] Every new migration is idempotent, sequentially numbered from `040_`, and recorded in `CHANGELOG.md`
- [ ] `/docs/WHATSAPP_FEASIBILITY.md` reflects verified current Meta capabilities, not assumptions
- [ ] No secret in any `NEXT_PUBLIC_*` var, client bundle, or committed file; new provider keys use the existing AES-256-GCM helper
- [ ] `AGENTS.md`/`CLAUDE.md` still load; existing upstream tests still pass
- [ ] All docs in §22 exist and match the code as built
- [ ] Every P0 item in §6 works; P1 items are implemented or clearly marked architected-but-not-wired in docs

If any box can't be checked, say so explicitly in the final response rather than declaring completion.
