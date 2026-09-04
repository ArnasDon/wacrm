# wacrm — WhatsApp + Email marketing platform

> One self-hosted platform for talking to your customers: a shared
> WhatsApp inbox, a CRM, email newsletters, and automations and flows
> that mix both channels. Your servers, your data, one login.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![CI](https://github.com/onlypromarketer/wacrm/actions/workflows/ci.yml/badge.svg)](https://github.com/onlypromarketer/wacrm/actions/workflows/ci.yml)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)

Maintained by [ProMarketer](https://github.com/onlypromarketer). Built on
the open-source [wacrm](https://github.com/ArnasDon/wacrm) CRM (MIT) and
the [listmonk](https://listmonk.app) email engine (AGPL-3.0, run as a
separate, unmodified service) — see [Credits](#credits).

## What it does

**WhatsApp**

- **Shared inbox** on the official WhatsApp Business API — a whole team
  on one number, with assignment, status, notes, voice notes and media.
- **Broadcasts** with Meta-approved templates, delivery and read
  tracking, per-recipient variables.
- **AI reply assistant** — bring your own OpenAI or Anthropic key,
  drafted replies, optional auto-reply bot, knowledge base.

**CRM**

- **Contacts** with tags, custom fields, CSV import, phone dedup.
- **Sales pipelines** (Kanban) with deals linked to conversations.
- **Team accounts** — invite by link, roles (owner / admin / agent /
  viewer), ownership transfer.
- **Real-time dashboard**, public REST API with scoped keys, and an MCP
  server for AI assistants.

**Email**

- **Campaigns** — compose, preview, test-send, send, track opens and
  clicks.
- **Mailing lists** — and a one-click **sync** that copies CRM contacts
  in as subscribers, carrying their WhatsApp number with them.
- **Templates** — reusable automation emails and newsletter layouts,
  with live preview.
- **SMTP settings** live in the app; there is no second admin panel.

**Automations & flows — across both channels**

The visual builders have WhatsApp steps *and* email steps side by side,
so one journey can do:

```
Trigger: new contact
  → Send WhatsApp message    "Thanks for reaching out!"
  → Add to Mailing List      Newsletter
  → Wait                     1 day
  → Send Email               "Your brochure" — personalised
```

Contacts without an email address are skipped, not failed.

## Quick start (local)

Prerequisites: Node 20+, Docker Desktop.

```bash
git clone https://github.com/onlypromarketer/wacrm.git
cd wacrm
npm install

# Local database, auth, storage and a mail catcher — all in Docker.
npx supabase start          # first run pulls images (a few minutes)

cp .env.local.example .env.local
# Paste the API URL, anon key and service_role key that `supabase start`
# printed, and generate ENCRYPTION_KEY as the file describes.

npm run dev
```

Open <http://localhost:3000>, sign up, and you're in.

For the **complete platform** — CRM plus the email engine — use the
Docker stack instead:

```bash
cd deploy
cp .env.example .env         # fill in
docker compose -f docker-compose.local.yml up -d --build
COMPOSE_FILE=docker-compose.local.yml sh setup-api-user.sh
docker compose -f docker-compose.local.yml up -d
```

Open <http://localhost:8090>. Full instructions, including how to test
email delivery locally without a real mail provider, are in
[`deploy/README.md`](./deploy/README.md).

## Deploying to a server

One VPS, one domain, one command. `deploy/docker-compose.yml` runs the
CRM, the email engine and a Caddy front door with automatic HTTPS;
Supabase is external (cloud free tier works).

Step-by-step: [`deploy/README.md`](./deploy/README.md).

What you need before going live:

1. A Supabase project with the migrations applied (`supabase db push`).
2. A Meta for Developers app with a WhatsApp Business number, and its
   app secret. The webhook URL is
   `https://<your-domain>/api/whatsapp/webhook`.
3. An email provider's SMTP credentials (Amazon SES, Postmark, Mailgun,
   Resend, …), entered under **Email → Settings**.
4. SPF, DKIM and DMARC records for your sending domain — the single most
   common reason email lands in spam.

## Stack

- **App** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4.
- **Data** — Supabase (Postgres + Auth + Storage + Realtime + RLS).
- **WhatsApp** — Meta Cloud API (official WhatsApp Business API).
- **Email** — listmonk, headless, driven over its REST API.

## Architecture in one paragraph

The CRM is the only user-facing application. The email engine runs as
a separate process on a private network and is never exposed publicly;
every email feature you see is a native CRM page or builder step that
calls the engine through the CRM's own API routes. Security lives in the
database — row-level security on every table, keyed to the signed-in
user's account — so the app cannot leak across tenants even if a UI
check is missed. See
[`deploy/README.md`](./deploy/README.md#why-two-services-instead-of-one-merged-app)
for why the engine is a separate service rather than merged code.

## Documentation

- [`deploy/README.md`](./deploy/README.md) — running and hosting the
  full platform
- [`docs/docker.md`](./docs/docker.md) — CRM-only container
- [`docs/public-api.md`](./docs/public-api.md) — REST API and API keys
- [`docs/mcp.md`](./docs/mcp.md) — MCP server for AI assistants
- [`CHANGELOG.md`](./CHANGELOG.md) — what changed, and any migrations to
  apply when updating

## Contributing and security

Bug reports and pull requests are welcome — see
[`CONTRIBUTING.md`](./CONTRIBUTING.md). Please report security issues
privately as described in
[`.github/SECURITY.md`](./.github/SECURITY.md).

## Credits

- The CRM began as a fork of [ArnasDon/wacrm](https://github.com/ArnasDon/wacrm)
  by Arnas Donauskas, released under the MIT licence. That licence and
  copyright notice are retained in [`LICENSE`](./LICENSE).
- Email sending is powered by [listmonk](https://listmonk.app) by
  Kailash Nadh and contributors, AGPL-3.0. It runs as an unmodified
  upstream Docker image alongside this app and is not part of this
  repository's source.

## License

This repository is [MIT](./LICENSE).
