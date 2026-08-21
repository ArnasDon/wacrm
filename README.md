# Rimula Community Growth Platform

> Internal platform for the Rimula community — WhatsApp announcements,
> content localization, products & compatibility, and the commercial
> funnel from customer request through lead, trial, and conversion.
> Forked from [wacrm](https://github.com/ArnasDon/wacrm), a
> self-hostable WhatsApp CRM template — see [Origin](#origin) below.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![CI](https://github.com/Shehryar92/wacrm/actions/workflows/ci.yml/badge.svg)](https://github.com/Shehryar92/wacrm/actions/workflows/ci.yml)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)

## The funnel

```
CONTENT → LOCALIZATION → APPROVAL → DISTRIBUTION → ENGAGEMENT →
CUSTOMER REQUEST → LEAD → BA ASSIGNMENT → TRIAL → CONVERSION → ANALYTICS
```

Community members, WhatsApp announcements, content creation with
manual bilingual localization (Urdu/Pashto/Punjabi/Roman Urdu),
products and verified vehicle compatibility, customer requests routed
to Business Advisors, trials, conversions, and funnel analytics — see
[`docs/RIMULA_BUILD_SPEC.md`](./docs/RIMULA_BUILD_SPEC.md) for the
full product spec and
[`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) for
what's built, phase by phase.

## What's built

- **Shared inbox** on the official WhatsApp Business Cloud API, plus a
  **Demo Mode** (`DemoWhatsAppService`) that simulates the entire send
  → deliver → read → reply → convert pipeline with **zero Meta
  credentials** — the whole funnel is exercisable end to end without a
  live WhatsApp Business account.
- **Members** (contacts extended with role/region/market/vehicle/
  opt-in status) and **Business Advisors** (region/market/capacity/
  languages) — see `docs/DATA_MODEL.md`.
- **Content Studio** — create → upload media → write copy → manual
  bilingual localization (RTL-aware for Urdu/Pashto/Punjabi) →
  BA-recorded voice notes → review → approve → schedule/publish, with
  a cron-drain scheduler (see [Scheduled jobs](#scheduled-jobs-cron)).
- **Products & compatibility** — catalogue, approved claims,
  admin-verified vehicle compatibility, and an architected (stubbed
  pending real Meta Commerce credentials) WhatsApp catalogue sync —
  see `docs/WHATSAPP_FEASIBILITY.md`.
- **Requests → Leads → BA routing → Trials → Conversions** —
  `LeadRoutingService` (Market BA → Regional BA → Unassigned,
  configurable strategy), campaigns with cost/cost-per-lead
  attribution, and a funnel dashboard computed entirely from real
  seeded/live rows — never a fabricated number.
- **Reports** — campaign and product performance, side by side.
- **No-code automations** and a visual **Flows** builder — triggers,
  conditions, waits, tags, webhooks.
- **AI reply assistant** — bring your own OpenAI or Anthropic key
  (stored encrypted). AI-drafted replies, an optional auto-reply bot
  with a per-conversation cap, and a knowledge-base-grounded product
  Q&A that hands off to a human rather than guessing.
- **Team accounts** — role-based access (owner/admin/agent/viewer),
  every table account-scoped with RLS via `is_account_member(...)`.
- **Public REST API** (`/api/v1`) with scoped, revocable API keys —
  see [docs/public-api.md](./docs/public-api.md).
- **MCP server** — drive the platform from Claude, Cursor, and other
  AI assistants over the
  [Model Context Protocol](https://modelcontextprotocol.io). See
  [docs/mcp.md](./docs/mcp.md).

## Quick start

```bash
git clone https://github.com/Shehryar92/wacrm.git
cd wacrm
npm install
cp .env.local.example .env.local   # fill in Supabase creds; Meta creds optional (Demo Mode needs none)
npm run dev
```

Open <http://localhost:3000>. You'll be redirected to `/login` (or
`/dashboard` if already signed in).

Apply `supabase/migrations/*.sql` (in order) against your Supabase
project, then seed a full demo dataset — 844 Members across 20
markets, products, campaigns, requests, leads, trials, and
conversions:

```bash
npm run db:seed
```

Prefer containers? See [docs/docker.md](./docs/docker.md) for the
Dockerfile + Docker Compose setup.

## Scheduled jobs (cron)

Three endpoints do periodic background work and nothing in this repo
calls them on its own — each is a plain `GET` route guarded by a
shared secret, meant to be hit on an interval by something external:

| Endpoint | Drains |
|---|---|
| `GET /api/automations/cron` | Pending Wait-step executions |
| `GET /api/flows/cron` | Timed-out Flow runs |
| `GET /api/content/cron` | Due Content Studio scheduled posts (§10) — this is also what actually sends a post scheduled "now"; there's no separate synchronous send path |

All three read the same `AUTOMATION_CRON_SECRET` (`.env.local`) and
expect it on the `x-cron-secret` request header, compared in constant
time. A request with a missing/wrong secret gets a `401`; with the env
var unset entirely, a `503`.

**Local development:** nothing triggers these while `npm run dev` is
running — call them yourself when you want to see a scheduled post (or
a Wait step, or a Flow timeout) actually resolve:

```bash
curl -H "x-cron-secret: $AUTOMATION_CRON_SECRET" http://localhost:3000/api/content/cron
curl -H "x-cron-secret: $AUTOMATION_CRON_SECRET" http://localhost:3000/api/flows/cron
curl -H "x-cron-secret: $AUTOMATION_CRON_SECRET" http://localhost:3000/api/automations/cron
```

(`$AUTOMATION_CRON_SECRET` here is your shell picking the value up from
`.env.local` if you've exported it — e.g. `export $(grep AUTOMATION_CRON_SECRET .env.local)` —
or just paste the value in directly.)

**Production:** point a real scheduler at all three URLs, on whatever
interval fits (every 1–5 minutes is plenty — a "scheduled for now"
Content Studio post is picked up on the next tick, not instantly).
None of this repo's cron mechanism is platform-specific:

- **Vercel** — a [Vercel Cron Job](https://vercel.com/docs/cron-jobs)
  per endpoint (`vercel.json`'s `crons` array), each configured to
  send the `x-cron-secret` header.
- Any host with real cron/SSH access — a crontab entry running the
  same `curl` command above against your production domain.
- **Anywhere** — an external scheduled pinger (GitHub Actions
  `on: schedule`, a cron-as-a-service like cron-job.org, etc.) hitting
  the same URLs with the header set.

## Documentation

- [`docs/RIMULA_BUILD_SPEC.md`](./docs/RIMULA_BUILD_SPEC.md) — the
  product spec this platform is built against.
- [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) —
  what's reused as-is, extended, and net-new, phase by phase.
- [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md) — the full schema map.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system
  architecture.
- [`docs/WHATSAPP_FEASIBILITY.md`](./docs/WHATSAPP_FEASIBILITY.md) —
  verified current Meta WhatsApp Business Platform capabilities.
- [`docs/API.md`](./docs/API.md) — internal + public API surface.
- [`docs/public-api.md`](./docs/public-api.md) — the public `/api/v1`
  REST API reference.
- [`docs/mcp.md`](./docs/mcp.md) — the MCP server.
- [`docs/docker.md`](./docs/docker.md) — container deployment.

## Stack

- **App** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4.
- **Data** — Supabase (Postgres + Auth + Storage + RLS).
- **WhatsApp** — Meta Cloud API (official WhatsApp Business Platform)
  in production; a fully simulated `DemoWhatsAppService` behind the
  same interface for zero-credential development and demos.

## Origin

This platform is a fork of [`ArnasDon/wacrm`](https://github.com/ArnasDon/wacrm)
(MIT-licensed) — a self-hostable WhatsApp CRM template that already
provided the shared inbox, contacts, pipelines, broadcasts,
automations, Flows builder, AI assistant, multi-tenant accounts,
public API, and MCP server this platform builds the Rimula-specific
funnel on top of. See its
[`CONTRIBUTING.md`](https://github.com/ArnasDon/wacrm/blob/main/CONTRIBUTING.md)
for the upstream project's own contribution model if you're looking
to fork *this* fork.

## License

[MIT](./LICENSE).
