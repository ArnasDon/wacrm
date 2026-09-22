# Running with Docker

The repo ships a multi-stage `Dockerfile` (Next.js standalone output,
runs as a non-root user) and a `docker-compose.yml` with a single
`app` service. Supabase is external — point the app at your hosted
(or self-hosted) Supabase project via env vars; no database container
is included.

## Quick start

1. Copy the env template and fill it in:

   ```bash
   cp .env.local.example .env.local
   ```

2. Build and start (the `--env-file` flag is required — Compose only
   reads `.env` by default for `${VAR}` substitution, and this project
   keeps its config in `.env.local`):

   ```bash
   docker compose --env-file .env.local up --build -d
   ```

3. The app is served on [http://localhost:3000](http://localhost:3000)
   (publish it elsewhere with `HOST_PORT=8080` in `.env.local`).

> Use `HOST_PORT`, not `PORT`, to move the published port. `PORT` is
> what the server listens on _inside_ the container, and `env_file`
> would inject it there — leaving the app on a port the mapping and
> the healthcheck don't target. Compose pins it to 3000 for that
> reason.

## Build-time vs runtime variables

- `NEXT_PUBLIC_*` variables are **inlined into the client bundle at
  build time**. They are passed as Docker build args by
  `docker-compose.yml`. If you change any of them, rebuild:
  `docker compose --env-file .env.local up --build -d`.
- Everything else (`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`,
  `META_APP_SECRET`, …) is read at **runtime** from `.env.local` via
  `env_file` and is never baked into the image — safe to change with
  just a container restart.

## Plain Docker (no Compose)

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -t wacrm .

docker run -d --env-file .env.local -e PORT=3000 -p 3000:3000 wacrm
```

## Notes

> This page covers running the image **locally**. For a production
> install (Docker Swarm, Traefik, the scheduler, the Evolution gateway),
> follow [`INSTALACAO.md`](./INSTALACAO.md).

- Database migrations under `supabase/migrations/` are **not** run by
  the container — apply them as described in
  [`INSTALACAO.md`, step 1.2](./INSTALACAO.md#12-aplicar-as-migrations).
- Received attachments are copied into the `chat-media` Supabase
  Storage bucket: the providers delete media after a while (Meta about
  30 days after it arrives), and the copy is the only thing that
  outlives that. It grows with inbound volume, so it's worth watching
  your project's storage quota. There is no screen to turn it off.
  Files over 50 MiB (the bucket's limit) are never copied.
- Nothing inside the container is scheduled. Point an external
  scheduler at the seven cron routes of this deployment, sending the
  shared secret in the `x-cron-secret` header (`AUTOMATION_CRON_SECRET`,
  see `.env.local.example`): `GET /api/automations/cron` every ~15 s,
  and `/api/cb/scheduled/cron`, `/api/flows/cron`, `/api/cb/radar/cron`,
  `/api/cb/meta-ads/cron`, `/api/cb/tldv/cron` and `/api/cb/asaas/cron`
  every 15 min. Every one of them returns 503 until that variable is
  set. The production scheduler is described in
  [`INSTALACAO.md`, step 5.4](./INSTALACAO.md#54-o-agendador-não-é-opcional).
