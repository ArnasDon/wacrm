# Agent Guardrails

Concrete rules for what to leave alone, what to extend, and how to work,
grounded in the actual repo (see `ARCHITECTURE.md` and
`SCHEMA_REFERENCE.md` for the evidence behind each rule below).

## Do not modify without an explicit, flagged reason

These are either security-sensitive, have documented bug history, or are
deliberate trade-offs — changing them silently is the single most likely
way an agent introduces a regression in this codebase.

- **`supabase/migrations/001_*.sql` through `042_*.sql`** — never edit, renumber, or delete an existing migration. A schema change is always a _new_ file, `043` and up.
- **Any RLS policy** — do not loosen, remove, or rewrite an existing policy. If a task seems to require it, stop and flag it explicitly in the PR description rather than proceeding; tenant isolation is the most important invariant in this codebase.
- **`src/middleware.ts`** — carries a documented fix for a real production bug (#288, wedged sessions after idling from cookies not propagating on redirects). Any new redirect branch must reuse the existing `withRefreshedCookies` helper, not bypass it.
- **`src/lib/rate-limit.ts`** — the in-memory design is intentional (documented in its own header), not an oversight. Don't swap it for Redis/etc. unless the task explicitly requires horizontal scaling support.
- **`src/lib/auth/roles.ts`** — the single source of truth for role capabilities. Add a new predicate function here if a new capability is needed; never compare role strings inline elsewhere.
- **`src/lib/auth/api-context.ts`** — the public-API auth pattern (`requireApiKey`). New `/api/v1` routes follow this pattern; don't invent a parallel auth mechanism for a new public endpoint.
- **`messages/en.json`, `messages/es.json`, `messages/ko.json`, `messages/pt.json`** structure — new keys are additive; don't restructure the existing key hierarchy, and don't hardcode user-facing strings outside this mechanism (see `ARCHITECTURE.md` §5).
- **`AGENTS.md`'s `<!-- BEGIN:nextjs-agent-rules -->` block** — appears to be tool-managed (framework version warning). Leave it intact; add new agent guidance after it, as already done.

## Safe to add to (this is most of the actual implementation plan work)

- New route segments under `src/app/(dashboard)/` (e.g. `site-visits/`, `properties/`, `team/`) — follow the existing route-group convention (shared `layout.tsx` + `dashboard-shell.tsx`).
- New component directories under `src/components/` (e.g. `components/site-visits/`, `components/mobile/` for the bottom-nav/app-shell primitives) — one directory per feature area, matching the existing `pipelines/`, `inbox/`, `flows/` pattern.
- New `lib/<feature>/` modules (e.g. `lib/site-visits/`, `lib/properties/`) — mirror the shape of an existing feature module (`lib/contacts/` or `lib/automations/` are good templates: a core logic file, an admin-client if service-role access is needed, and a co-located `.test.ts`).
- New migrations `043` and up.
- New scopes in `lib/api-keys/scopes.ts` and new `lib/api/v1/<resource>.ts` helper modules for any new public-API resource.
- New design tokens **added to** the existing `globals.css` variable set — not a parallel system (see `ARCHITECTURE.md` §7).
- New `docs/agent/*.md` files, kept up to date as the codebase changes — these documents are living references, not a one-time snapshot.

## Workflow

1. **One implementation-plan section = one branch = one PR.** Don't combine sections; don't start section N+1 before N is merged (respecting the dependency order already noted in `IMPLEMENTATION_PLAN.md`).
2. **Before writing code in a new directory**, read 2-3 existing files in the nearest equivalent directory and match conventions — naming, error handling, comment density, test co-location. This codebase documents _why_, not just _what_; match that, especially in anything touching auth, money (`deals.value`/`currency`), or tenant scoping.
3. **Every task that touches the database** gets a new migration file plus an update to `SCHEMA_REFERENCE.md`'s table inventory in the same PR — don't let this document go stale.
4. **Every new public-facing string** goes through `next-intl` message keys, `en.json` at minimum.
5. **Before finishing any task, run in order:** `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test`. A task is not done if any fail.
6. **Write or update tests** for new API routes, new `lib/` logic, and new database functions as part of the same task — this repo's existing convention is a co-located `<file>.test.ts` next to nearly every non-trivial module; match it.
7. **When genuinely ambiguous**, pick the most conservative option consistent with existing conventions, state the assumption in the PR description, and proceed — don't block waiting for clarification unless the task is truly unresolvable without it.
8. **Update `PROGRESS.md`** (create at repo root if absent) checking off the implementation-plan task ID with the PR link, so the next session (possibly a different agent/model) knows exactly what's already done.

## Definition of done (apply per task, not just per section)

- [ ] Code matches the conventions of the nearest existing equivalent file (verified by reading it first, not assumed)
- [ ] New DB changes are a new, correctly-numbered migration; `SCHEMA_REFERENCE.md` updated
- [ ] RLS added/verified for any new account-scoped table, using the existing `is_account_member` helper pattern
- [ ] New user-facing strings added to `messages/en.json` via `next-intl`, not hardcoded
- [ ] `typecheck`, `lint`, `format:check`, `test` all pass
- [ ] Tests added/updated for new logic, colocated per existing convention
- [ ] `PROGRESS.md` updated with the completed task ID and PR link
- [ ] Nothing in the "do not modify" list above was touched without an explicit, flagged reason in the PR description
