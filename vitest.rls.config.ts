import { defineConfig } from "vitest/config";

// ============================================================
// Separate Vitest project for the real-RLS-against-Postgres suite
// (hardening: RLS real end-to-end). Deliberately isolated from
// `vitest.config.ts`:
//   - different `include` glob (`tests/rls/**`, never `src/**`), so
//     these files can NEVER be picked up by the default `npm test`;
//   - `tests/rls/env-guard.ts` as a `setupFiles` entry, enforced for
//     every file in THIS config, refusing to run against anything but
//     127.0.0.1/localhost;
//   - `fileParallelism: false` — every file shares the same two-tenant
//     fixture (same fixture emails), seeded/torn down in each file's
//     own beforeAll/afterAll; running files concurrently would race
//     those seed/cleanup calls against each other.
//
// Run with `npm run test:rls`, ONLY after `supabase start` and with
// RLS_TEST_SUPABASE_URL / RLS_TEST_SUPABASE_ANON_KEY /
// RLS_TEST_SUPABASE_SERVICE_ROLE_KEY exported — see tests/rls/README.md.
// Never wired into `npm test` or the default `ci.yml` job.
// ============================================================
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["tests/rls/**/*.rls.test.ts"],
    setupFiles: ["./tests/rls/env-guard.ts"],
    fileParallelism: false,
    // Real network calls to a local Postgres/Auth stack are slower
    // than the mocked default suite — a generous timeout avoids a
    // flaky failure on a cold local stack, without masking a genuine
    // hang (still bounded).
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
