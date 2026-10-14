# Removal of Supabase dependency

Branch: `feature-remove-supabase`

Last updated: 2026-10-11

## Goal and confirmed decisions

Run this CRM locally using PostgreSQL without Supabase services. Preserve the current CRM and WhatsApp features. Decide on server hosting later.

- Local database: `omni_connect`.
- Start empty. Existing Supabase data can be copied separately later.
- The user reports that PostgreSQL is installed, the database opens in pgAdmin 4, and `uuid-ossp` and `pgcrypto` were enabled.
- Create fresh local CRM accounts once the replacement authentication and schema are ready.
- Preserve the existing hosted project and local secret configuration during development.

## Completed work

- [x] Created and verified branch `feature-remove-supabase`.
- [x] Inspected database, authentication, storage, realtime, and RPC dependencies.
- [x] Identified 91 production files that import Supabase packages or local Supabase modules at the initial inspection.
- [x] Read the installed Next.js authentication and route-handler documentation.
- [x] Prepared `LOCAL_POSTGRES_MIGRATION.md` with the proposed architecture, setup, migration sequence, and acceptance criteria.
- [x] Updated the proposal to use the existing `omni_connect` database and the confirmed empty-database approach.
- [x] Created this branch-specific progress document.

## Proposed implementation

1. Add standalone PostgreSQL schema migrations, a tracked migration runner, and a server-only connection pool.
2. Replace Supabase authentication with Better Auth and PostgreSQL-backed sessions; preserve account provisioning and role checks.
3. Replace direct browser database calls with authenticated application endpoints and migrate server queries/RPC functions.
4. Replace Supabase Storage with local filesystem uploads and account ownership checks.
5. Replace Supabase realtime subscriptions with authenticated polling for inbox, notifications, reactions, and presence.
6. Remove runtime Supabase dependencies and configuration after replacements work.
7. Verify local schema creation, migration reruns, authentication, permissions, CRM operations, uploads, and WhatsApp message flow.

Detailed design: [LOCAL_POSTGRES_MIGRATION.md](./LOCAL_POSTGRES_MIGRATION.md).

## Current status and next step

Implementation is in progress. Authentication and several domain screens/endpoints have been migrated, while remaining CRM handlers still use Supabase. **This is an intermediate branch, not a runnable completed cutover.** Do not restart it expecting all CRM functions to work yet. The original Supabase SQL must not be replayed blindly into `omni_connect`.

The user approved PostgreSQL + Better Auth + local file storage + polling and the detailed implementation plan on 2026-10-11. Implementation continues inline using the executing-plans skill. Plan: [docs/superpowers/plans/2026-10-11-remove-supabase.md](./docs/superpowers/plans/2026-10-11-remove-supabase.md).

No database credentials are stored in this document. Local connection variables were missing at the last check; actual `omni_connect` verification waits for the user to configure them privately.

## Implemented foundation (2026-10-11)

- Added server-only `pg` pools for domain, authentication, and background work, with connection and statement timeouts.
- Added bootstrap roles, standalone identity/domain migrations, checksum/history tracking, advisory locking, transactional rollback, and rejection of unmanaged existing CRM tables.
- Verified standalone schema creation, owner provisioning, account RLS, blocked privilege escalation, and identity-table isolation using embedded PostgreSQL.
- Added Better Auth configuration, local API handler, same-origin client, server session validation, and local development reset-email capture under `local-data/mail` (gitignored).
- Migrated login/signup/forgot-password, added the previously missing reset-password page, migrated password/session controls, invitation-page authentication, and replaced the auth hook's profile lookups with a named local API.
- Replaced deprecated Next.js middleware with the supported proxy convention. Preserved refreshed cookies, invitation destinations, API-key/webhook/cron exceptions, and protected flows/notifications paths.
- Verified signup/login, duplicate emails, wrong passwords, logout, expiry, global revocation, invalid reset tokens, password reset, and rollback when account provisioning fails.
- Added transaction-local identity and account-context resolution; verified cross-account denial and identity cleanup after rollback.
- Added explicit function grants in `003_function_permissions.sql` after a test demonstrated that PostgreSQL's default PUBLIC EXECUTE exposed worker-only security-definer helpers.
- Migrated membership, ownership transfer, invitation, account rename, and API-key management endpoints to named local repositories. API-key lookup/revocation/expiry now use PostgreSQL; public API domain handlers are still pending.
- Added contacts CRUD/search/pagination/tag/duplicate-check repositories and APIs; migrated the contacts list and form. Tag writes use local SQL and retain their automation dispatch after commit; the automation engine itself remains pending.
- Added custom field, contact value, and note repositories/APIs with account ownership checks and atomic custom-value replacement. Migrated the custom-field manager and contact detail view (including deal summaries); CSV import remains pending.
- Added same-origin mutation checks, server-derived account identity, role enforcement, bounded inputs, and no-store responses for local domain APIs.
- Verified pooled-connection release after failed requests, migration-owner enforcement, and rejection of partial unmanaged schemas beyond the original five core tables.

Ruling: account provisioning uses the database's identity-insert trigger rather than a second application-level provisioning call. This keeps user/profile/account creation atomic; failure aborts signup. A redundant second provisioner would risk duplicate accounts.

Ruling: an extra authentication database role (`omni_auth`) isolates password/session tables from domain queries. Four private connection strings are therefore required instead of sharing the runtime connection.

Ruling: use D: project-local npm cache and test temporary storage because C: was full. Embedded PostgreSQL tests use 128 MB initial memory and one worker. No PostgreSQL installation, user files, or Windows pagefile has been moved.

Ruling: security hardening is a separate numbered migration so function privileges are explicit and reviewable. Future functions must receive explicit grants; default PUBLIC EXECUTE is revoked for owner-created public functions.

Ruling: preflight conservatively refuses any non-extension public table when no migration history exists. This covers incomplete schemas without silently adopting incompatible objects. Unrelated user tables may therefore need explicit review before migration.

Ruling: keep the existing automation dispatch after contact-tag commits while migrating its database backend later. This intermediate branch remains incomplete and must not be treated as a working deployment.

Git tooling note: the previously installed Git executable is no longer available at its recorded path. `.git/HEAD` still identifies `feature-remove-supabase`; no branch switch or commit has been performed in this continuation. A failed contacts-page rewrite was recovered from a checksum-verified local Git blob and reapplied; typecheck then passed.

Remaining: CSV import, pipelines/dashboard/remaining settings, legacy server account/API-key contexts, inbox/WhatsApp/workflows/AI repositories, filesystem media, and polling; then remove the Supabase SDK and perform end-to-end verification.

## Verification log

- Branch check: `git branch --show-current` returned `feature-remove-supabase` on 2026-10-11.
- PostgreSQL service: `postgresql-x64-18` is running. Use the installed version 18; no downgrade to the originally suggested version 17 is needed.
- Baseline `npm run typecheck`: passed (exit code 0) on 2026-10-11.
- Baseline full suite on 2026-10-11: 997 tests passed, 4 failed. Two catalogue parity failures in `src/i18n/messages.test.ts` (`pt.json` and `es.json` each lack six Contacts.importModal keys); two timezone-sensitive `mondayIndex` failures in `src/lib/dashboard/date-utils.test.ts`. These existed before application migration code changes.
- No local schema migrations or data import have been run by the agent for this migration.
- No claim is made yet that the CRM works without Supabase.
- Foundation tests before auth additions: 13 passed in 5 files; typecheck passed.
- Latest schema/context/auth run: `npm test -- src/lib/db/schema.integration.test.ts src/lib/db/context.integration.test.ts src/lib/auth/session.integration.test.ts --reporter=dot` passed, 12 tests in 3 files.
- Full suite during this continuation: 1,024 passed, the same 4 baseline failures, across 95 files. Later added repository tests passed separately; another full run is needed after the remaining changes.
- Latest typecheck: passed after the contacts form and custom-field APIs were added.
- Targeted ESLint run: 0 errors, 2 warnings for existing full-page sign-out navigation in the auth hook.
- `npm run db:check`: all four database URLs remain unconfigured. No local application migrations have been applied.
- Latest combined migration checks: 40 tests passed across 13 files (database, auth lifecycle/mail, domain route authorization, proxy, and tag endpoint).
- Latest typecheck after contact detail migration: passed.
- Expanded ESLint run: 0 errors, 7 warnings (unused imports, the existing contact-form effect dependency, and deliberate full-page sign-out navigation).

## How this log will be maintained

### Continuation checkpoint

- Applied migration 006 locally and rechecked all four role connections successfully. Migrated WhatsApp config health/save/reset/registration routes and UI; config isolation/phone uniqueness test passed (1). Settings overview now uses native counts.
- Migrated inbox reads/status/assignment/read-reset APIs and UI. Inbox ownership/foreign-assignee test passed (1). Local snapshot diff/backlog test passed (1); active thread and reactions poll every 3 seconds. Outbound sends, reaction sends, inbound webhook and template CRUD/sync remain pending.
- Template picker and template-manager reads now use a local template listing endpoint. Latest sidebar tag mapping and template-manager changes need fresh verification.

- Added filesystem upload/delete/read services and metadata table/RLS in migration 005 (applied locally). Storage tests passed (3): traversal, bucket symlink escape, collision, oversized cleanup and account ownership. Browser attachment uploads now use the local API; inbound mirror still awaits webhook migration.
- Added verified email change support and identity-to-profile synchronization migration 006. Auth lifecycle/mail suite passed (9). Profile form now uses local auth and filesystem avatars. Latest typecheck and migration 006 application pending at this checkpoint.
- APP_PUBLIC_URL must be set to the current public tunnel origin for Meta to download outbound attachments. Local preview URLs fall back to BETTER_AUTH_URL; URLs are never derived from an untrusted request Host header.

- Applied new migration 004 to actual PostgreSQL for restricted presence function execution. Presence/notification repository integration test passed (1).
- Migrated presence heartbeat/read hook, sidebar unread hooks, and notifications page to local APIs/polling. Polling core test passed (1), covering overlap prevention, hidden-tab pause, abort and ignored late results. Typecheck and selected ESLint passed.
- Broader local-domain checks before member-status work: 36 tests passed across 15 files. Remaining browser message notifications and inbox realtime hook are still Supabase-dependent.

- Migrated dashboard to named account-scoped PostgreSQL endpoints; browser aggregation retains local timezone day/weekday behavior. Dashboard account-isolation integration test passed (1). Typecheck passed after dashboard/currency changes. Broader local-domain regression run started; results in `.cache/local-domain-checks.log`.

- Migrated pipeline board/settings and deal form to named PostgreSQL APIs. Pipeline creation atomically creates default stages and serializes empty-account seeding. Stage updates reject foreign/forged stage IDs; deal writes verify pipeline/stage/contact/assignee ownership. Both repository integration tests passed (1 each); typecheck passed. Selected ESLint reported zero errors and one unused-directive warning.
- Added admin-only account currency update API and migrated deal currency settings (verification pending).
- Actual PostgreSQL inspection: 37 public tables, 4 identity tables; application/auth roles cannot bypass RLS and are not superusers.

- Migrated CSV import to a bounded local API (200 rows per request); server-derived ownership, normalized duplicate handling, role-aware tag creation, and per-row savepoints prevent one bad row aborting the batch. Import UI now calls that API. Integration test passed (1), and typecheck passed after UI migration.
- Repeated actual migration command: â€œDatabase is up to date.â€ Applied migrations are now immutable.

- Database setup now completed: user provided administrator credentials and authorized connection. Verified `omni_connect` had zero public/identity tables before bootstrap. Created four application roles with separate generated passwords; saved private connection URLs and missing auth configuration in gitignored `.env.local`, preserving existing Meta/encryption settings.
- Actual `npm run db:check`: all four role connections passed. Actual `npm run db:migrate`: applied 001_identity.sql, 002_domain.sql, 003_function_permissions.sql successfully. Earlier entries saying credentials/migrations were pending are historical and superseded by this checkpoint. Never modify these applied SQL files; use new migrations.
- Deleted temporary bootstrap script containing the supplied administrator credential after setup.

- Added `MIGRATION_RESUME.md` as the first file to read in a new session, with plan links, pending work, database blocker, tooling notes, and a resume prompt.
- Migrated tag settings to named PostgreSQL list/create/delete operations and admin-only mutation APIs; replaced the tag-manager browser Supabase calls.
- Tag repository tenant-isolation integration test: 1 passed. Typecheck pending at this checkpoint.
- Fresh database check: all four connection URLs absent; PostgreSQL 18 service is running. User was asked to configure only the private administrator migration URL so the agent can bootstrap remaining roles/configuration. No actual local schema migration has run.
- Latest completed full-suite log: 1,031 passed, four known baseline failures. Subsequent changes still require final verification.

Record each implemented stage, changed components, verification commands/results, remaining blockers, and the next required local setup command here. Keep planned work distinct from completed work, and exclude secrets.
# Latest continuation â€” WhatsApp outbound path and template lifecycle

Follow-up verification/recovery: the interrupted public v1 message rewrite left its route absent. Restored the original route from its checksum-verified Git blob; public API migration remains pending. Added seven local send integration cases using embedded PostgreSQL and fake Meta calls. Three initially failed: stale agent permissions reached the send boundary, direct service callers could skip validation, and a Meta-accepted message with failed persistence had no safe domain error. Fixed all three and observed 7/7 passing, then typecheck passed. Legacy token upgrade now uses the worker and compares the old ciphertext before updating, preserving an admin's newer token. No real Meta message was sent.

Moved the dashboard outbound message endpoint and agent reaction endpoint to local PostgreSQL. The send path checks account membership/agent role, resolves conversation/contact/config/reply/template rows with account-scoped SQL, sends to Meta after closing the read transaction, then writes the message and conversation preview in one account transaction. Phone-variant retry, template payloads, media, interactive messages, replies, token CBC-to-GCM upgrade, and best-effort flow pause are retained. Agent reactions are mirrored in the local `message_reactions` table after Meta accepts them. Template sync and submit/edit/delete lifecycle routes now read/write the local database, with admin checks and Meta calls separated from database transactions.

Added shared send validation/types and a local send implementation. The older public v1 API send path still uses the legacy Supabase send core pending public API migration. Inbound webhook processing remains Supabase-backed. The current source scan reports roughly 78 production files referencing Supabase or legacy auth contexts (including indirect legacy contexts).

Verification at this checkpoint: `npm run typecheck` passed; ESLint on all changed send/reaction/template files had zero errors; the full local HTTP smoke passed against PostgreSQL and cleaned up its temporary account and records. No real Meta send was performed. The smoke log is `.cache/local-http-smoke-results.json`.

## Latest continuation — native public API and inbound WhatsApp (2026-10-11)

Public contact/conversation/message/me routes now use explicit API-key account/scope validation and native SQL worker transactions, without impersonating a human session. The shared outgoing send service has separate dashboard and API-key authorization adapters. Public API repository tests: 3 passed; native send tests: 8 passed.

Webhook management GET/POST/GET-id/PATCH/DELETE and outbound delivery now use account-scoped native SQL. Added atomic failure increments/auto-disable and secret-free management projections. WhatsApp inbound route now uses local verification tokens, contact/BSUID resolution, conversation creation, idempotent message inserts with atomic unread/reopen/reply tracking, scoped reactions, forward-only status updates, and WABA-scoped template event updates/stubs. Media mirroring writes deterministic local files and PostgreSQL metadata; media proxy requires an inbox reference in the caller account and uses private caching.

Verification: 10 targeted webhook/inbound/storage tests passed (4 files). Typecheck passed before the last media proxy change; rerun it next. No live Meta message was sent. Actual local migrations remain 001–006, unchanged. No new SQL migration needed for this checkpoint.

Remaining: migrate flow and automation engines/routes/UI, AI features, broadcasts/public broadcast API, browser notifications; remove old Supabase helpers/dependencies/environment references; production build/full regression/browser/live Meta checks. Legacy helper files and old tests remain until their callers are migrated. Update all older setup/progress docs at final cleanup. Keep working on feature-remove-supabase.

## Flow runner continuation (2026-10-11)

Migrated flows/meta-send.ts and automations/meta-send.ts to shared local worker sends. Bot/AI attribution is persisted and bot replies do not pause active flows as agent interventions. Native send integration suite: 10 passed. AI typing credentials now load from local PostgreSQL; auto-reply still needs full migration.

Migrated flows/engine.ts to named account-scoped FlowStore SQL operations. Added local tag writer with ownership/deduplication checks. Flow store integration tests: 2 passed. Real local flow dispatcher integration: keyword -> collect order number -> interpolated reply -> completed passed. Existing flow behavior tests were adapted to named repository mocks; combined flow tests: 37 passed. Flow-store + local-dispatch + AI auto-reply tests: 20 passed. Typecheck passed. Selected lint had zero errors and one unused import warning, subsequently removed.

The flow runner persistence and send path are local; flow management APIs, cron, builder UI and all automation engine persistence are still pending. Existing legacy flow/tag/admin helper files remain until cleanup. No live Meta traffic was generated by tests. Next: automations engine SQL migration, then management APIs/UI/cron, broadcasts and AI.

## Automation and flow management continuation (2026-10-11)

Automation engine now uses account-scoped AutomationStore SQL for matching, logs, branching, waits, custom/contact fields, assignment, deals, closing threads and resume. Native local engine integration passed (contact update, result log, scheduled wait, foreign-account refusal). Existing automation behavior tests adapted to repository boundary; combined 26 passed. Flow CRUD, template gallery, activation and runs APIs now use local auth/account SQL; graph saves are transactional. Flow CRUD rollback/isolation integration passed. Latest typecheck passed.

Broader regression audit: .cache/migration-tests-current.log — 1037 passed / 35 failed in 117 files at that snapshot. Four failures are the known catalogue/timezone baseline; remaining failures are old WhatsApp send/webhook route tests still mocking Supabase rather than the new local repositories. These need migration and rerun; do not claim the full suite passes. Subsequent flow CRUD changes are not included in that run. No live Meta calls or hosted data changes.

Next: finish flow/automation management UI/APIs and cron; migrate broadcasts and AI; update route tests to native fixtures, remove SDK/helpers/env references, production build and full HTTP/browser verification. Main project remains incomplete.

## Management and scheduled jobs checkpoint (2026-10-11)

Flow and automation management APIs, automation list/logs/builder resource reads, and both cron endpoints now use local PostgreSQL. Nested automation save/copy rollback/isolation integration passed (1). Wait claiming uses one SKIP LOCKED statement; resume and timeout audit tests passed (combined 5 tests). Latest typecheck passed; selected lint had zero errors, two warnings subsequently addressed (logs dependency and missing manual-trigger response return). Expanded actual PostgreSQL HTTP smoke passed for flow CRUD/activation/runs and automation CRUD/copy/logs/manual-trigger plus all prior pages/storage. Temporary smoke records removed. No live Meta sends.

Remaining broad areas: AI persistence and routes, broadcasts (including public API/UI), quick replies, browser notifications, old WhatsApp route tests, SDK/helper/environment/docs cleanup, final build/full verification/review. Full suite remains at the earlier recorded 35 failures until route mocks are migrated; newer selected tests pass. Resume here; next task is AI data/service migration. Do not repeat bootstrap or rewrite applied SQL001–006.

## AI, quick replies and notifications checkpoint (2026-10-11)

Quick reply CRUD now uses local account-scoped SQL; text/interactive switching validation integration passed. Browser notifications now poll the local inbox API (including hidden tabs), with initial-backlog suppression and 10-second snapshot polling. Notification/poll tests: 27 passed. AI config/decryption, conversation context, usage, knowledge ingest/retrieval and auto-reply persistence now use native SQL. AI routes (config/test/draft/playground/usage/knowledge/reindex/takeover) use local sessions with membership/role rechecks; external provider calls hold no SQL transaction. Knowledge embeds to real[] and ranks cosine similarity in plain PostgreSQL; keyword fallback remains available. Document index replacement is transactional and refuses stale content. AI tests: 68 passed in 11 files. Typecheck passed before the account_role correction; rerun next. Expanded actual PostgreSQL HTTP smoke passed including quick reply CRUD and knowledge create/edit/reindex/delete. Temporary records removed; no live Meta or AI-provider calls made.

Remaining: broadcasts/public broadcast API/UI; migrate old WhatsApp route tests; remove unused Supabase helpers, SDKs, environment/CSP/CI references; consolidate setup docs; full suite, production build and final review. Existing full-suite failures recorded above remain unverified. Applied migrations still 001-006, unchanged. Latest implementation adds no SQL migration. Continue from broadcast migration; do not repeat database bootstrap.

## Consolidation checkpoint ï¿½ 2026-10-11

All CRM domains now use local PostgreSQL: auth/accounts, contacts/tags, pipelines/deals, inbox/WhatsApp, templates, broadcasts/public API, flows, automations, quick replies, AI and notifications. Supabase SDKs and unused clients/helpers were removed from package/lockfile and runtime source. The no-Supabase source/dependency audit passes; obsolete environment keys have been removed privately. Original hosted SQL remains historical only. CI, Docker, CSP, environment example and local setup docs updated. Local jobs launcher added for waits/timeouts; cron secret configured privately.

Production build passed before final polish. Full suite at the last broad run: 985 passed / 4 baseline failures; those four were subsequently fixed (six pt/es translation keys and timezone-safe date-test fixtures). New inbound-media tests passed; final full rerun remains required. Two additional regression tests failed first and now pass: every broadcast recipient invalid, and BSUID phone backfill collision. Combined edge suite: 19/19. Lint initially found scratch files and a migration helper named like a React hook; exclusions/helper rename fixed, rerun pending. Independent final review underway. Application is NOT declared finished until final suite/typecheck/lint/build, runtime smoke and review fixes are complete.

Removed mock-only tests accompanied removal of unused Supabase-specific modules (legacy account/API context, contact tag events/writes, conversation reopen, WhatsApp template webhook/conversation resolution/send helpers). Their local replacements are exercised by native auth/context/contact/inbound/send/template/worker integration tests. Legacy mirror upload mocks were replaced by local mirror/storage tests; legacy query-builder dedupe/lookup tests were replaced by SQL isolation tests. Test-count changes must not be described as all original tests retained.

Ruling: broadcasts deliver server-side and the UI polls campaign status rather than sending from the browser ï¿½ required to remove direct browser database writes; campaign replies become visible via polling.
Ruling: when BSUID and phone identify different contacts, preserve the known BSUID thread and leave its phone blank rather than silently merge customer records ï¿½ avoids losing an inbound message; manual deduplication may be needed.

Resume: read this checkpoint first, then latest later entries. Do not repeat role bootstrap, change applied migrations 001ï¿½006, reset the database, or touch the hosted project. Current branch feature-remove-supabase; changes are not agent-committed.
