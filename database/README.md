# Local PostgreSQL setup

Target database: **omni_connect**. This is a fresh local setup; no hosted data is imported or deleted.

## This installation

On 2026-10-11, local PostgreSQL 18 roles and private connection strings were configured and migrations **001�006** were applied successfully. A rerun reports Database is up to date. Do not repeat bootstrap on this computer. All four role connections passed. Use [LOCAL_SETUP.md](../LOCAL_SETUP.md) to start the application; final verification status is in [MIGRATION_RESUME.md](../MIGRATION_RESUME.md).

The following bootstrap instructions are for a **new installation**, not an additional step for the current database.

## Prepare roles

In pgAdmin, select the existing `omni_connect` database and open Query Tool as `postgres`. Open and execute [bootstrap.sql](./bootstrap.sql). It creates roles only; it does not drop a database/table or assign a shared example password.

Set a different password privately for each login in pgAdmin's Login/Group Roles → Properties → Definition, or use SQL Shell (`psql`):

```text
\password omni_owner
\password omni_app
\password omni_auth
\password omni_worker
```

Role purposes:

| Role | Purpose |
| --- | --- |
| omni_owner | Schema migrations; owns domain and identity objects. |
| omni_app | User-scoped data queries, with row-level security. |
| omni_auth | Authentication users, sessions, and password credentials only. |
| omni_worker | Trusted background processing; bypasses row security. Never exposed to the browser. |

## Private environment configuration

Add these to `.env.local` using your own passwords. URL-encode special characters in passwords. Keep the existing encryption and Meta secrets unchanged. Do not post the resulting strings in chat or commit them.

```dotenv
DATABASE_URL=postgresql://omni_app:REPLACE_PASSWORD@localhost:5432/omni_connect
AUTH_DATABASE_URL=postgresql://omni_auth:REPLACE_PASSWORD@localhost:5432/omni_connect
WORKER_DATABASE_URL=postgresql://omni_worker:REPLACE_PASSWORD@localhost:5432/omni_connect
MIGRATION_DATABASE_URL=postgresql://omni_owner:REPLACE_PASSWORD@localhost:5432/omni_connect
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
```

For initial administrator verification only, `MIGRATION_DATABASE_URL` can use `postgres`; the runner switches to `omni_owner` before creating schema objects. Never use `postgres` or `omni_worker` as DATABASE_URL.

## Check connections

```powershell
npm run db:check
```

This reports configured connection outcomes and role names without printing connection strings. It rejects a superuser or RLS-bypassing runtime role. It does not create tables.

## Apply standalone migrations

```powershell
npm run db:migrate
```

The runner uses a dedicated connection and advisory lock, applies each file in a transaction, records a SHA-256 checksum, and refuses changed/missing applied files. It refuses an unmanaged existing domain schema instead of dropping or silently adopting tables. Keep original SQL unchanged after application; add a new migration for later changes.

SQL in `database/migrations/` is standalone, checked-in PostgreSQL SQL. The runner does not read or transform `supabase/migrations/`. Managed storage/realtime objects have been removed, identity references use local identity tables, and UUID defaults use PostgreSQL's built-in generator. Full-text knowledge search is retained; pgvector semantic search is not enabled in the base schema.

## Tests

```powershell
npm run test:integration
npm run typecheck
```

Integration tests use embedded PostgreSQL for repeatable schema/RLS/transaction checks without reading production credentials. The test launcher uses project-local temporary storage and a single worker. Actual omni_connect connections have also been verified using private local configuration.

## Authentication mail

During `npm run dev`, reset emails are captured in gitignored `local-data/mail/*.json`. Open the newest file locally to follow its reset link. Treat these files as private credentials. Production requires `SMTP_URL` and a valid `SMTP_FROM`; reset mail is never silently captured in production. Local signup currently creates a session immediately, with no email-verification requirement.
