# Deploying the SDR worker (SDR-7)

The SDR runs in a **separate long-running process** — not the web app. It
consumes the BullMQ `sdr` queue (Redis), qualifies leads with an LLM, and
replies on the conversation's channel. On Easypanel this is a second
**service** that runs the *same image/repo* as the web app, with a
different start command.

## Why a separate service

The web app is request/response; the SDR is async (debounce, batching,
LLM latency, audio transcription). A dedicated worker scales independently
and never blocks a web request. Same code, same image — only the command
differs (`npm run worker`).

## Prerequisites

- A reachable **Redis** instance (the same one is fine for app + worker).
- The web app already deployed (channels configured, ENCRYPTION_KEY set).

> ⚠️ **The web app is the queue _producer_ — it also needs `REDIS_URL`.**
> The inbound webhook enqueues the SDR job; if `REDIS_URL` is missing on the
> web service the enqueue fails silently (`maybeEnqueueSdr` swallows the error
> on purpose so a Redis hiccup never breaks inbound), so **no job is ever
> created and the worker stays idle**. Set the *same* `REDIS_URL` on **both**
> the web service and the worker service, pointing at the same Redis.

## Steps (Easypanel)

1. **New service** in the same project (`crm_zenith`). Source = the **same
   repo/branch** as the web app (`mcpiantella/wacrm`, `main`).
2. **Build**: same Dockerfile as the web app (no change needed).
3. **Start command**: override to `npm run worker`.
   - (The Dockerfile's default CMD starts the web server; the worker
     service overrides it to run `tsx src/worker/sdr-worker.ts`.)
4. **Environment variables** — set these on the worker service:

   | Var | Value | Notes |
   |-----|-------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://raqfuattunokpbozdhkc.supabase.co` | same as web |
   | `SUPABASE_SERVICE_ROLE_KEY` | (Supabase → Settings → API) | service-role; bypasses RLS |
   | `ENCRYPTION_KEY` | **EXACTLY the web app's value** | ⚠️ if it differs, the worker can't decrypt channel credentials and every send fails |
   | `REDIS_URL` | `redis://…:6379` | the queue backend |
   | `OPENAI_API_KEY` | `sk-…` | primary LLM + transcription |
   | `ANTHROPIC_API_KEY` | `sk-ant-…` | optional fallback |
   | `OPENAI_MODEL` | `gpt-5-mini` | optional (default) |
   | `TRANSCRIBER` / `TRANSCRIBE_MODEL` | — | optional (defaults: openai / gpt-4o-mini-transcribe) |
   | `SDR_WORKER_CONCURRENCY` | `5` | optional |

5. **Deploy** and watch the logs. On success you'll see:
   `[sdr-worker] ready, listening on queue: sdr`

## Verifying

The worker only acts on a conversation whose `sdr_status = 'active'` and
whose campaign has an **enabled** `sdr_config`. To smoke-test end to end:

1. Create an `sdr_config` (enabled) for a broadcast.
2. Set a conversation's `sdr_status = 'active'` and `broadcast_id` to that
   broadcast.
3. Send an inbound message to that conversation (or enqueue manually).
4. Within the debounce window the worker logs a line and an
   `sdr_runs` row appears (`action = reply | handoff | noop`). A `reply`
   also sends a WhatsApp message and inserts a `bot` message.

> Until the campaign UI (SDR-8) lands, activation is done via the
> dashboard SDR controls or directly in the DB for testing.

## Operational notes

- **Same ENCRYPTION_KEY** as the web app is non-negotiable (see table).
- The worker is stateless; scale by running more replicas — BullMQ hands
  each job to exactly one consumer, and the per-conversation `jobId`
  keeps debounce correct across replicas.
- Failures are caught per job and written as `sdr_runs.action = 'error'`;
  a bad job never crashes the loop.
