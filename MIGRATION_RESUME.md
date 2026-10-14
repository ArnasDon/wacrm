# Resume Supabase removal

Workspace: `D:\PyCharm-Projects\omni-connect-ai`
Branch: `feature-remove-supabase`
Goal: complete running CRM using local PostgreSQL `omni_connect`, empty initial data, replacement local authentication. Preserve Meta/encryption secrets and existing user changes. Do not touch hosted data.

## Read first

1. `feature-remove-supabase.md` — implementation and verification history.
2. `docs/superpowers/plans/2026-10-11-remove-supabase.md` — approved implementation plan.
3. `database/README.md` — local roles, environment and schema instructions.
4. `AGENTS.md` and relevant installed Next.js docs before changes.


## Latest continuation — native public API and inbound WhatsApp (2026-10-11)

Public contact/conversation/message/me routes now use explicit API-key account/scope validation and native SQL worker transactions, without impersonating a human session. The shared outgoing send service has separate dashboard and API-key authorization adapters. Public API repository tests: 3 passed; native send tests: 8 passed.

Webhook management GET/POST/GET-id/PATCH/DELETE and outbound delivery now use account-scoped native SQL. Added atomic failure increments/auto-disable and secret-free management projections. WhatsApp inbound route now uses local verification tokens, contact/BSUID resolution, conversation creation, idempotent message inserts with atomic unread/reopen/reply tracking, scoped reactions, forward-only status updates, and WABA-scoped template event updates/stubs. Media mirroring writes deterministic local files and PostgreSQL metadata; media proxy requires an inbox reference in the caller account and uses private caching.

Verification: 10 targeted webhook/inbound/storage tests passed (4 files). Typecheck passed before the last media proxy change; rerun it next. No live Meta message was sent. Actual local migrations remain 001–006, unchanged. No new SQL migration needed for this checkpoint.

Remaining: migrate flow and automation engines/routes/UI, AI features, broadcasts/public broadcast API, browser notifications; remove old Supabase helpers/dependencies/environment references; production build/full regression/browser/live Meta checks. Legacy helper files and old tests remain until their callers are migrated. Update all older setup/progress docs at final cleanup. Keep working on feature-remove-supabase.
## Historical checkpoints (superseded by latest continuation)

Interruption recovery and send verification: restored `src/app/api/v1/messages/route.ts` from its checksum-verified Git blob after an interrupted rewrite had deleted it. The public route remains legacy and is not migrated yet; do not attribute a cookie session or impersonate an account owner to authorize API-key requests. `requireLocalApiKey` was added but has no migrated callers yet. Continue public API migration using explicit trusted server SQL with API-key account/scope checks.

Added `send-message-local.integration.test.ts` using real embedded PostgreSQL and mocked Meta boundaries. Observed three failures (stale agent role, missing service validation, unsafe/ambiguous post-send persistence failure), fixed them, then all seven tests passed. Typecheck passed. The send service now checks the current agent role before Meta, validates its own inputs, reports accepted-but-unsaved messages safely, and upgrades legacy tokens through the worker with a compare-and-set so it cannot overwrite a newly saved credential. Live Meta behavior is still unverified.

Latest consolidated status: actual local PostgreSQL migrations 001 through 006 are applied; all four application role connections passed. Local authentication, contacts/import/tags/notes/custom fields, pipelines/deals, dashboard, account settings, presence/notifications, filesystem uploads, WhatsApp configuration, and inbox reads/polling have local implementations. Latest typecheck passed; selected lint had zero errors and seven warnings.

Latest continuation: dashboard WhatsApp send, agent reactions, and template submit/edit/delete/sync routes now use local PostgreSQL with account and role checks. Meta calls run outside SQL transactions; sent messages and conversation previews persist atomically. Verification: `npm run typecheck`, selected ESLint (0 errors), and a second local HTTP smoke (`node .cache/smoke-local-http.mjs`) all passed. The smoke creates then removes a temporary user/account and does not send an external Meta message. Current grep audit still finds about 78 production files referencing Supabase/auth-role contexts (the count includes indirect legacy contexts), so SDK removal is still ahead.

Local HTTP smoke passed for signup/session, migrated APIs, dashboard/contacts/pipelines/settings/inbox/notifications pages, and upload/public media retrieval without a session. Temporary smoke account and records were removed. Evidence: `.cache/local-http-smoke-results.json`. This does not verify real outbound/inbound WhatsApp messaging or every browser interaction.

Remaining: inbound webhook/media mirroring, public API, broadcasts, automations/flows, AI/outbound webhooks, remaining browser notifications, SDK/environment cleanup, production build and complete regression/end-to-end verification. Real Meta send/reaction/template behavior still needs a live credentials check. Older entries below are historical checkpoints; this consolidated entry supersedes their pending/already-completed items.

Migration is incomplete. Authentication, database foundation, account/member/invitation/API-key management, most contacts, notes and custom fields have local implementations. Some downstream features still use legacy Supabase contexts.

Latest additions: local tag settings repository/API/UI and bounded CSV import repository/API/UI. Tag isolation test passed (1); import duplicate/invalid-phone/tag test passed (1). Latest typecheck passed after the import UI migration. CSV import uses up to 200 rows per request, per-row savepoints and server-derived ownership; imported tag links intentionally preserve prior behavior (no automation dispatch).

Last audit before tag settings change: 75 production files imported Supabase. SDKs remain installed. Main remaining work: CSV import; pipelines/dashboard/settings; inbox/WhatsApp/webhooks; public API; broadcasts/automations/flows; AI; filesystem media; notifications/presence/polling; remove SDKs; full build and end-to-end checks.

## Database blocker and next action

PostgreSQL 18 service is running. User supplied administrator credentials and authorized connection/bootstrap. Connected successfully; inspected public/identity schemas (zero tables). Created the four application roles with random separate passwords and saved connection URLs plus missing Better Auth settings privately in gitignored `.env.local`. Temporary bootstrap script containing the supplied credential was deleted. Never print or commit credentials.

`npm run db:check` connected successfully using all four role URLs. `npm run db:migrate` applied 001_identity.sql, 002_domain.sql, and 003_function_permissions.sql successfully to the actual installed PostgreSQL database. Do not rerun bootstrap or rotate roles. Next: verify migration idempotency/schema and continue domain code migration. Add new SQL migrations for future changes; never edit applied migration contents.

Actual local schema migration is now complete through 003. Full CRM Supabase removal remains incomplete.

## Verification and tooling

Latest WhatsApp/inbox checkpoint: migrated config repository and health/save/reset/registration routes, config UI and settings overview. Config uniqueness/isolation integration test passed (1); typecheck passed; selected ESLint zero errors/two dependency warnings. Added inbox conversation/message/reaction repository and named read/update APIs; inbox tenant/assignee integration test passed (1). Inbox page/list/thread/sidebar/template picker now use local APIs, and thread/reactions poll every 3s. Realtime hook now uses local snapshot events; initial-backlog suppression/event-diff test passed (1). Message sending, reactions POST, inbound webhook/media mirroring, template CRUD/sync/submit remain legacy. Recent template-manager read migration and sidebar tag mapping fix need fresh typecheck/lint.

Migration 006 applied successfully; all four actual database role connections passed again. Profile email-error typing was corrected after typecheck found an optional error message. Typecheck subsequently passed during WhatsApp config migration. Scratch `.cache`, `local-data`, `.superpowers` are excluded from TypeScript compilation so backup sources cannot affect final SDK removal.

Latest storage/profile checkpoint: added and applied 005_local_storage.sql (metadata/RLS). Local filesystem and ownership tests passed (3). Added streamed upload/delete endpoints and public/private metadata-aware media route; browser upload helper and profile avatars now use it. Stored file root is `local-data/uploads` on D: unless LOCAL_STORAGE_ROOT is set. Configure APP_PUBLIC_URL to the current public ngrok origin for Meta to fetch outbound attachments; fallback BETTER_AUTH_URL is localhost (local previews only).

Added 006_identity_profile_sync.sql and Better Auth verified email-change mail/configuration. Auth lifecycle/mail suite passed (9), including email not changing before verification and profile synchronization after it. Profile form uses Better Auth updateUser/changeEmail. Migration 006 application and latest profile typecheck pending at checkpoint. Inbound media mirroring is still legacy and will be migrated with the webhook.

Latest presence/notification checkpoint: added `004_presence_permissions.sql` and applied it successfully to actual local PostgreSQL. Added scoped member-status repository and `/api/presence`, `/api/notifications`, `/api/unread-counts`; integration test passed (1). Replaced presence heartbeat/read hook and sidebar unread hooks with local APIs/polling. Notification page now polls local API and marks own notifications read through it. Polling core test passed (1): no overlap, hidden pause, abort and suppress results after stop. Typecheck and selected ESLint passed after these changes. Remaining realtime hook/browser message notifications are still legacy and depend on inbox migration. Poll intervals currently counts/notifications 5s, presence 15s; adjust to approved plan's 10s summaries/presence during final consolidation.

Broader local domain regression run (before member-status changes): 36 tests passed in 15 files. See `.cache/local-domain-checks.log`. Current SQL migrations are 001–004; do not edit applied files.

Latest dashboard work: added native metrics, messages, pipeline totals and activity queries and named API; retained browser-side day/weekday aggregation to preserve user timezone behavior. Dashboard account-isolation integration test passed (1); typecheck passed after migrating queries and page. Account currency UI is migrated too. Broader local-domain test run is in `.cache/local-domain-checks.log` (check completion before claiming results).

Additional completed code: pipeline repository/API/UI (board, settings), deals repository/API/UI with related-record ownership validation and private profile projection, and account default-currency endpoint/UI. Pipeline and deal integration tests each passed (1), typecheck passed after all pipeline/deal UI rewrites. Selected ESLint: zero errors, one unused-directive warning. Currency change requires next typecheck. Actual schema inspection: 37 public tables and 4 identity tables; runtime/auth roles are not superusers and cannot bypass RLS.

Last full suite log `.cache/migration-tests-latest.log`: 1031 passed, 4 baseline failures (catalogue keys and timezone date tests). Later changes require fresh checks.

Use `npm test -- <target> --reporter=dot` and `npm run typecheck`. D-drive temp/cache is configured by test launcher. `.cache` and `local-data` are gitignored.

Git executable was unavailable at its old path; `.git/HEAD` confirms the feature branch. No implementation commits were made by the agent. Check current Git availability and working changes before any staging. Preserve pre-existing changes listed in the main progress log.

Resume prompt: “Read MIGRATION_RESUME.md and feature-remove-supabase.md, then continue the approved migration until the CRM runs on local PostgreSQL. Keep these status files current. Do not repeat completed work or ask for plan approval again.”

## Flow runner continuation (2026-10-11)

Migrated flows/meta-send.ts and automations/meta-send.ts to shared local worker sends. Bot/AI attribution is persisted and bot replies do not pause active flows as agent interventions. Native send integration suite: 10 passed. AI typing credentials now load from local PostgreSQL; auto-reply still needs full migration.

Migrated flows/engine.ts to named account-scoped FlowStore SQL operations. Added local tag writer with ownership/deduplication checks. Flow store integration tests: 2 passed. Real local flow dispatcher integration: keyword -> collect order number -> interpolated reply -> completed passed. Existing flow behavior tests were adapted to named repository mocks; combined flow tests: 37 passed. Flow-store + local-dispatch + AI auto-reply tests: 20 passed. Typecheck passed. Selected lint had zero errors and one unused import warning, subsequently removed.

The flow runner persistence and send path are local; flow management APIs, cron, builder UI and all automation engine persistence are still pending. Existing legacy flow/tag/admin helper files remain until cleanup. No live Meta traffic was generated by tests. Next: automations engine SQL migration, then management APIs/UI/cron, broadcasts and AI.

## Automation and flow management continuation (2026-10-11)

Automation engine now uses account-scoped AutomationStore SQL for matching, logs, branching, waits, custom/contact fields, assignment, deals, closing threads and resume. Native local engine integration passed (contact update, result log, scheduled wait, foreign-account refusal). Existing automation behavior tests adapted to repository boundary; combined 26 passed. Flow CRUD, template gallery, activation and runs APIs now use local auth/account SQL; graph saves are transactional. Flow CRUD rollback/isolation integration passed. Latest typecheck passed.

Broader regression audit: .cache/migration-tests-current.log � 1037 passed / 35 failed in 117 files at that snapshot. Four failures are the known catalogue/timezone baseline; remaining failures are old WhatsApp send/webhook route tests still mocking Supabase rather than the new local repositories. These need migration and rerun; do not claim the full suite passes. Subsequent flow CRUD changes are not included in that run. No live Meta calls or hosted data changes.

Next: finish flow/automation management UI/APIs and cron; migrate broadcasts and AI; update route tests to native fixtures, remove SDK/helpers/env references, production build and full HTTP/browser verification. Main project remains incomplete.

## Management and scheduled jobs checkpoint (2026-10-11)

Flow and automation management APIs, automation list/logs/builder resource reads, and both cron endpoints now use local PostgreSQL. Nested automation save/copy rollback/isolation integration passed (1). Wait claiming uses one SKIP LOCKED statement; resume and timeout audit tests passed (combined 5 tests). Latest typecheck passed; selected lint had zero errors, two warnings subsequently addressed (logs dependency and missing manual-trigger response return). Expanded actual PostgreSQL HTTP smoke passed for flow CRUD/activation/runs and automation CRUD/copy/logs/manual-trigger plus all prior pages/storage. Temporary smoke records removed. No live Meta sends.

Remaining broad areas: AI persistence and routes, broadcasts (including public API/UI), quick replies, browser notifications, old WhatsApp route tests, SDK/helper/environment/docs cleanup, final build/full verification/review. Full suite remains at the earlier recorded 35 failures until route mocks are migrated; newer selected tests pass. Resume here; next task is AI data/service migration. Do not repeat bootstrap or rewrite applied SQL001�006.

## AI, quick replies and notifications checkpoint (2026-10-11)

Quick reply CRUD now uses local account-scoped SQL; text/interactive switching validation integration passed. Browser notifications now poll the local inbox API (including hidden tabs), with initial-backlog suppression and 10-second snapshot polling. Notification/poll tests: 27 passed. AI config/decryption, conversation context, usage, knowledge ingest/retrieval and auto-reply persistence now use native SQL. AI routes (config/test/draft/playground/usage/knowledge/reindex/takeover) use local sessions with membership/role rechecks; external provider calls hold no SQL transaction. Knowledge embeds to real[] and ranks cosine similarity in plain PostgreSQL; keyword fallback remains available. Document index replacement is transactional and refuses stale content. AI tests: 68 passed in 11 files. Typecheck passed before the account_role correction; rerun next. Expanded actual PostgreSQL HTTP smoke passed including quick reply CRUD and knowledge create/edit/reindex/delete. Temporary records removed; no live Meta or AI-provider calls made.

Remaining: broadcasts/public broadcast API/UI; migrate old WhatsApp route tests; remove unused Supabase helpers, SDKs, environment/CSP/CI references; consolidate setup docs; full suite, production build and final review. Existing full-suite failures recorded above remain unverified. Applied migrations still 001-006, unchanged. Latest implementation adds no SQL migration. Continue from broadcast migration; do not repeat database bootstrap.

## Consolidation checkpoint � 2026-10-11

All CRM domains now use local PostgreSQL: auth/accounts, contacts/tags, pipelines/deals, inbox/WhatsApp, templates, broadcasts/public API, flows, automations, quick replies, AI and notifications. Supabase SDKs and unused clients/helpers were removed from package/lockfile and runtime source. The no-Supabase source/dependency audit passes; obsolete environment keys have been removed privately. Original hosted SQL remains historical only. CI, Docker, CSP, environment example and local setup docs updated. Local jobs launcher added for waits/timeouts; cron secret configured privately.

Production build passed before final polish. Full suite at the last broad run: 985 passed / 4 baseline failures; those four were subsequently fixed (six pt/es translation keys and timezone-safe date-test fixtures). New inbound-media tests passed; final full rerun remains required. Two additional regression tests failed first and now pass: every broadcast recipient invalid, and BSUID phone backfill collision. Combined edge suite: 19/19. Lint initially found scratch files and a migration helper named like a React hook; exclusions/helper rename fixed, rerun pending. Independent final review underway. Application is NOT declared finished until final suite/typecheck/lint/build, runtime smoke and review fixes are complete.

Removed mock-only tests accompanied removal of unused Supabase-specific modules (legacy account/API context, contact tag events/writes, conversation reopen, WhatsApp template webhook/conversation resolution/send helpers). Their local replacements are exercised by native auth/context/contact/inbound/send/template/worker integration tests. Legacy mirror upload mocks were replaced by local mirror/storage tests; legacy query-builder dedupe/lookup tests were replaced by SQL isolation tests. Test-count changes must not be described as all original tests retained.

Ruling: broadcasts deliver server-side and the UI polls campaign status rather than sending from the browser � required to remove direct browser database writes; campaign replies become visible via polling.
Ruling: when BSUID and phone identify different contacts, preserve the known BSUID thread and leave its phone blank rather than silently merge customer records � avoids losing an inbound message; manual deduplication may be needed.

Resume: read this checkpoint first, then latest later entries. Do not repeat role bootstrap, change applied migrations 001�006, reset the database, or touch the hosted project. Current branch feature-remove-supabase; changes are not agent-committed.
