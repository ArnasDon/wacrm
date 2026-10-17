# RLS real end-to-end suite

Hardening plan (post-Fase 2 audit) — evaluates the ONE thing the rest of
this repository's test suite (all mocks/fakes, see `vitest.config.ts`)
cannot: whether the actual Postgres Row Level Security policies, running
on real Postgres, actually stop one tenant from reaching another's data.

## What this is, and is not

- **Is**: a small, deliberately narrow suite covering catalog, Knowledge
  Base, Business Profile, `ai_configs`, and `conversations`/
  `ai_catalog_context` — the same five resource areas identified in the
  Fase 2 audit (2.7/2.8) as depending entirely on RLS for tenant
  isolation.
- **Is not**: a replacement for `npm test`. That suite stays exactly as
  it is — fast, deterministic, zero network, mocks/fakes only. This one
  is slow, requires Docker, and is never run as part of it.

## Running it locally

1. Install Docker and the Supabase CLI (already a dependency of this
   project — see `supabase/config.toml`).
2. `supabase start` (NOT `supabase db start` — this suite needs real
   Auth/PostgREST for genuine per-user JWTs, not just Postgres).
3. `supabase db reset --local --no-seed` to guarantee every migration
   replayed from nothing.
4. Read the local connection details: `supabase status -o env`. Export
   the three values this suite needs, under THESE names (deliberately
   different from the app's own `NEXT_PUBLIC_SUPABASE_URL` /
   `SUPABASE_SERVICE_ROLE_KEY` — see `tests/rls/env-guard.ts` for why):

   ```sh
   export RLS_TEST_SUPABASE_URL=http://127.0.0.1:54321
   export RLS_TEST_SUPABASE_ANON_KEY=<anon key from supabase status>
   export RLS_TEST_SUPABASE_SERVICE_ROLE_KEY=<service_role key from supabase status>
   ```

5. `npm run test:rls`.
6. `supabase stop` when done.

## The guard

`tests/rls/env-guard.ts` is loaded via `vitest.rls.config.ts`'s
`setupFiles`, which means it runs before ANY test in this directory —
automatically, for every file, with no per-file opt-in. It throws
immediately if `RLS_TEST_SUPABASE_URL` does not resolve to
`127.0.0.1`/`localhost`/`[::1]`. There is no code path in this directory
that reaches a network call before that check has already run.

**Never** weaken this check, and never point these env vars at a
hosted `*.supabase.co` project — every test here creates real Auth
users and deletes rows.

## Architecture

- `env-guard.ts` — the safety check above, plus `loadRlsEnv()`.
- `clients.ts` — three client factories: `serviceRoleClient()` (fixture
  prep/cleanup ONLY, never used to assert RLS), `anonClient()`, and
  `signInAsFixtureUser()` (a real `signInWithPassword` session — every
  isolation assertion in this suite goes through a client obtained this
  way).
- `fixtures.ts` — seeds two completely independent tenants ("A" and
  "B"), each with a real Auth user (`auth.admin.createUser`), relying on
  the EXISTING `on_auth_user_created` trigger (migration 017) to create
  their `accounts`/`profiles` row — never inserted by hand — plus one
  row per resource area, with every text field prefixed
  `RLS-FIXTURE-A-`/`RLS-FIXTURE-B-` so a leak is unambiguous. Idempotent:
  safe to re-run without a fresh `db reset` in between.
- `*.rls.test.ts` — one file per resource area. Each seeds/tears down
  its own copy of the fixture in `beforeAll`/`afterAll` (files run
  sequentially — `fileParallelism: false` in `vitest.rls.config.ts` —
  so they never race the shared fixture emails).

## What "RLS real" does NOT prove

This suite proves that the CURRENT policies, as written in
`supabase/migrations/`, actually stop cross-tenant access on a real
Postgres instance. It does not, and cannot, prove that:

- the mocked/faked application-level test suite is now redundant — it
  still catches the class of bug this suite cannot (an
  `executeCatalogTool` call that forgets to pass `accountId` at all,
  for example, is invisible here if the row simply doesn't exist for
  either tenant);
- a FUTURE migration that adds a new table will automatically be
  covered — a new resource area needs a deliberate addition here, the
  same way it needed a deliberate audit finding in Fase 2.

## CI

`.github/workflows/rls.yml` runs this suite in a separate job, gated to
changes under `supabase/**`, `tests/rls/**`, or the workflow itself (plus
a manual `workflow_dispatch`) — never on every push, and never as part
of `ci.yml`'s fast path.

**Caveat, stated plainly**: the exact env-var names `supabase status -o
env` prints (`API_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY`, as wired in
`rls.yml`) were not verified against a real run of this project's
pinned CLI version in the session that wrote this suite — Docker was
not available in that environment. Confirm these names against a real
`supabase status -o env` (or `supabase start`'s own printed output)
before trusting the first CI run of this workflow; adjust the `grep`
pattern in `rls.yml`'s "Export local Supabase connection details" step
if they differ.
