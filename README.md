# WACRM � local PostgreSQL branch

WhatsApp CRM with a shared inbox, contacts, sales pipelines, broadcasts, flows, automations and optional AI assistance. This branch replaces Supabase with PostgreSQL, Better Auth, local file storage and same-origin APIs.

**Start here:** [Local setup](LOCAL_SETUP.md). Your configured database is **omni_connect**. The branch is **feature-remove-supabase**.

~~~powershell
npm run db:check
npm run db:migrate
npm run dev
~~~

Open http://localhost:3000, sign up for a new local account, then run npm run jobs in another terminal. See local setup for ngrok and WhatsApp configuration. Supabase accounts, SDKs, hosted storage and realtime services are no longer required.

## Documentation

- [Connection/bootstrap/migrations](database/README.md)
- [Migration status and resume instructions](MIGRATION_RESUME.md)
- [Branch change record](feature-remove-supabase.md)
- [Approved design](LOCAL_POSTGRES_MIGRATION.md)
- [Docker](docs/docker.md)

## Verification

~~~powershell
npm run check:no-supabase
npm test -- --reporter=dot
npm run typecheck
npm run lint
npm run build
~~~

Tests use embedded PostgreSQL for isolation and schema checks. Live WhatsApp and AI require your own provider configuration; tests do not send customer messages. Historical upstream design reports and supabase/migrations describe the original architecture and are not local installation instructions.

Based on the MIT-licensed [ArnasDon/wacrm](https://github.com/ArnasDon/wacrm) project by Arnas Donauskas. See [LICENSE](LICENSE).
