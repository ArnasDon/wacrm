# Running with Docker

The repo ships a multi-stage `Dockerfile` (Next.js standalone output, runs as a
non-root user) and a `docker-compose.yml` that brings up **Supabase autoalojado**
plus the wacrm fork — nine services in total (eight in Part 1; the `cron` service
arrives in BASE.1 Part 2).

`.env.local.example` is still the template for **`npm run dev`** without Docker —
it stays as it is. The Docker stack uses `.env` (generated from `.env.example`).

## Servicios y puertos

| Service             | Internal port       | Published on host     |
| ------------------- | ------------------- | --------------------- |
| `supabase-db`       | 5432                | — (R1: not published) |
| `supabase-kong`     | 8000                | `127.0.0.1:8000`      |
| `supabase-auth`     | 9999                | —                     |
| `supabase-rest`     | 3000 / 3001 (admin) | —                     |
| `supabase-realtime` | 4000                | —                     |
| `supabase-storage`  | 5000                | —                     |
| `supabase-meta`     | 8080                | —                     |
| `app`               | 3000                | `127.0.0.1:3000`      |

**R1 (BASE.1):** Postgres (ports 5432 and 6543) is never published on the host;
everything published binds to `127.0.0.1`. The public entry point arrives in
BASE.2 with an outbound tunnel.  
**R3 (BASE.1):** Every image is pinned to an exact version — no `:latest`.  
`npm test` (specifically `contracts/base/compose-services.publisher.test.ts`)
verifies both rules automatically against the live `docker-compose.yml`.

## Quick start (máquina limpia)

1. Generate the `.env` file with fresh secrets:

   ```bash
   cp .env.example .env
   npm run keys >> .env
   ```

   The last definition of each key wins, so the generated values (appended by
   `npm run keys`) override the placeholder markers from `.env.example`.

2. Start all services and wait until every healthcheck passes:

   ```bash
   docker compose up -d --wait
   ```

   On a clean machine this takes roughly 2–3 minutes for all services to reach
   _healthy_. Use `docker compose ps` to track progress.

3. Open [http://localhost:3000](http://localhost:3000).  
   Use `HOST_PORT=8080` in `.env` to publish the app on a different port.

> **Note on `--env-file`:** the old compose setup required `--env-file .env.local`.
> The new stack reads `.env` by default — no flag needed.

## Migraciones (primer arranque)

The `supabase/migrations/` files reference `auth.users`, which gotrue creates on
startup — _after_ the Postgres init scripts run. They cannot go in
`/docker-entrypoint-initdb.d`. After the first `docker compose up --wait`, apply
them manually:

```bash
docker compose exec -T supabase-db sh -c \
  'for f in /migrations/*.sql; do psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f "$f"; done'
```

The integration test (`scripts/compose/compose-up.it.test.ts`) applies them the same way before exercising the cron routes.

The `/migrations` bind-mount is already declared in `docker-compose.yml`.
CFG.1 can automate this step when it defines the per-tenant startup sequence.

## What does not publish and why

- **Postgres ports (5432, 6543):** never exposed on the host (R1). Access the
  database from other containers using the service name `supabase-db`.
- **Other Supabase internal services:** auth, REST, realtime, storage, and meta are
  reachable only from inside the Docker network. All external access goes through
  kong (`127.0.0.1:8000`).
- **Loopback binding:** the two published ports bind to `127.0.0.1`. BASE.2
  introduces the outbound tunnel that makes the stack reachable over the internet.

To run the integration test that verifies all of this on a clean machine:

```bash
COMPOSE_IT=1 npx vitest run scripts/compose/compose-up.it.test.ts
```

## Build-time vs runtime variables

- `NEXT_PUBLIC_*` variables are **inlined into the client bundle at build time**.
  They are forwarded as Docker build args by `docker-compose.yml`. If you change
  any of them, rebuild: `docker compose up --build -d`. This includes
  `NEXT_PUBLIC_APP_LOCALE` (`en | ko | pt | es`), so the UI language is fixed per
  image.
- Everything else (`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`,
  `META_APP_SECRET`, …) is read at **runtime** from `.env` via `env_file` and is
  never baked into the image — safe to change with just a container restart.

## Scheduled tasks (cron)

The `cron` service (a small `alpine` + `curl` image built from `docker/cron/`) calls two
endpoints of the `app` service from inside the compose network, on `CRON_SCHEDULE`
(default `*/5 * * * *`, set it in `.env`):

- `GET /api/automations/cron` — runs pending automation Wait steps
- `GET /api/flows/cron` — advances flow instances

Both require the `x-cron-secret` header, which the cron sends from `AUTOMATION_CRON_SECRET`.
That variable is mandatory: without it the endpoints answer 503. `npm run keys` generates it.

Watch the runs with `docker compose logs -f cron` (each line is `<path> <http code>`).
The container is `healthy` while `crond` is alive and the last run is under 15 minutes old.
The daily backup of BAK.1 will be added to this same cron.

## Plain Docker (no Compose)

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000 \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -t wacrm .

docker run -d --env-file .env -e PORT=3000 -p 127.0.0.1:3000:3000 wacrm
```
