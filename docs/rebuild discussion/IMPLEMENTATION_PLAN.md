# Nexara WACRM — Master Implementation Plan (Phases 0–10)

End-to-end delivery plan. Sits above the Phase-0 gate docs (`phase-0/`) and the v6 decision record. Every phase lists **deliverables · gate/acceptance · dependencies**. Adapter-model, framework-first, one-time cutover (footprint negligible — `phase-0/MIGRATION_MAP.md`).

**Guiding rules (all phases):** business code depends on interfaces only (guard blocks CI); every infra SQL filters `account_id`; every side effect is idempotent; server is the authorization authority; production stays shippable; `credit_ledger`/settlement stay unwritten until both hard gates pass.

## Parallel track (runs from day 1, blocks nothing until Phase 6)
**Meta commercial track** — Business Verification → App Review → Advanced Access (`whatsapp_business_messaging`, `whatsapp_business_management`) → Embedded Signup approval; Solution Partner application in parallel. Long-pole. V1 builds on the **Tech-Provider fallback** billing model; swap to Solution-Partner settlement later without touching messaging (`phase-0/META_COMMERCIAL_BILLING_MODEL.md`).

---

## Phase 0 — Gates (docs done; two still open)
- **Done:** production counts + cutover decision, Meta eligibility research, architecture model, repo plan, auth/onboarding/credits specs (`phase-0/`).
- **Open — must close before dependent phases:**
  - **DB correctness benchmark** (blocks Phase 6 billing code + DB lock) — built as Phase 1 harness.
  - **Meta verification/eligibility** (blocks Phase 4 live onboarding + Phase 6 settlement) — the parallel track.
- **Also confirm:** which Supabase project is true production (MIGRATION_MAP caveat).

## Phase 1 — Foundation + DB benchmark harness
**Deliverables:** new canonical repo (`phase-0/NEW_REPO_PLAN.md`) — pnpm+Turbo, `nexara/` from framework (bump Next 16.2/React 19.2), `apps/web` shell, `packages/{domain,contracts,api-client}`; `check-architecture.mjs` re-pointed + blocking in CI; **both** `D1DatabaseProvider` and `PostgresDatabaseProvider`; wallet/conversation **contract tests** (concurrent reserve/settle/release, idempotency, tenant isolation).
**Gate:** running the contract tests against both adapters **IS the DATABASE_DECISION benchmark** → pick D1 or Neon on the four correctness invariants (no negative balance / double debit / duplicate settlement / lost reservation). Record in `phase-0/DATABASE_DECISION.md`. `npm run verify` green.
**Deps:** Phase 0.

## Phase 2 — Data seam + schema
**Deliverables:** authoritative schema for the chosen DB (`db/schema` + forward-only migrations) — organizations, users/auth tables, contacts, conversations, messages, templates, broadcasts, automations, credits tables (schema only), device_installations; repository interfaces + impls (tenant-scoped, snake↔camel mapping); transaction abstraction; `StorageProvider`/R2 + `VectorProvider`/Vectorize interfaces.
**Gate:** guard green; repositories expose no raw bindings; every SQL filters `account_id`.
**Deps:** Phase 1 (DB decided).

## Phase 3 — Identity + Organizations
**Deliverables:** extended `AuthProvider` → `JwtAuthProvider` (`phase-0/AUTH_EXTENSION.md`) — login/logout/refresh-rotation/revoke/listSessions/reset/verifyEmail/acceptInvitation; Workers-safe hashing; cookie (web) + token (mobile-ready) sessions; organizations/tenancy, memberships, roles (RBAC `PermissionService`), invitations, platform-admin + **MFA for platform-admin**; audit log scaffold.
**Gate:** auth E2E (expired/revoked/reused-refresh/wrong-tenant/wrong-role/multi-device); tenant isolation test (repo call without `TenantContext` fails).
**Deps:** Phase 2.

## Phase 4 — Meta onboarding
**Deliverables:** `meta-onboarding` module + `MetaBusinessProvider` (separate from messaging) — Embedded Signup wizard (web-first), state machine `created→meta_connected→phone_registered→webhook_verified→template_ready→complete`, retry/resume, server-side token storage; gates messaging until `complete` (`phase-0/META_ONBOARDING_FLOW.md`). Manual-entry fallback.
**Gate:** onboarding POC end-to-end in a production-like Meta app (needs the Meta track far enough along). A failed provider call never permanently locks an account.
**Deps:** Phase 3 + Meta track (App Review/Embedded Signup approved).

## Phase 5 — WhatsApp core
**Deliverables:** `WhatsAppProvider` (`MetaWhatsAppProvider`); webhook ingest → **queue → idempotent** message service → persist → event → inbox; send (with idempotency key); conversations/messages/inbox/contacts; media via **signed direct R2 upload** (`StorageProvider`); realtime V1 = polling + incremental sync behind `RealtimeProvider`.
**Gate:** real inbound WhatsApp message → persisted once (no dup on retry) → appears in inbox → operator reply → outbound sent → status persisted → tenant isolation verified. **This is Web+WhatsApp first value** (ship before broad mobile).
**Deps:** Phase 4.

## Phase 6 — Credits / billing *(GATED)*
**Do not start ledger/settlement code until BOTH gates pass** (DB benchmark + Meta commercial). **Deliverables:** credit_wallets, immutable `credit_ledger`, `credit_reservations`, usage_records, pricing_rules; `UsageMeter` reserve→settle with TTL; atomic conditional debit; **reconciliation** job vs Meta usage API; `PaymentProvider` (market-first, credits granted only after server-side payment verification); insufficient-credit block/pause; prepaid-only (postpaid schema-ready, not built) (`phase-0/CREDITS_BILLING_DESIGN.md`).
**Gate:** concurrency test — no negative balance / double debit / duplicate settlement / lost reservation; webhook-retry safe. **Completes the first production vertical slice** (org → credits → onboarding → WhatsApp → usage → reserve/settle → inbox).
**Deps:** Phase 5 + both hard gates.

## Phase 7 — Broadcasts + automation
**Deliverables:** broadcasts (templates, audience, scheduling, queue pacing) with **UsageMeter charge hook**; automations + flows on queue + cron, execution counters.
**Gate:** broadcast send debits once per recipient (idempotent); pacing holds; automation retries safe.
**Deps:** Phase 6 (charging) — non-charging parts can start after Phase 5.

## Phase 8 — Web parity
**Deliverables:** migrate remaining wacrm web features onto the api-client — pipelines/deals, templates, quick-replies, settings (role-gated), admin console, branding, AI assistant (bring-your-own-key; no AI billing). Web calls shared `api-client`, no business logic in components.
**Gate:** per-module test + regression vs characterization baseline; release each module.
**Deps:** Phase 5+ (each module when its API exists).

## Phase 9 — Mobile track
**Deliverables:** `apps/mobile` (Expo + Expo Router) — native auth (secure token storage, biometric optional), push (`NotificationProvider` Expo→APNs/FCM, `device_installations`), deep links (`/conversations/:id`, invite/reset/verify), direct-R2 media, lifecycle handling, basic sync (TanStack Query persistent cache). Onboarding opens web Embedded Signup, returns via deep link. Smallest workflow first: login→inbox→conversation→send→push→deep link.
**Gate:** mobile critical-flow E2E; iOS + Android builds via EAS. Do NOT require full web parity before shipping mobile.
**Deps:** stable core API/domain boundaries (post Phase 5/6).

## Phase 10 — Hardening + production cutover
**Deliverables:** tenant-isolation suite, security review, rate-limit/idempotency/provider-failure/retry tests, wallet-concurrency + load tests, deep-link/push/media tests; **one-time data migration** (small dataset export→transform→import→verify); staged rollout (internal → cohort → full; TestFlight/Play internal for mobile); reconcile `wrangler.toml` routes+secrets; keep old system available until proven.
**Gate:** Definition of Done (v6) — WACRM on Nexara, WhatsApp reliable, DB replaceable, tenant isolation, idempotent side effects, wallet concurrency-safe, mobile iOS+Android, push/deep-link/media, observability, critical flows tested, reversible migration.
**Deps:** all prior.

---

## Critical path
```
Phase 0 gates ─┬─ Meta track ───────────────────────────┐ (blocks 4 live, 6 settle)
               └─ 1 Foundation+benchmark ─ 2 Schema ─ 3 Identity/Org ─ 4 Onboarding ─ 5 WhatsApp(first value)
                                                                                         └─[gates]─ 6 Credits ─ 7 Broadcasts/Automation
                                                                          8 Web parity (parallel from 5) ── 9 Mobile ── 10 Hardening/Cutover
```
First production value = end of **Phase 5** (Web + WhatsApp). First commercial slice = end of **Phase 6**. Build this path completely before generalizing beyond WhatsApp billing or building deferred Nexara-OS modules (`phase-0/DO_NOT_BUILD_YET.md`).
