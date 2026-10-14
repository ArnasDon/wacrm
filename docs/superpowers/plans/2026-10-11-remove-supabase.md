# Remove Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Implement inline; use one independent whole-change review after implementation.

**Goal:** Run the existing CRM using the local `omni_connect` PostgreSQL database without requiring Supabase.

**Architecture:** Next.js owns authentication, authorization, named domain APIs, and uploads. PostgreSQL stores application records and Better Auth sessions. Replace browser database access with same-origin HTTP calls and replace realtime subscriptions with polling; preserve account isolation and background worker behavior.

**Tech Stack:** Installed PostgreSQL 18, Next.js 16.3.5, React 19, TypeScript, node-postgres (`pg`), Better Auth, Vitest.

**Spec:** [LOCAL_POSTGRES_MIGRATION.md](../../../LOCAL_POSTGRES_MIGRATION.md).

## Global constraints

- Work on `feature-remove-supabase` and maintain `feature-remove-supabase.md`.
- Use the existing `omni_connect` database; start without imported user/domain data. Do not drop existing tables to obtain a fresh schema.
- Inspect existing local tables before migrating. If domain tables already exist, verify their structure and explicitly adopt compatible objects; fail with a clear report for incompatible objects instead of hiding differences behind IF NOT EXISTS.
- Do not change or delete the hosted Supabase project or copy its data.
- Preserve existing working-tree changes and encryption/Meta secrets.
- No SQL credentials or privileged access in browser code. No arbitrary SQL/table-query endpoint.
- Keep owner/admin/agent/viewer rules, API key scopes, webhook signatures, and account isolation.
- Each product task starts with a failing behavior test, then implementation and passing checks. Record deviations and actual command results in the branch log.
- Read installed Next.js guides before changing framework integrations. Do not rely on older middleware/session conventions.
- Product dependencies and local schema changes begin only after implementation-plan review.

## Review focus

1. A second account must never read or mutate the first account's records, files, or realtime replacements.
2. A pooled connection must not leak one request's session identity into another request or background job.
3. Signup, expired/revoked sessions, invitations, and password recovery must never leave a usable session with broken account membership.
4. Concurrent webhook deliveries must not duplicate messages or double advance automations/flows; a broadcast failure must not leave partial parent/recipient records.
5. A fresh database and one containing user-created tables must both be handled without destructive resets; absent optional pgvector/email/Meta access must be reported accurately.

## Baseline and local connection

Verified before implementation on 2026-10-11:

- `git branch --show-current`: `feature-remove-supabase`.
- Last typecheck: exit 0 on 2026-10-11.
- `npm test -- --reporter=dot`: 997 passed, 4 failed, across 86 test files.
- Existing failures: `src/i18n/messages.test.ts`, catalogue parity for `pt.json` and `es.json` (six Contacts.importModal keys missing); `src/lib/dashboard/date-utils.test.ts`, the two `mondayIndex` tests using UTC date-only strings in a local timezone.
- `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` are not currently configured in `.env.local`.
- User reports PostgreSQL installed, database `omni_connect` created, and `uuid-ossp`/`pgcrypto` enabled. Previously observed service: `postgresql-x64-18`, running. Confirm current access before integration tests.

The user will enter database credentials privately into the local environment file after the example and bootstrap SQL exist. Unit implementation can proceed without secrets; actual database verification waits for working local connection strings. Never invent a successful local migration result.

## Task 1: PostgreSQL connection and migration tooling

**Create:** `src/lib/db/pool.ts`, `src/lib/db/transaction.ts`, `scripts/db-migrate.mjs`, `scripts/db-check.mjs`, `database/bootstrap.sql`, `database/migrations/001_identity.sql`, `database/migrations/002_domain.sql`.

**Modify:** `package.json`, `package-lock.json`, `.env.local.example`, `.gitignore`, `vitest.config.ts`.

**Test:** `src/lib/db/transaction.test.ts`, `src/lib/db/migrations.integration.test.ts`.

**Interfaces:** `getPool(): Pool`; `withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T>`; npm scripts `db:check`, `db:migrate`, `test:integration`.

- [ ] Write tests proving rollback, connection release on failure, migration history, rerun no-op, incompatible existing-schema rejection, and refusal to use the runtime role for migration ownership.
- [ ] Run the tests and observe missing implementation failures.
- [ ] Install locked compatible `pg`, `@types/pg`, Better Auth, and local development mail tooling needed by Task 2. Add server-only pool configuration with finite connection/time limits and actionable missing-variable errors.
- [ ] Add bootstrap SQL for distinct owner/runtime/background roles and ownership/grants. Generate reviewed standalone schema from domain requirements in existing SQL; do not use a runtime regex transformer against Supabase migrations.
- [ ] Add advisory locking, transactional migration history, checksums, rollback on failure, and schema preflight. Keep identity/domain schema creation compatible with the user-created database.
- [ ] Verify in an isolated test database: empty apply, rerun, intentional failure rollback, and restricted runtime role. Record actual `db:check` results for `omni_connect` when credentials are supplied.

## Task 2: Local authentication and atomic account provisioning

**Create:** `src/lib/auth/server.ts`, `src/lib/auth/client.ts`, `src/lib/auth/session.ts`, `src/lib/auth/provision-account.ts`, `src/lib/auth/email.ts`, `src/app/api/auth/[...all]/route.ts`, `database/migrations/003_accounts.sql`.

**Modify:** `src/hooks/use-auth.tsx`, `src/lib/auth/account.ts`, `src/middleware.ts` (replace with supported `src/proxy.ts`), `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/forgot-password/page.tsx`, `src/app/(auth)/reset-password/page.tsx`, existing auth callback handler, `src/components/settings/password-form.tsx`, `src/components/settings/sessions-card.tsx`, `src/components/settings/profile-form.tsx`, `src/app/join/[token]/page.tsx`.

**Test:** `src/lib/auth/session.integration.test.ts`, `src/lib/auth/provision-account.integration.test.ts`; adapt `src/lib/auth/account.test.ts` and middleware tests to the actual replacement behavior.

**Interfaces:** `requireSession(): Promise<AuthenticatedUser>`; `getCurrentAccount(): Promise<AccountContext>` retaining userId/accountId/role/account fields but replacing the Supabase client property with scoped data access; `provisionAccount(userId: string): Promise<void>` idempotent and transaction-safe.

- [ ] Write failing tests for signup producing a user/profile/owner account, duplicate-email rejection, password login, logout, expiry, global revocation, and provisioning rollback. Add concurrent provisioning and invalid-reset-token tests.
- [ ] Configure Better Auth with UUID identities and PostgreSQL-backed sessions in a separate identity schema; avoid collision with CRM `accounts` and authentication-provider account tables.
- [ ] Implement atomic or transactionally recoverable provisioning, cookie/session server validation, local email capture, and explicit production SMTP requirements for reset/verification delivery.
- [ ] Migrate auth screens/hooks/settings to the new client and remove the browser's dependence on Supabase JWTs. Keep API-key bearer authentication distinct from cookie authentication.
- [ ] Replace middleware tests with proxy tests covering protected pages, API failures, invitation redirect preservation, revoked sessions, and flows/notifications routes.
- [ ] Run task tests, typecheck, and the full suite; record pre-existing failures separately.

## Task 3: Account permissions, membership, and invitations

**Create:** `src/lib/db/context.ts`, `src/lib/db/accounts.ts`, `src/lib/db/invitations.ts`, `database/migrations/004_authorization.sql`.

**Modify:** `src/lib/account/members.ts`, `src/lib/auth/invitations.ts`, `src/lib/auth/api-context.ts`, `src/lib/api-keys/store.ts`, all existing routes under `src/app/api/account/` and `src/app/api/invitations/`.

**Test:** `src/lib/db/authorization.integration.test.ts`, `src/lib/db/invitations.integration.test.ts`, existing roles/invitations/API-context tests.

**Interfaces:** `withAccount<T>(context: AccountContext, work: (db: PoolClient) => Promise<T>): Promise<T>`; role-checked named operations for setMemberRole/removeMember/transferOwnership/createInvitation/peekInvitation/redeemInvitation.

- [ ] Write failing cross-account tests for all four roles, expired/already-redeemed invitations, ownership transfer, and last-owner protection.
- [ ] Implement transaction-local identity, restricted role grants/RLS as appropriate, and explicit separate background access; prove pool identity isolation.
- [ ] Port existing membership/invitation database-function semantics to reviewed PostgreSQL functions or named transactional repositories. Remove Supabase-managed auth helpers and role references.
- [ ] Migrate routes, API key lookup, and context types. Reject unauthorized access server-side, independent of UI visibility.
- [ ] Run integration tests with two accounts and the existing permission tests.

## Task 4: Contacts, dashboard, pipelines, and settings APIs

**Create:** `src/lib/db/contacts.ts`, `src/lib/db/dashboard.ts`, `src/lib/db/pipelines.ts`, `src/lib/db/settings.ts`, `src/lib/api/client.ts`, named routes under `src/app/api/contacts/`, `src/app/api/dashboard/`, `src/app/api/pipelines/`, and `src/app/api/settings/`.

**Modify:** `src/lib/dashboard/queries.ts`, `src/lib/contacts/{dedupe,tag-write,resolve-import-tags,tag-api}.ts`, dashboard/contacts/pipelines pages, `src/components/contacts/`, `src/components/pipelines/`, tag/custom-field/deals-settings components, existing quick-reply routes.

**Test:** `src/lib/db/contacts.integration.test.ts`, `src/lib/db/pipelines.integration.test.ts`, `src/lib/db/dashboard.integration.test.ts`, existing contact CSV/dedupe/tag and dashboard tests.

**Interfaces:** typed, named CRUD/list operations returning existing domain types from `src/types/index.ts`; pagination/filter DTOs shared by routes and browser client.

- [ ] Write failing tests for CRUD, pagination/search/tag filtering, contact phone deduplication, custom fields, contact deletion references, pipeline stage order, deal movement, and account-scoped dashboard aggregates.
- [ ] Implement parameterized SQL, whitelisted sort/filter fields, maximum page sizes, and atomic bulk-import operations. No browser-controlled SQL fragments.
- [ ] Migrate browser queries and JWT/session lookups to same-origin typed operations and cookie authentication. Preserve application UX and validation messages.
- [ ] Run task tests and full suite. Record the exact changed screens in the progress document.

## Task 5: Inbox, WhatsApp webhook, sends, templates, and public API

**Create:** `src/lib/db/conversations.ts`, `src/lib/db/messages.ts`, `src/lib/db/whatsapp.ts`, `src/lib/db/templates.ts`, named inbox/message routes, `database/migrations/005_messaging.sql`.

**Modify:** `src/lib/inbox/conversations.ts`, `src/lib/conversations/reopen.ts`, `src/lib/whatsapp/{send-message,resolve-conversation,template-webhook}.ts`, webhook/config/send/react/media/template routes, inbox components/page, `src/lib/api/v1/{contacts,conversations}.ts`, all public v1 message/conversation/contact routes.

**Test:** `src/lib/db/messages.integration.test.ts`, existing webhook/send/resolve-conversation/template/public-API tests.

- [ ] Write failing tests for scoped conversation/message reads, message history paging, idempotent inbound delivery, reply context/reactions, failed-send persistence, template lifecycle, and API-key scope/account rejection.
- [ ] Replace service-role clients with explicit server repositories. Preserve signature verification and deduplication before any automation/flow dispatch.
- [ ] Port transactional conversation reopen, unread-counter, and message-status update semantics. Preserve WABA and phone-number ownership checks.
- [ ] Migrate browser inbox reads and sends to named endpoints, retaining existing external REST contracts.
- [ ] Run task tests with fake Meta HTTP boundaries and real local SQL; reserve actual phone testing for Task 10.

## Task 6: Broadcasts, automations, and flows

**Create:** `src/lib/db/broadcasts.ts`, `src/lib/db/automations.ts`, `src/lib/db/flows.ts`, `database/migrations/006_workflows.sql`.

**Modify:** `src/lib/whatsapp/{broadcast-core,broadcast-resume}.ts`, `src/lib/automations/{engine,steps-tree,meta-send}.ts`, `src/lib/flows/{engine,meta-send}.ts`, corresponding API routes/pages/builders, `src/hooks/use-broadcast-sending.ts`; delete superseded admin-client modules after consumers are migrated.

**Test:** `src/lib/db/workflows.integration.test.ts`, existing automation/flow dispatch/engine and broadcast atomicity/retry tests.

- [ ] Write failing tests for atomic broadcast parent/recipient creation, status counters/resume, concurrent flow starts, execution-count updates, capture/resume of customer input, and due wait-step claiming.
- [ ] Replace RPCs and query chains with named transactional functions; lock/claim records without holding database locks during Meta HTTP calls.
- [ ] Preserve tenant isolation and duplicate-delivery behavior under concurrent webhooks. Ensure cron routes retain their secret checks.
- [ ] Migrate builder/list screens and run history. Run integration and existing workflow suites.

## Task 7: AI knowledge, notifications, and outbound webhooks

**Create:** `src/lib/db/ai.ts`, `src/lib/db/notifications.ts`, `src/lib/db/webhooks.ts`, `database/migrations/007_ai_notifications.sql`.

**Modify:** `src/lib/ai/{config,usage,context,knowledge,auto-reply}.ts`, AI routes/settings, `src/lib/webhooks/{endpoints,deliver}.ts`, notifications page/hooks, v1 outbound-webhook routes.

**Test:** `src/lib/db/ai.integration.test.ts`, existing AI/notification/webhook tests.

- [ ] Write failing tests for AI reply slot claims/caps, knowledge FTS retrieval, account isolation, notification ownership, and outbound webhook failure counters.
- [ ] Implement named repositories and full-text SQL. Make semantic search an explicit optional extension migration; missing pgvector must preserve working FTS without pretending semantic search succeeded.
- [ ] Keep encrypted provider keys, SSRF checks, webhook signing, and retry semantics. Delete the superseded AI admin client.
- [ ] Run domain tests and integration coverage; record external AI calls as unverified unless tested with configured credentials.

## Task 8: Filesystem uploads and media

**Create:** `src/lib/storage/filesystem.ts`, `src/lib/storage/access.ts`, `src/app/api/uploads/[bucket]/route.ts`, `src/app/media/[...path]/route.ts`, storage metadata migration if required.

**Modify:** `src/lib/storage/upload-media.ts`, `src/lib/whatsapp/mirror-inbound-media.ts`, profile upload and flow-media components, media URL handling, `.gitignore`.

**Test:** `src/lib/storage/filesystem.test.ts`, `src/lib/storage/access.integration.test.ts`, existing media-upload/mirroring tests.

**Interfaces:** upload/delete/read operations consume a validated bucket, object ID, and account context; storage filesystem paths remain private. Public URLs come from configured public origin, never an untrusted Host header.

- [ ] Write failing tests for traversal/encoded traversal, foreign account deletion, symlink escape, oversized/disallowed files, collision handling, failed-upload cleanup, and publicly fetchable intended media.
- [ ] Implement bucket allow-lists and ownership metadata, safe streamed uploads, durable files outside `.next`, and controlled public/private serving. Meta can fetch intended public media without a CRM session; private content remains protected.
- [ ] Update browser/server storage consumers and voice/document previews. Verify local file operations and mirrored inbound-media fallback.

## Task 9: Polling and presence

**Create:** `src/hooks/use-polling.ts`, `src/lib/db/presence.ts`, named polling/presence routes, relevant shared polling DTOs.

**Modify:** `src/hooks/use-realtime.ts`, `src/hooks/use-presence.ts`, `src/hooks/use-total-unread.ts`, `src/hooks/use-unread-notifications.ts`, `src/hooks/use-browser-notifications.ts`, `src/components/presence/presence-heartbeat.tsx`, reaction subscriptions in `src/components/inbox/message-thread.tsx`, notifications page.

**Test:** `src/hooks/use-polling.test.ts`, `src/lib/db/presence.integration.test.ts`, polling DTO/reconciliation tests.

- [ ] Write failing fake-timer tests for updates, out-of-order response rejection, request cancellation, unmount cleanup, tab visibility, changed accounts, and duplicate message reconciliation.
- [ ] Poll visible active inbox/reaction data every 3 seconds and summaries/presence every 10 seconds. Pause hidden-tab polling and refresh immediately on focus; never overlap requests.
- [ ] Derive account identity from the session on all polling endpoints; return bounded account-specific changes/snapshots with no shared cache.
- [ ] Verify notifications do not replay on initial snapshot and existing unread/presence semantics remain intact.

## Task 10: Remove Supabase and verify the full application

**Modify:** package/lockfile, `next.config.ts`, environment examples, README, local setup docs, Docker/CI configuration, `feature-remove-supabase.md`; remove `src/lib/supabase/` and runtime Supabase imports/types.

**Create:** `scripts/check-no-supabase.mjs`, local standalone PostgreSQL schema assertions, end-to-end test coverage for the main CRM journey.

- [ ] Add a failing dependency/source audit that rejects runtime Supabase imports, required Supabase environment variables, and Supabase endpoint use. Historical reference SQL is excluded and clearly archived.
- [ ] Remove `@supabase/ssr` and `@supabase/supabase-js`; replace CSP/media/network rules and build/CI placeholders with actual local setup. Include ngrok-free.dev in relevant dev-origin configuration if needed by local verification.
- [ ] Add documented local role/bootstrap, private environment configuration, migration commands, development mail, backup, and first-user/WhatsApp setup instructions.
- [ ] Verify fresh migrations and rerun against an isolated test database; verify the user's existing database only with confirmed local credentials. Never reset it without explicit authorization.
- [ ] Run dependency audit, `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. Report baseline failures by name; do not call a failing full suite passing.
- [ ] Run with Supabase variables absent: signup/login, dashboard, contacts, pipeline deal, upload, inbound webhook, automatic inbox update, and reply. Test real WhatsApp only when configured; mock-only coverage must be labelled.
- [ ] Perform one independent whole-change review, fix material findings with tests, and update the branch log with exact verified behavior and any remaining limitations.

## Handoff

Design approved by the user on 2026-10-11. This document is the newly written implementation plan, ready for review. Recommended execution is inline in this session, keeping the branch-specific Markdown log current. No application code or dependency changes have been made at this planning stage.
