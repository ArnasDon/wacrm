<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Scoped Rules

Detailed conventions live in `.claude/rules/` and auto-load when a file matching their scope is **read** — they are not loaded up front. When planning or implementing work that **creates new files** in one of these areas, Read the rule file first: a file that doesn't exist yet triggers nothing, so the plan would otherwise be written without its conventions.

- `supabase-migrations.md` — `supabase/migrations/*.sql` (numbering, idempotency, RLS pattern)
- `api-v1-routes.md` — `src/app/api/v1/**` (the public REST API's auth/response/pagination conventions)
- `security.md` — `src/lib/auth/**`, `src/lib/supabase/**`, `src/lib/api-keys/**`, `src/lib/whatsapp/encryption.ts`, webhook handlers

## Repository Overview

wacrm is a self-hostable, fork-first CRM template for the official WhatsApp Business API: shared inbox, contacts, sales pipelines, broadcasts, no-code automations, and an AI reply assistant. It is **one Next.js app on one Supabase project** — no monorepo, no microservices. See [README.md](./README.md) for the product description and [CONTRIBUTING.md](./CONTRIBUTING.md) for the fork/upstream posture.

| Layer | Technology |
|-------|------------|
| App | Next.js 16 (App Router, Turbopack, server actions), React 19, TypeScript |
| Styling | Tailwind CSS v4, shadcn/ui components (`src/components/ui`), Tremor (`src/components/tremor`) |
| Data | Supabase — Postgres + Auth + Storage, RLS on every table |
| WhatsApp | Meta Cloud API (official WhatsApp Business API) |
| AI | Bring-your-own-key: Anthropic or OpenAI, pluggable provider adapters |
| Flow builder | `@xyflow/react` + `@dagrejs/dagre` (automations' visual step editor) |
| Tests | Vitest (`*.test.ts`, colocated with source) |

### Directory Map

```
src/app/
  (auth)/            login, signup, forgot-password — unauthenticated routes
  (dashboard)/       inbox, contacts, pipelines, broadcasts, automations, flows,
                      agents, dashboard, notifications, settings — authenticated app shell
  api/                internal routes the dashboard itself calls (cookie-session auth)
  api/v1/             the public REST API (API-key auth) — see api-v1-routes.md
  join/[token]/       account-invitation acceptance flow

src/components/       one folder per domain, mirrors src/app/(dashboard)/*
src/lib/               same domain split, holds the actual logic + colocated *.test.ts
  supabase/           browser + server Supabase client factories
  auth/               account/role resolution, invitations, api-context (requireApiKey)
  api/v1/             public-API response envelope, pagination, per-resource serializers
  api-keys/           key hashing, scopes, storage
  ai/                 provider adapters (anthropic/openai), knowledge base, auto-reply, tag tool-use
  automations/        trigger engine, step tree, Meta send adapter
  flows/              flow definitions/admin client backing the visual builder
  whatsapp/           Meta Cloud API client, token encryption
  webhooks/           outbound event webhook delivery
  storage/            Supabase Storage helpers (avatars, flow media)

supabase/migrations/   numbered, hand-written SQL — see supabase-migrations.md
docs/public-api.md     user-facing public API reference (auth, scopes, endpoints, webhooks)
```

### Multi-Tenancy Model

Every account-owned table carries `account_id`, not `user_id` — `user_id` (where it still exists) means "which teammate owns/created this row," never tenancy. Roles are `owner > admin > agent > viewer`, checked everywhere by the Postgres helper `is_account_member(account_id, min_role)` (defined in `supabase/migrations/017_account_sharing.sql`), both inside RLS policies and from application code via RPCs. A single Supabase project serves every account; isolation is entirely row-level, not schema- or database-level.

## Dev Loop

```bash
npm run dev           # Turbopack dev server, port 3000
npm run build          # production build (also runs Next's own typecheck)
npm run typecheck      # tsc --noEmit
npm run lint            # ESLint
npm run format          # Prettier --write
npm run format:check    # Prettier --check (CI)
npm test                # vitest run
npm run test:watch      # vitest watch mode
```

CI (`.github/workflows/ci.yml`) runs lint → typecheck → test → build on every PR against `main`. Run at least `npm run typecheck` and `npm test` before calling a change done; `npm run format` before committing.

Supabase: this repo has no local Supabase stack committed beyond `supabase/migrations/`. Migrations are applied to whatever Supabase project `.env.local` points at (see `.env.local.example`) — there's no `supabase db reset` harness checked in here.

## Security Posture

This is a security-conscious template — do not casually relax any of these:

- **RLS is the tenancy boundary.** Every table has Row Level Security enabled and policies gated by `is_account_member(...)`. A new table without RLS is a bug, not an oversight to fix later.
- **Service-role client bypasses RLS.** It's used only where no user session exists to check against (the public API's `requireApiKey`, background/admin operations in `lib/*/admin-client.ts`). Every service-role query MUST be explicitly filtered by the resolved `account_id` — RLS isn't there to catch a missing filter.
- **Secrets are encrypted at rest**, not just access-controlled. WhatsApp tokens use AES-256-GCM (`src/lib/whatsapp/encryption.ts`); API keys are stored as a SHA-256 hash, never plaintext (`src/lib/api-keys/keys.ts`), same pattern as `account_invitations.token_hash`. Follow the existing pattern (encrypt-at-write, verify-at-read) for any new secret-shaped column — never add a plaintext secret column.
- **Webhooks are HMAC-verified** both directions: inbound (Meta) and outbound (this app's event webhooks) — see `src/lib/webhooks/`.
- Full detail in `.claude/rules/security.md` (auto-loads on the relevant files).

## Comments

The codebase writes comments deliberately — match the existing style: dense, purposeful "why" blocks at file/function tops (see any `supabase/migrations/*.sql` header or `src/lib/whatsapp/encryption.ts`), not restating the code inline.

This is a deliberate divergence from the common "default to no comments, put anything longer in the PR description" convention: that convention assumes the next reader digs through commit/PR history when they need context, which is a reasonable bet for a human-led team but a weak one here (see "AI-First Development" below) — a cold agent read via `grep`/`Read` sees the file, not the git log. So bias toward keeping the "why" in the file itself:

- **Record non-obvious design decisions, security rationale, and surprising constraints in the file**, not only in the commit that introduced them.
- **Never explain WHAT the code does** — types and names already do that; restating logic in prose is noise for a human or an agent, comments or not.
- **Don't reference the current task, ticket, or PR number** — that still rots as the codebase evolves; write what's true about the code, not why *you* changed it today.
- SQL migration files always get a header comment block (see `supabase-migrations.md`); `.ts` files get one wherever there's a genuine "why" to record.

## AI-First Development

No one hand-writes code in this repo — every change is agent-authored, and there is no human doing a manual finishing pass afterward. That changes a few defaults:

- **No partial implementations.** Ship the complete change — tests included, error cases handled, docs updated. Never "good enough, a human will tidy this up" or a `// TODO: add tests` — there is no follow-up pass to rely on. Run the full verification loop (`npm run typecheck`, `npm test`, `npm run lint`, and `npm run build` for anything touching build-time config) before calling a change done; it's the only check the code gets before a human reviews the diff, not a fallback for someone reading the logic line by line.
- **A future agent session starts with zero memory of this one.** Comments (see "Comments" above) and commit/PR messages are how it recovers context — write them for that reader, not just for whoever clicks through a PR once.
- **Keep `AGENTS.md`, `.claude/rules/`, and `.claude/skills/` current as features land.** They substitute for the tribal knowledge a human team would build up informally. A rule or skill that's gone stale is worse than none — it actively misleads instead of just being silent. When a change introduces a new convention (a new table shape, a new API pattern, a new domain module), update or add the relevant rule/skill in the same change, not as separate cleanup later.

## Fork-First Posture

wacrm is a template — but **this checkout is a fork of it**, not the upstream template itself. `upstream` (`ArnasDon/wacrm`) is the shared template other people also fork from; `origin` (this fork) is one specific deployment being actively customized. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the fork/customize/deploy model that describes it.

That distinction matters for how "generic" code needs to be:

- **In this fork, day-to-day**: hardcoding this deployment's specifics (branding, a chosen AI provider, account-specific config) is fine — that's the point of forking. Don't hold back a feature just to keep it generic for hypothetical other forkers.
- **Only when preparing a change to send upstream** (security fixes and bug-fix-shaped PRs — see CONTRIBUTING.md's "Upstream pull requests" section; new features generally aren't accepted upstream) does it need to stay generic and not assume this fork's specific choices.
