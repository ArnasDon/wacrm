# Run locally with PostgreSQL

Branch: **feature-remove-supabase**. Database: **omni_connect** on your installed PostgreSQL 18. Existing hosted data has not been copied or changed.

## Your computer: setup already completed

The database roles, private connection strings in .env.local, Better Auth secret, encryption configuration, and SQL migrations 001�006 are configured. **Do not create another database, rerun bootstrap, or upload the old Supabase SQL files.** Future schema changes are applied in bulk with npm run db:migrate.

Open a terminal in D:/PyCharm-Projects/omni-connect-ai:

~~~powershell
npm run db:check
npm run db:migrate
npm run dev
~~~

Open http://localhost:3000 and create a new local account using Sign up. Your old Supabase login does not exist in this database. Signup creates your owner account and initial CRM defaults automatically. You can now create contacts, tags, pipelines/deals, flows, automations and knowledge documents.

Open a second terminal in the same folder and leave this running:

~~~powershell
npm run jobs
~~~

This calls the protected local automation-wait and flow-timeout endpoints approximately every minute. The private AUTOMATION_CRON_SECRET is already configured. Stop either terminal with Ctrl+C. PostgreSQL must remain running. A one-time job check is npm run jobs -- --once.

## WhatsApp connection

1. Run npx ngrok http 3000 while the application is running.
2. Set APP_PUBLIC_URL in .env.local to the current https ngrok origin, then restart the application. This origin is used for publicly fetchable attachment URLs. Keep BETTER_AUTH_URL=http://localhost:3000 while using the CRM through localhost.
3. Sign in locally, open Settings ? WhatsApp, and save your phone number ID, WABA ID, access token and webhook verify token. The empty local database needs this configuration again. Existing META_APP_SECRET and ENCRYPTION_KEY in .env.local have been preserved.
4. In Meta, use https://YOUR-NGROK-HOST/api/whatsapp/webhook as the callback, with the same verify token. Subscribe to messages and any template lifecycle events you need.
5. Send a message from your test recipient to the configured WhatsApp number. The inbox refreshes automatically; reply from the CRM. An ngrok URL is needed because Meta cannot reach localhost. A changed ngrok hostname must be updated in both places.

Live Meta sends and AI-provider requests have not been made during migration verification. Optional AI features need your per-account provider key in Settings. Knowledge search uses normal PostgreSQL full-text search and real[] embeddings; pgvector is unnecessary.

## Password reset and email changes

In development, email is saved privately under local-data/mail/*.json. Open the newest file locally to obtain the link; do not share these files. For production, configure SMTP_URL and SMTP_FROM. Production deliberately refuses to pretend an undelivered email was sent.

## Production-style local run

~~~powershell
npm run build
npm start
~~~

Run npm run jobs in a second terminal. Build may need internet access to download the project's Google Fonts. Production password reset/email changes require SMTP. For everyday local use, npm run dev provides the development mail capture.

## Files and backup

Uploads persist under local-data/uploads on D:, outside .next. Keep .env.local and local-data private. Back up omni_connect with pg_dump (PostgreSQL bin directory) or pgAdmin Backup, and back up local-data/uploads plus the encryption key separately. Retain the encryption key to read stored credentials. Do not commit secrets or backups.

## Resume migration work

Read MIGRATION_RESUME.md and feature-remove-supabase.md for the latest verified status. The approved design is LOCAL_POSTGRES_MIGRATION.md. Setup for a different computer is database/README.md. Historical supabase/migrations SQL is retained only as a reference and is not used by the application or migration runner.
