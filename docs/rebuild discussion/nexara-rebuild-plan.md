# Nexara Rebuild Plan — wacrm → Nexara Foundation V1

**Decision (2026-09-08):** Rebuild wacrm on the Nexara Foundation V1 adapter architecture.

- **Database + Auth:** Cloudflare **D1** (SQLite) via `D1DatabaseProvider`, **JWT** (jose, httpOnly cookies) via `JwtAuthProvider`. Everything behind the framework's provider interfaces — no direct vendor SDK in business code.
- **Strategy:** **Greenfield port.** New app seeded from `nexara-repo-framework`; wacrm features copied in module-by-module against the adapter/module structure. No incremental in-place refactor.
- **Runtime:** Keep **Next.js 16.2 / React 19.2** (bump the framework core up from its pinned 15.3). OpenNext + Cloudflare Workers. Custom domain `wacrm.nexaragroups.com`.

The architecture guard (`scripts/check-architecture.mjs`) is the acceptance gate for every module: no provider SDK outside `*/providers/*` + container + `_services.ts`, no SQL in services, every infrastructure SQL statement filters `tenant_id`.

---

## 1. Target architecture

```
src/
  shared/            Result, AppError, ids (from framework, unchanged)
  core/
    platform/        PlatformProvider — CloudflarePlatformProvider (env/KV/Queue/cron)
    database/        DatabaseProvider — NEW: D1DatabaseProvider
    auth/            AuthProvider     — NEW: JwtAuthProvider (jose + D1 sessions)
    rbac/            roles/permissions/policy map (extend to wacrm roles)
    storage/         NEW: StorageProvider — R2StorageProvider (avatars, chat media)
    search/          NEW: VectorProvider — VectorizeProvider (AI knowledge semantic)
    repositories/    domain data-access ports (per module)
    context/         RequestContext + TenantContext (tenant = account_id)
    events/          EventBus (in-process) + Queue for durable jobs
    container.ts     composition root — the only place providers are wired
  infrastructure/    D1 repository impls (SQL lives here), R2/Vectorize impls, event bus
  modules/           business features (see §3)
  app/               Next routes + server actions (presentation only)
```

New provider interfaces beyond the framework's three (Platform/Database/Auth):
- **StorageProvider** — Supabase Storage → R2. Methods: `put/get/delete/signedUrl`.
- **VectorProvider** — pgvector → Cloudflare Vectorize. Methods: `upsert/query/delete` by tenant namespace.
- **RealtimeProvider** — Supabase Realtime has no D1 equivalent (see §4).

## 2. What D1 forces us to replace

wacrm is Supabase-native. D1 = SQLite only, no Postgres extras. Each below is a required workstream, not optional.

| Supabase feature | wacrm usage | D1 replacement |
| --- | --- | --- |
| **Row Level Security** | every table | App-layer tenant filtering. Every repo method takes `TenantContext`, every SQL filters `account_id`. Guard-enforced. SECURITY DEFINER RPCs → server-only service methods. |
| **Stored functions / RPC** (~15) | `debit_message`, `credit_wallet`, `effective_rate`, `is_account_member`, `is_platform_admin`, `redeem_invitation`, `peek_invitation`, `set_member_role`, `remove_account_member`, `transfer_account_ownership`, `touch_presence`, `filter_contacts_by_tags`, `increment_automation_execution_count`, `increment_flow_execution_count`, `record_webhook_failure`, `notify_conversation_assigned`, `create_wallet_for_account`, `update_updated_at_column` | Reimplement in repository/service layer. Wallet ops (`debit_message`/`credit_wallet`) must stay atomic — use a single D1 transaction with balance check; server-only, never client-reachable. |
| **Supabase Auth** | login/signup/session/reset, `app_metadata` role+tenant | `JwtAuthProvider`: jose-signed JWT, httpOnly cookie sessions, `users` + `sessions` tables in D1. Role + `account_id` claims in token. Password hashing (argon2/bcrypt via WASM or Workers-compatible). |
| **Supabase Realtime** (7 client files: presence, unread counts, notifications, conversation list, message thread, AI banner) | live inbox + presence | No D1 realtime. Options in §4. |
| **Supabase Storage** (`avatars`, chat media bucket) | profile avatars, inbox media | **R2** via `StorageProvider`. Signed URLs for private media. |
| **pgvector** (`match_ai_knowledge_semantic`) | AI knowledge semantic search | **Vectorize** via `VectorProvider`, tenant-namespaced. |
| **Postgres FTS** (`match_ai_knowledge_fts`) | keyword knowledge search | D1 **FTS5** virtual table. |
| **Postgres types** | enums, jsonb, timestamptz, `gen_random_uuid`, triggers | SQLite: `TEXT` + CHECK for enums, `TEXT` JSON for jsonb, integer epoch or ISO `TEXT` for time, app-generated UUID, `updated_at` set in repo (no triggers). |

**Schema:** 40 Postgres migrations (`supabase/migrations/001..040`) → one authoritative D1 SQLite schema (`db/d1-schema.sql`, already started per prior work) + forward-only D1 migrations. Data migration path from live Supabase → D1 needed if production data is preserved (export → transform types → import); decide at cutover.

## 3. Feature → module map

Copy `src/modules/_template` per module. Each = `domain/ application/ infrastructure/ presentation/`. Order = dependency order.

1. **identity** — users, sessions, accounts, account_members, invitations, roles, platform_admins. Foundation for everything (auth + tenant). Ports the JWT auth + member RPCs.
2. **contacts** — contacts, custom fields, tags, import, `filter_contacts_by_tags`.
3. **conversations** (inbox) — conversations, messages, assignments, quick-replies, notifications, presence, message actions/reactions. Realtime-dependent (§4).
4. **pipelines** — pipelines, stages, deals.
5. **whatsapp** — config, send, webhook ingest, media proxy, template sync/submit, reactions. External Meta Graph API integration; keep as an infrastructure adapter.
6. **broadcasts** — templates, audience selection, scheduling, queue processor, 2-msg/min pacing (currently cron + queue). Charges wallet on template send.
7. **automations** — triggers, engine, cron, execution counters.
8. **flows** — xyflow builder, runs, cron, execution counters, flow media.
9. **ai** — config, knowledge (FTS5 + Vectorize), embeddings, auto-reply, draft, playground, usage.
10. **billing** — wallet, credits, `debit_message`/`credit_wallet`/`effective_rate`, recharge (manual + gateway toggle), platform-admin rate config.
11. **branding** — per-account logo (R2) + business name.
12. **public-api (v1)** — api keys, webhook endpoints, `record_webhook_failure`, external contacts/conversations/messages/broadcasts endpoints. Bearer-key auth path distinct from JWT session.

Cross-module reactions (e.g. broadcast send → wallet debit → notification) go through the **EventBus**, not direct imports. Durable/retryable work (broadcast pacing, webhook delivery, automation/flow cron) goes through **PlatformProvider.queue()** + Workers cron, not the in-memory bus.

## 4. Realtime decision (blocking for inbox module)

D1 has no change-feed. Pick one before module 3:
- **A. Polling** — simplest. Client polls unread/messages every N seconds via KV-cached counts. Cheapest, works on any plan, slight latency. **Recommended for V1.**
- **B. Durable Objects + WebSockets** — true realtime, per-conversation DO fan-out. Best UX, needs Workers Paid, more code.
- **C. Queue → SSE** — middle ground, still needs a push channel.

Recommendation: ship **A (polling)** behind a `RealtimeProvider` interface so **B** can swap in later without touching the inbox module.

## 5. Phased sequence

**Phase 0 — Foundation (1 unit)**
- Seed new app from `nexara-repo-framework`. Bump Next → 16.2, React → 19.2, align OpenNext/wrangler.
- Build `D1DatabaseProvider` (param SQL, transactions, error→AppError) + wire `case "d1"`.
- Build `JwtAuthProvider` (jose, cookie sessions) + `case "jwt"`.
- Add `StorageProvider`/R2 + `VectorProvider`/Vectorize interfaces and impls.
- Author `db/d1-schema.sql` from the 40 migrations. Extend RBAC roles/permissions to wacrm's (owner/admin/operator + platform-admin).
- `npm run verify` green on the empty app + sample feature.

**Phase 1 — identity** (module 1). Auth end to end on JWT+D1. Login/session/roles/tenant. Gate: guard + auth flow works.

**Phase 2 — core CRM** (modules 2–4: contacts, conversations, pipelines) with realtime option A.

**Phase 3 — WhatsApp + broadcasts** (modules 5–6) incl. queue pacing + wallet charge hook.

**Phase 4 — automation** (modules 7–8: automations, flows) on queue + cron.

**Phase 5 — AI** (module 9) FTS5 + Vectorize.

**Phase 6 — billing, branding, public API** (modules 10–12).

**Phase 7 — cutover.** Data migration Supabase→D1 (if preserving prod), deploy, verify custom domain + all vars/secrets (see deploy-config-drift note), decommission Supabase.

Each phase ends green on `npm run verify` and its own tests (wacrm already has vitest suites — port them per module).

## 6. Known risks / open items

- **Deploy plan floor:** authenticated SSR on Workers hits Error 1102 (10ms CPU) on the free plan; broadcasts/queue/cron/DO also need **Workers Paid (~$5/mo)**. Adapter swap does not fix this.
- **Wallet atomicity on D1** — SQLite transaction isolation differs from Postgres SECURITY DEFINER; debit must re-check balance inside the transaction to prevent oversend under concurrency.
- **Password hashing on Workers** — pick a Workers-runtime-safe hash (WASM argon2 or PBKDF2 via WebCrypto); no Node `bcrypt`.
- **Data migration** — type transforms (enum/jsonb/timestamptz/uuid) and pgvector→Vectorize re-embedding cost. Decide preserve-vs-fresh at Phase 7.
- **`deploy-config-drift`** — production Worker config is dashboard-managed; reconcile `wrangler.toml` (routes + secrets) before any deploy or it clobbers the live app.

## 7. Gate before build

Run **nexara-architect-review** on this plan (mandatory Nexara gate between planning and implementation) before Phase 0 begins. Do not start building until it returns APPROVE / APPROVE WITH CONDITIONS.

---

## 8. Mobile strategy — one codebase, web + mobile (team decision needed)

**Requirement:** single codebase maintaining both a web app and a mobile app.

**Key fact:** the Nexara core (`domain` / `application` / `infrastructure` + adapters + D1 + JWT) is pure TypeScript and UI-agnostic. It serves web and mobile **unchanged** — mobile talks to the same Cloudflare Workers backend (the public API v1 already exists). **No backend/adapter compromise for any option below.**

The only thing that cannot cross platforms is **presentation**: shadcn/ui + Tailwind + Next App Router are web-only. So mobile UI is a separate layer, not a separate stack.

**Proposed structure — monorepo (Turborepo):**
```
apps/
  web      Next.js 16 + shadcn        (framework unchanged)
  mobile   <chosen mobile stack>
packages/
  core     Nexara adapters + domain + services   (shared TS, single source)
  api      typed API client + zod schemas          (shared TS)
```

### Options

| Option | Language | Shared TS core | Mobile UI | Web from same UI | Native quality | Nexara-stack compromise |
| --- | --- | --- | --- | --- | --- | --- |
| **Expo / React Native** *(recommended)* | TS | ✅ full reuse | rebuilt: Tailwind→NativeWind, shadcn→RN equivalents | RN-Web (ok) | High | Adds Expo only. UI layer duplicated; business logic 100% shared. |
| **Capacitor** (wrap Next PWA) | TS | ✅ full reuse | none — same web UI in WebView | ✅ one UI | Medium (WebView) | Least. One UI codebase, but WebView app; realtime/push/camera weaker. |
| **Flutter** | TS **+ Dart** | ❌ rewrite in Dart | native Flutter | Flutter Web (weak) | Highest | Largest. Domain types, zod schemas, API client all reimplemented in Dart; 2 languages; likely 3 stacks (Next web + Flutter mobile + TS backend). |

### Recommendation
- **Expo / React Native** best fits "one codebase, maintain both": one language (TS), full core reuse, true native. Cost = shadcn↔RN UI duplication.
- **Capacitor** if fastest path + single UI matters more than native feel.
- **Flutter** only if mobile UX polish is the top priority and duplicated Dart business logic is acceptable — it breaks the single-codebase premise.

**Team decision:** pick Expo / Capacitor / Flutter. Choice sets whether the rebuild adds the `packages/` split in Phase 0 or later.

## 9. Architect review outcome (2026-09-08)

**Verdict: APPROVE WITH CONDITIONS.** No blockers — direction sound, internally consistent, AI already backend-routed. Conditions to address in Phase 0/1:

- **Auth:** prefer **Auth.js (NextAuth) credentials + D1 adapter** behind the `AuthProvider` interface over hand-built jose flow; if hand-built, password reset / email verify / session revocation / login rate-limit are explicit Phase 1 deliverables. Workers-safe password hashing (WebCrypto PBKDF2 or WASM argon2 — no Node `bcrypt`).
- **Tenancy (RLS gone → app layer is the only guard):** keep `check-architecture.mjs` blocking in CI; index `account_id` on every tenant table; per-tenant R2 prefixes; add a test that a repo call without `TenantContext` fails.
- **D1 backups:** define export/backup cadence (lose Supabase managed backups).
- **Wallet atomicity:** debit re-checks balance inside one D1 transaction; Phase 6 concurrency test must prove no oversend.
- **Security baseline (port from current wacrm, add if absent):** rate limits on auth + AI endpoints; **audit log** for wallet debit/credit, member role change, platform-admin acts, ownership transfer; **MFA for platform-admin**; Sentry + dependency scanning.
- **CI/CD + tests:** staging/preview + QA gate before prod; Playwright critical paths (login, inbox reply, broadcast send); Vitest on every PR (block), Playwright on merge to main.
- **Deployment:** define rollback (Workers versioned deploys); reconcile `wrangler.toml` routes + secrets before deploy (dashboard drift clobbers live app).
- **Cost:** itemize D1 / Vectorize / R2 / Queues / DO + **AI usage separately** from the ~$5/mo Workers Paid floor.

**Accepted divergences (deliberate, consistent):** no ORM (raw SQL through `DatabaseProvider`, not Drizzle/Prisma); D1/SQLite over PostgreSQL default (justified by Cloudflare-native + full-adapter; `DatabaseProvider` keeps Postgres/Neon swap open).

**Open questions for team:** realtime V1 (polling vs fund DO now); Phase 7 data (preserve prod Supabase→D1 vs fresh); Auth.js vs hand-built; MFA + audit-log scope; **mobile stack (§8)**.
