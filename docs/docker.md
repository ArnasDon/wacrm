# Docker with local PostgreSQL

Docker is optional. The verified Windows run instructions are in [LOCAL_SETUP.md](../LOCAL_SETUP.md).

The compose file builds the app, loads server secrets from .env.local, exposes port 3000, and persists uploads in the local-data named volume. PostgreSQL is external to this compose configuration.

For a container connecting to PostgreSQL installed on the host, replace localhost with host.docker.internal in all four database URLs in a private container environment file. PostgreSQL must accept that host connection with appropriate authentication. Keep migration-owner credentials available only for migration commands. Configure a public APP_PUBLIC_URL, BETTER_AUTH_URL, SMTP and Meta secrets for your deployment.

~~~powershell
docker compose --env-file .env.local up --build -d
~~~

Run migrations from the project checkout against the same database before starting. Run npm run jobs from the host with JOBS_BASE_URL=http://localhost:3000 and the matching cron secret, or configure a protected external scheduler for both /api/automations/cron and /api/flows/cron using x-cron-secret. Browser-public settings require rebuilding the image when changed.

Docker deployment itself was not exercised during the Windows migration. Back up the PostgreSQL database and the local-data volume independently. Never delete volumes as an upgrade step.
