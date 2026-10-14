# Local PostgreSQL migration proposal

Prepared 2026-10-10. Branch: `feature-remove-supabase`.

Updated 2026-10-11: the user installed PostgreSQL, created `omni_connect`, and enabled `uuid-ossp` and `pgcrypto`. The local database will start empty; copying existing data is deferred. Repository inspected and branch created. Application migration has NOT been implemented. Existing working-tree changes were preserved. See `feature-remove-supabase.md` for the progress log.

## Intended outcome

Run the current WhatsApp CRM on this Windows computer with a local PostgreSQL database and no required Supabase service, SDK, API keys, authentication service, realtime service, or storage service. Keep a path to deploying the same application and database on a server later. Hosting selection and DigitalOcean provisioning are outside this local migration.

Current inspection found 110 Supabase-related source files, including 91 production files. Supabase is used for browser and server queries, account isolation, login and password management, database functions, file uploads, presence, notifications, and live inbox events. A DATABASE_URL change alone cannot replace it.

## Approaches

1. Recommended: plain PostgreSQL, server-owned data APIs, a maintained authentication library, filesystem uploads, and polling for updates. This removes Supabase entirely and keeps the initial infrastructure small. It requires migrating existing direct browser database calls and account permissions carefully.
2. Plain PostgreSQL plus PostgREST and separate auth/storage/event services. This preserves more of the current query style, but adds multiple services to install and operate.
3. Self-host Supabase locally. This reduces application changes but retains the Supabase dependency, so it does not meet the requested end state.

## Proposed design

### Database and authorization

- Use the installed PostgreSQL 18 server (`postgresql-x64-18`, verified running on 2026-10-11). The original Supabase configuration targeted 17; verify adapted SQL against the installed version rather than reinstalling 17.
- Database name `omni_connect` (already created); separate migration owner and restricted runtime database roles.
- Use the `pg` driver exclusively on the server and parameterized SQL. Never expose database credentials to the browser.
- Introduce named data operations behind authenticated Next.js route handlers/server functions. Do not expose an arbitrary SQL or unrestricted table-query endpoint.
- Preserve existing account ownership and owner/admin/agent/viewer rules. Resolve identity from the server session, never from a browser-supplied user/account ID alone.
- Where row-level security is retained, set session identity transaction-locally and use a non-bypass runtime role. Background webhook/automation operations use a separate explicit privileged path, scoped to their resolved account.
- Create independent versioned local migrations and a migration runner with a history table and transactions where supported. Adapt the current domain schema and database functions; do not blindly replay Supabase-specific SQL against an empty PostgreSQL server.
- Replace references to managed `auth.users`, managed storage schemas and policies, Supabase roles, and realtime publications. Preserve domain relationships, indexes, trigger behavior, enums, and required functions.
- Preserve full-text knowledge search. Semantic/vector search needs a tested local pgvector installation; if unavailable, clearly report semantic search as unavailable and use the existing full-text fallback.

### Login and sessions

- Proposed library: Better Auth, which supports PostgreSQL and Next.js directly.
- Configure UUID user identifiers compatible with existing domain foreign keys.
- Database-backed sessions with HTTP-only cookies; server-side authorization on every protected operation.
- Preserve email/password signup, sign-in, sign-out, session revocation, profile changes, team membership, and invitations.
- Account/profile creation must be atomic with user provisioning, or recoverable without silently leaving a user unlinked.
- Password resets and email verification require email delivery configuration. Provide a development-only local mail capture option; never return reset tokens from public endpoints or log them in production.
- Confirmed: start empty and create fresh local users. Existing Supabase data/user migration is deferred.

### Uploads and live updates

- Store uploaded files in a configured local directory using bucket-like namespaces for avatars, flow media, and chat media.
- Enforce account ownership, file size/type rules, and safe paths on the server. Use controlled public URLs for media that Meta must fetch.
- Keep upload storage outside build output and document backups for later deployment.
- Replace Supabase channels with authenticated polling initially. Refresh inbox messages, conversations, unread counts, notifications, reactions, and presence without a manual reload. Document the refresh interval and test that updates converge without duplicate messages.
- Preserve existing Meta webhook signature verification, credential encryption, automation/flow behavior, and public CRM API authentication.

## Local installation steps

These steps describe the intended setup. The existing application still requires Supabase until the code migration is complete.

1. Install PostgreSQL 17 using the [Windows installer linked by PostgreSQL](https://www.postgresql.org/download/windows/). Select PostgreSQL Server, command-line tools, and optionally pgAdmin. Use port 5432 if available, set a strong administrator password, and keep the server local to this computer.
2. Confirm the Windows PostgreSQL service is running. With the default install path, check the tools:

   ```powershell
   & 'C:\Program Files\PostgreSQL\17\bin\psql.exe' --version
   & 'C:\Program Files\PostgreSQL\17\bin\pg_isready.exe' -h localhost -p 5432
   ```

3. The `omni_connect` database already exists. Connect as the administrator using SQL Shell/pgAdmin or `psql -h localhost -U postgres -d omni_connect`. The implementation will supply documented role/bootstrap SQL for the migration owner and restricted runtime role. Set role passwords interactively rather than putting real passwords into committed scripts.
4. Configure a local environment file with server-only connection strings for the runtime and migration roles, auth secret/base URL, upload directory, and existing Meta settings. Keep the current `ENCRYPTION_KEY` if migrating encrypted credentials. Do not overwrite the existing Supabase configuration before the new setup is tested.

   Intended configuration shape, with deliberately fake credentials:

   ```dotenv
   DATABASE_URL=postgresql://omni_app:REPLACE_PASSWORD@localhost:5432/omni_connect
   MIGRATION_DATABASE_URL=postgresql://omni_owner:REPLACE_PASSWORD@localhost:5432/omni_connect
   BETTER_AUTH_SECRET=REPLACE_WITH_RANDOM_SECRET
   BETTER_AUTH_URL=http://localhost:3000
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   UPLOAD_DIR=./local-data/uploads
   ```

   URL-encode password characters when using a connection string. None of the database/auth secrets should use a NEXT_PUBLIC prefix.

5. Install the migrated application's locked dependencies and run its local migration command. That command will be added during implementation; do not use Supabase CLI for the new standalone schema.
6. Start with `npm run dev`, create a local CRM user, and verify dashboard and contact CRUD.
7. Start ngrok for port 3000 when testing WhatsApp. Update Meta to the actual current HTTPS callback URL ending in `/api/whatsapp/webhook`; do not assume the previous tunnel is still active.
8. Verify an inbound WhatsApp message appears automatically and a CRM reply reaches the phone. Re-save WhatsApp settings if this is a fresh local database.

## Implementation sequence after design approval

1. Capture the current test baseline and add real PostgreSQL integration coverage for account isolation, sessions, and domain migrations.
2. Add local schema/migration tooling, database configuration, and the authorization foundation.
3. Replace Supabase authentication and migrate account/profile/team/invitation operations.
4. Migrate data access module by module, including RPC-backed operations, public API, webhook, automations, flows, broadcasts, AI, and browser screens.
5. Replace storage, realtime notifications, and presence.
6. Remove Supabase packages, runtime configuration, obsolete CI/setup paths, and update documentation. Keep any historical SQL needed as migration reference clearly separated from the new local migrations.
7. Run tests, typecheck, lint, production build, and local end-to-end checks. Report any unavailable credentials/services rather than declaring untested features working.

## Completion criteria

- The app starts and operates with Supabase environment variables absent and without contacting Supabase endpoints.
- Fresh migrations create a usable schema; a second run applies nothing again.
- Signup/login/logout/reset and account/profile creation work; expired and revoked sessions are rejected.
- Cross-account reads/writes, uploads, and API access are rejected by tests.
- CRM CRUD, team permissions, pipelines, broadcasts, flows/automations, and required database functions remain usable.
- WhatsApp inbound/outbound traffic and automatic UI refresh work locally through a current public tunnel.
- File uploads/downloads work with ownership checks; Meta can fetch intended public media URLs.
- No runtime Supabase SDK imports or required Supabase secrets remain.
- Tests and production checks pass, with any optional external features explicitly recorded as unverified.

## Confirmed data decision

Start with an empty local database, as confirmed by the user on 2026-10-11. No existing contacts, messages, users, or WhatsApp settings will be copied in this migration. No remote data will be deleted. Create fresh local accounts and configure WhatsApp again after migration.

This is a proposal for review, not a completed implementation. The brainstorming workflow requires reviewing the design before application code and dependency changes begin.

References: [Better Auth PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql), [Better Auth Next.js integration](https://better-auth.com/docs/integrations/next). The installed Next.js authentication and route-handler guides were also inspected.
