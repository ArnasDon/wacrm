# Implementation Plan — Mobile-First Real Estate CRM on wacrm

### For execution by an AI coding agent (Claude Code / Gemini CLI)

This file is meant to be dropped into the repo root and fed to the agent one **section** at a time — not all at once. Each section is scoped to be a single agent session's worth of work (roughly one PR).

> **Read `docs/agent/ARCHITECTURE.md`, `docs/agent/SCHEMA_REFERENCE.md`, and `docs/agent/AGENT_GUARDRAILS.md` before starting any section below.** Those three documents were produced by directly inspecting this repo's actual code, and several sections below have been revised to match what they found — most notably: a lot of Section B and C's targets already exist and need extending, not building from scratch. Where this plan and those documents disagree, the documents win; update this plan's text rather than the code.

**One naming decision to make before Section C or I:** the codebase's entity is `contacts`/`Contact`, not `leads`/`Lead`, throughout the schema, types, and ~40+ files. Recommended default (documented in `AGENT_GUARDRAILS.md`): **do not rename the underlying entity** — the blast radius is too large for the value. Instead, display "Lead" in the UI via `next-intl` message keys (e.g. `contacts.label` → "Lead" for real-estate-template accounts) while `Contact`/`contacts` stays the code-level name everywhere. Every task below that says "Leads screen" means "the Contacts screen, mobile-rebuilt, labeled Lead in the UI."

---

## 0. Operating rules for the agent (read first, every session)

1. **One section = one branch = one PR.** Do not combine sections. Do not start section N+1 before section N is merged.
2. **Before writing any code in a section**, do a short reconnaissance pass: read 2-3 existing files in the directory you're about to touch and match their conventions (naming, error handling, RLS patterns, component structure). Do not introduce a new pattern where an existing one already works.
3. **Never modify or renumber existing Supabase migration files.** New schema changes are always a new migration file, numbered after the current highest number in `supabase/migrations/`.
4. **Never alter an existing RLS policy without flagging it explicitly in the PR description** as a security-relevant change, even if the task seems to require it. Isolation between tenant accounts is the most important invariant in this codebase — if a task seems to need a broader policy, stop and ask rather than loosening it.
5. **After every task:** run lint, typecheck, build, and the existing test suite. A task is not done if any of these fail.
6. **Write or update tests** for new API routes and new database functions/views as part of the same task, not as a follow-up.
7. **Update `PROGRESS.md`** (create it if it doesn't exist) by checking off the task ID when a section is complete, with the PR link.
8. **When a task is ambiguous or a required decision isn't specified below**, pick the most conservative option that matches existing repo conventions, note the assumption in the PR description, and proceed — don't block on it.
9. **Mobile-first means mobile-first**: every new screen in Sections C onward is built for a ~390px viewport first, then checked at desktop width — not the reverse.

---

## Section A — Repo Reconnaissance & Environment

_Goal: environment only. A1 is done — `docs/agent/ARCHITECTURE.md` already covers it — so this section is now just standing up working environments._

- ~~**A1.** Produce `ARCHITECTURE.md`~~ — **done.** Read `docs/agent/ARCHITECTURE.md` instead of redoing this; if it's missing something you need, extend that file rather than writing a new one.
- **A2.** Stand up a fresh Supabase project for local dev, run all existing migrations in order, seed minimal test data (one account, two users, a few contacts), confirm `npm run dev` boots cleanly and the existing desktop UI works end-to-end.
- **A3.** Stand up a second Supabase project for staging; document env var differences against `.env.local.example` (the repo's actual example file — note the exact name).
- **A4.** Confirm CI runs `lint`, `typecheck`, `format:check`, and `test` on every PR (the exact scripts in `package.json` — see `ARCHITECTURE.md` §1); add whichever is missing.

**Definition of done:** a fresh clone + `npm install` + `npm run dev` works from a clean checkout by following only the repo's own `CONTRIBUTING.md`.

---

## Section B — Design Tokens & Mobile Shell Foundation

_Goal: the reusable layer every later screen depends on. **Revised from the original plan** — `src/app/globals.css` already has a full shadcn/base-ui token set (`--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--chart-1..5`, `--sidebar_`, light+dark via `components.json`'s `cssVariables: true`), and `components/ui/`already has`button.tsx`, `badge.tsx`, `card.tsx`, `avatar.tsx`, `dialog.tsx`, `sheet.tsx`. This section is now mostly extension, not creation.\*

- **B1.** _(revised)_ **Extend**, don't replace, the existing token set in `globals.css`: add semantic status-color variables for the five real-estate pipeline stages (new/contacted/site-visit/negotiation/closed) and SLA-badge thresholds (Section F), following the same `--name: value` convention already there.
- **B2.** _(revised)_ Audit `components/ui/` first. `Button`, `Card`, `Avatar` already exist — use them. Check whether `badge.tsx` already covers the status/source-pill variants needed, extending its `cva` variants if not, rather than writing a new component. Check whether `sheet.tsx` already supports a bottom-anchored variant before building a separate `BottomSheet` — Sheet components in this style of shadcn setup often do via a `side` prop. `dashboard/empty-state.tsx` and `dashboard/skeleton.tsx` **already exist** — reuse them; only build new versions if they're desktop-shaped in a way that doesn't adapt. The genuinely new primitive here is `TopAppBar` (not present anywhere in the repo). Minimum 44×44px touch targets on anything new.
- **B3.** Build `BottomNav` (5 items: Dashboard, Leads, Pipeline, Visits, Inbox — "Leads" is a UI label over the `contacts` route, see the naming note above) and a `MoreSheet` route for everything else (Automations, Flows, Broadcasts, Team, Settings, Integrations). This is genuinely new — no equivalent exists (the current nav is `components/layout/sidebar.tsx`, desktop-only).
- **B4.** Wire a responsive split: mobile shell (bottom nav + top app bar) active below the `md` breakpoint; existing desktop sidebar layout preserved above it. Do not delete the desktop layout.
- **B5.** Add `viewport-fit=cover` meta tag and `env(safe-area-inset-*)` padding on the app shell root.

**Definition of done:** Storybook-style demo page (or a `/dev/components` route) renders every primitive in both themes; navigating the app on a 390px viewport shows the bottom nav, on desktop shows the existing sidebar.

---

## Section C — Core Screens: Mobile-Responsive Pass (Mobile)

_Goal: **revised** — every one of these pages already exists and works on desktop (`app/(dashboard)/dashboard/`, `contacts/`, `pipelines/`, `inbox/`), with substantial existing component libraries behind them (`components/dashboard/_`, `components/pipelines/_`, `components/inbox/_`). This section is a responsive/mobile-layout pass over real, working screens — not new-screen construction. Build against existing data only — no new tables in this section.\*

- **C1.** Dashboard (mobile): rework `app/(dashboard)/dashboard/page.tsx` at the `<md` breakpoint using existing `components/dashboard/metric-card.tsx`, `activity-feed.tsx`, `pipeline-donut.tsx` — restack into a 2×2 stat grid + "Today" section rather than building new data-fetching.
- **C2.** Leads list (mobile): rework `app/(dashboard)/contacts/page.tsx` — check what list/table component it currently renders and give it a mobile row layout (avatar, location, budget, source pill, status pill) with swipe actions, rather than a parallel new list component. Sticky search + status filter chips.
- **C3.** Lead detail (mobile): rework `components/contacts/contact-detail-view.tsx` for mobile — inline conversation thread, stage selector, notes, linked visits (once Section D/E exist).
- **C4.** Pipeline (mobile): `components/pipelines/pipeline-board.tsx` currently uses `@dnd-kit` for desktop drag-and-drop (confirmed in `package.json`) — add a mobile variant (horizontal swipeable stage tabs + vertical `deal-card.tsx` list per stage, "Move to…" bottom sheet) rather than trying to make drag-and-drop itself touch-friendly.
- **C5.** Inbox (mobile): `app/(dashboard)/inbox/page.tsx` already has a full component set (`message-bubble.tsx`, `message-thread.tsx`, `message-composer.tsx`, `conversation-list.tsx`, `ai-thread-banner.tsx`) — this is a responsive-layout pass on existing, working chat UI, not new chat UI.

**Definition of done:** all five screens usable end-to-end on a 390px viewport with real seeded data from Section A2; existing desktop behavior at `md`+ is unchanged; no console errors; each screen has a loading skeleton and an empty state (reuse `dashboard/skeleton.tsx` / `dashboard/empty-state.tsx` per Section B2).

---

## Section D — Real Estate Data Model Extensions

_Goal: the schema additions everything from Section E onward depends on._

- **D1.** _(revised)_ Before writing a migration: `custom_fields` + `contact_custom_values` already exist as a generic per-account custom-field mechanism (migration 001). Check whether seeding `budget_min`, `budget_max`, `location_preference`, `property_type`, `intent` as **default custom fields** on real-estate-template accounts satisfies this task with zero schema changes, before adding dedicated columns or a new `lead_details` table. Only add a migration if the generic mechanism is a poor fit (e.g. you need to query/filter/index on these fields efficiently at scale) — and say so explicitly in the PR if you go that route.
- **D2.** New migration: `site_visits` table — `lead_id`, `property_id` (nullable), `scheduled_at`, `status` enum (`pending`/`confirmed`/`completed`/`no_show`/`rescheduled`), `notes`, `account_id`, RLS scoped identically to existing account-scoped tables.
- **D3.** New migration: `properties` table — `title`, `location`, `price`, `property_type`, `bedrooms`, `tags`, `account_id`, RLS scoped.
- **D4.** Seed a default real-estate pipeline stage set (New → Contacted → Site Visit → Negotiation → Closed) as the template applied on new account signup.
- **D5.** API routes: CRUD for `properties` and `site_visits`, following the existing scoped-API-key pattern used by other public API routes.

**Definition of done:** migrations run cleanly on a fresh DB and on top of the existing seeded data from A2; RLS isolation test (create two accounts, confirm neither can read the other's rows in the three new tables) passes.

---

## Section E — Site Visits: UI + No-Show Automation

_Goal: directly targets the ~20-35% industry no-show rate — this is one of the highest-value sections in the whole plan._

- **E1.** Site Visits list screen (mobile): day-grouped, status pill, one-tap call/WhatsApp.
- **E2.** "Schedule Visit" bottom-sheet form: pick lead, optionally link a property, date/time.
- **E3.** Automation recipes (pre-seeded, on by default for real-estate-template accounts): T-24h confirmation message, T-2h reminder with location, and a no-show recovery message sent automatically if a visit passes without confirmation. Build these as records in the existing Automations engine, not new bespoke logic.
- **E4.** One-tap confirm/reschedule actions on the visit updating `site_visits.status`.

**Definition of done:** scheduling a visit in the UI creates the correct Automation-trigger state; a simulated T-24h/T-2h/no-show scenario (test with fast-forwarded timestamps) sends the correct WhatsApp template at each step.

---

## Section F — Response SLA & Lead Ownership Visibility

_Goal: targets the response-speed and lead-ownership-dispute problems directly — make both visible in the UI, not just logged in the DB._

- **F1.** Add "time since first unanswered inbound message" to the lead list/detail query.
- **F2.** `SlaBadge` component: green under threshold A, amber between A and B, red beyond B — thresholds configurable per account, sane defaults (e.g., 5 min / 30 min).
- **F3.** _(note)_ `deals.assigned_to` and `conversations.assigned_agent_id` already exist as current-state fields (see `SCHEMA_REFERENCE.md`) — this task is adding the **history table** that doesn't exist yet, not the assignment field itself. New migration for an assignment-audit table recording every change — lead, from-agent, to-agent, actor, timestamp, reason (manual/automation/round-robin).
- **F4.** Lead detail: "Assigned to [agent]" with a tappable history showing the full audit trail.
- **F5.** Confirm the default qualification Flow fires automatically on every new lead for real-estate-template accounts unless explicitly disabled in Settings — verify against the existing Flow trigger config rather than adding new trigger logic.

**Definition of done:** SLA badge changes color correctly against seeded timestamps; reassigning a lead writes an audit row and it's visible in the UI immediately.

---

## Section G — Team / Manager Dashboard

_Goal: owner/admin-only visibility the research shows brokers specifically need for accountability._

- **G1.** New role-gated route (`owner`/`admin` only): per-agent response time, leads worked, visits completed vs. no-show rate, conversion rate.
- **G2.** _(revised)_ `lib/dashboard/queries.ts` and `lib/dashboard/types.ts` already exist as the query layer behind the current (personal) Dashboard — extend that module with the per-agent aggregation queries rather than starting a new query file. Implement as SQL views/aggregation queries over existing + Section D/F tables — avoid new tables here.
- **G3.** Mobile-responsive table/card list UI, consistent with Section B primitives.

**Definition of done:** an `agent` role cannot reach this route (server-side check, not just hidden nav); an `admin` sees correct aggregate numbers against seeded test data.

---

## Section H — Properties & Lead Matching

_Goal: automates the manual "which listings fit this buyer" work agents currently do by hand._

- **H1.** Properties list screen: filter by location/budget/type.
- **H2.** Property detail screen.
- **H3.** "Match" action on lead detail: query `properties` against that lead's budget/location/type, surface top 2-3, one-tap "send via WhatsApp" reusing the existing message-send API/template mechanism.

**Definition of done:** matching query returns relevant results against seeded property + lead data; sending a match posts an actual outbound WhatsApp message in a test/staging number.

---

## Section I — Onboarding Wizard & Real Estate Template

_Goal: this is effectively your product demo — treat its polish as seriously as Section C._

- **I1.** _(revised)_ `app/(auth)/signup/page.tsx` and the WhatsApp connect flow (`app/api/whatsapp/config/`, `components/settings/whatsapp-config.tsx`) already exist separately — this task is **sequencing existing pieces into one wizard**, not building WhatsApp connection logic from scratch. Signup wizard: account creation → WhatsApp number connect (reusing the existing config component/route) → pipeline template selection (default: real estate, from D4) → team invite (reusing `components/settings/invite-member-dialog.tsx`'s underlying logic).
- **I2.** Seed the real-estate qualification Flow (from F5 default) automatically at signup.
- **I3.** Role-aware nav: hide Team/Settings/Integrations for `agent` role; keep visible for `owner`/`admin`.
- **I4.** Mobile-polished invite/join screen.

**Definition of done:** a brand-new signup, done entirely on a mobile viewport, ends with a working WhatsApp-connected account, real-estate pipeline, and an active qualification bot, with zero manual DB intervention.

---

## Section J — Automations & Flows: Mobile Simplification

_Goal: don't try to fit a drag-and-drop canvas on a phone — replace it with a toggle list on mobile only._

- **J1.** "Recipes" list UI on mobile wrapping existing Automations/Flows: simple on/off toggle per recipe (stale-lead follow-up, no-show recovery from E3, visit reminders). No new automation logic — this is a UI layer over what already exists.
- **J2.** Gate the full drag-and-drop builder to `md`+ viewport widths; route mobile users to the recipe list instead.

**Definition of done:** toggling a recipe on/off on mobile correctly enables/disables the underlying Automation record; the full builder still works unchanged on desktop.

---

## Section K — PWA & Native-Feel Polish

_Goal: this section is what actually earns "feels like a native app," on top of Section B's shell work._

- **K1.** Web manifest (name, icon set, `display: standalone`, theme color) + all required icon sizes.
- **K2.** Service worker: app-shell caching, offline fallback page.
- **K3.** Web push: subscription flow + server-side push on new-lead and visit-reminder events.
- **K4.** Pull-to-refresh on list screens, skeleton loaders (reuse Section B `Skeleton`), sparing `navigator.vibrate` on key confirmations.

**Definition of done:** app installs to home screen on both Android Chrome and iOS Safari; a push notification fires end-to-end in staging; Lighthouse PWA checklist passes.

---

## Section L — Billing & Plan Gating

_Goal: the one piece genuinely missing from wacrm — required before charging anyone._

- **L1.** _(note)_ Confirmed no billing/Stripe dependency exists in `package.json` and the `accounts` table (migration 017) has no status-like column — this is a genuine, full-stack gap. New migration adding `accounts.subscription_status`; Stripe Checkout integration + webhook handler updating it.
- **L2.** Middleware gate: block dashboard access for non-active accounts, redirect to a billing/reactivate screen.
- **L3.** Seat-limit enforcement against plan tier, checked at invite time.

**Definition of done:** a simulated Stripe webhook correctly flips an account between active/past-due and access is gated accordingly; inviting past a plan's seat limit is blocked with a clear UI message.

---

## Section M — Portal Lead Capture (Email Parser)

_Goal: matches the "auto-capture from 99acres/MagicBricks" feature via the same mechanism those competitors actually use — an inbound email address, not a negotiated API._

- **M1.** Provision an inbound email address (e.g. SendGrid Inbound Parse or Mailgun Routes) posting to a new webhook endpoint.
- **M2.** Template-based extraction for 99acres/MagicBricks/Housing.com notification emails, with an LLM-based generic fallback extractor for anything that doesn't match a known template.
- **M3.** Write extracted leads into contacts via the existing public API, tagged with the source portal, triggering the same qualification Flow as any other new lead.

**Definition of done:** forwarding a real (or realistic sample) portal notification email to the capture address results in a correctly populated, correctly tagged lead appearing in the Leads list within seconds.

---

## Section N — QA, Performance & Launch Readiness

_Goal: the gate before pilot rollout._

- **N1.** Lighthouse mobile audit on Dashboard, Leads, Pipeline, Inbox — fix until Performance and Best Practices are both 90+.
- **N2.** _(revised)_ `supabase/ci/verify-schema.sql` already exists as a schema-check script — extend it (or add a sibling script) with an automated two-tenant RLS isolation test across every table touched in Sections D-M, rather than building a parallel test mechanism. Confirm zero cross-tenant leakage.
- **N3.** Manual device-testing checklist: one mid-range Android device, one iPhone, real network conditions (not just dev tools throttling).
- **N4.** Stand up a lightweight bug-intake process (even a simple issue template) ahead of the pilot.

**Definition of done:** all four checks pass; a written go/no-go summary is produced for the pilot.

---

## How to run this with an AI coding agent

1. File locations — see "Where these files go in the repo" below. `AGENTS.md` at the repo root is what actually gets auto-loaded by Claude Code / Gemini CLI at session start, and it points to everything else — that linkage is what makes this whole document set self-enforcing rather than easy to ignore.
2. Run **one section per session**, e.g.: _"Read AGENTS.md, then IMPLEMENTATION_PLAN.md. Execute Section C only. Before writing code, list the specific files you'll create or modify and confirm they match the conventions in docs/agent/ARCHITECTURE.md. Then implement, and run typecheck/lint/format:check/test before finishing."_
3. Review and merge each section's PR before starting the next — sections B through F have real dependency order (B before C, D before E/F, F before G); sections H, J, K, L, M are largely independent of each other and can be parallelized across sessions once D is merged.
4. Re-run Section N's checks after every few sections merge, not just once at the end — catching an RLS regression early is far cheaper than finding it right before launch.

---

## Where these files go in the repo

```
wacrm/                                 ← your fork's root
├── AGENTS.md                          ← REPLACE the existing one (merge: keep the
│                                          <!-- BEGIN/END:nextjs-agent-rules --> block,
│                                          add the pointer section below it)
├── CLAUDE.md                          ← leave as-is, it already does `@AGENTS.md`
├── IMPLEMENTATION_PLAN.md             ← NEW, repo root
├── PROGRESS.md                        ← NEW, repo root (agent creates/maintains this
│                                          per AGENT_GUARDRAILS.md's workflow rule 8)
└── docs/
    ├── docker.md                      ← existing, don't touch
    ├── mcp.md                         ← existing, don't touch
    ├── multi-waba.md                  ← existing, don't touch
    ├── public-api.md                  ← existing, don't touch
    ├── whatsapp-connection-troubleshooting.md   ← existing, don't touch
    └── agent/                         ← NEW subfolder, keeps these separate
        ├── ARCHITECTURE.md            ← NEW
        ├── SCHEMA_REFERENCE.md        ← NEW
        └── AGENT_GUARDRAILS.md        ← NEW
```

The existing `docs/` folder is end-user/operator documentation (Docker, MCP, multi-WABA setup); `docs/agent/` is a deliberately separate subfolder for agent-facing reference material so the two don't get mixed up as the docs folder grows.
