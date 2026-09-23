<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Working in this repo — read before writing code

This is a fork of the `wacrm` template, extended into a real estate
vertical CRM. Three documents in `docs/agent/` are the source of truth
for how this codebase actually works — **read the relevant one before
touching a directory you haven't touched yet in this session**, and
treat what's in them as ground truth over anything you'd otherwise
infer or recall:

- **[`docs/agent/ARCHITECTURE.md`](./docs/agent/ARCHITECTURE.md)** —
  stack, directory map, and the conventions already in use (auth,
  API routes, i18n, design tokens, RLS). Read this first, every
  session.
- **[`docs/agent/SCHEMA_REFERENCE.md`](./docs/agent/SCHEMA_REFERENCE.md)** —
  every existing database table, the exact TypeScript shape of the
  core entities, current migration number, and the RLS pattern new
  migrations must follow.
- **[`docs/agent/AGENT_GUARDRAILS.md`](./docs/agent/AGENT_GUARDRAILS.md)** —
  what's protected and must not change, what's safe to add to, the
  commit/PR workflow, and the definition-of-done checklist for a task.
- **[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)** — the
  phased build plan for the real estate mobile product. Execute one
  section at a time, per its own instructions.
- **[`docs/REPO_OPERATIONS.md`](./docs/REPO_OPERATIONS.md)** — forking
  and remotes, pulling upstream fixes, local/staging/production
  environment setup, and what CI (`.github/workflows/`) already
  checks. Read this before opening a PR, adding a migration, or
  touching deploy config.

If something in the implementation plan conflicts with what you find
in the actual code, **the actual code wins** — update the plan's
assumption rather than forcing the code to match a stale plan.
