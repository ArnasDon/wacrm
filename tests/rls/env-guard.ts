// ============================================================
// RLS test suite — mandatory anti-remote-write guard.
//
// This file is loaded via `vitest.rls.config.ts`'s `setupFiles`, which
// means Vitest imports and executes it BEFORE any `*.rls.test.ts` file
// runs — for every single test file in this config, automatically,
// with no per-file opt-in required. That is deliberate: the whole
// point of this guard is that a test author cannot forget it.
//
// The check is intentionally an ALLOW-list (only 127.0.0.1/localhost
// pass), never a deny-list of known-bad hosts — a deny-list would need
// to anticipate every possible remote host name; an allow-list only
// has to get the ONE local case right.
//
// STOP READING THIS FILE AND MODIFYING THE ALLOW-LIST unless you are
// absolutely certain you are not about to point this suite at a real
// Supabase project. This suite creates real Auth users, real rows, and
// deletes them — every operation here is destructive by nature.
// ============================================================

const LOCAL_HOST_PATTERN = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/

/**
 * Throws synchronously if `rawUrl` does not resolve to 127.0.0.1,
 * localhost, or the IPv6 loopback — on ANY other host (including every
 * `*.supabase.co` project, any staging/production domain, or a typo'd
 * URL) this throws before a single request can be made.
 */
export function assertLocalSupabaseUrl(rawUrl: string | undefined, varName: string): string {
  if (!rawUrl || !rawUrl.trim()) {
    throw new Error(
      `[rls-guard] ${varName} is not set. The RLS suite refuses to run without an explicit, ` +
        `verified-local Supabase URL — see tests/rls/README.md for how to obtain one from ` +
        `\`supabase status -o env\` after \`supabase start\`.`,
    )
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`[rls-guard] ${varName}="${rawUrl}" is not a valid URL — refusing to proceed.`)
  }

  if (!LOCAL_HOST_PATTERN.test(parsed.hostname) && !LOCAL_HOST_PATTERN.test(parsed.host)) {
    throw new Error(
      `[rls-guard] ${varName}="${rawUrl}" does NOT resolve to 127.0.0.1/localhost ` +
        `(resolved host: "${parsed.host}"). REFUSING to run the RLS suite against anything ` +
        `that is not the local Supabase stack — this includes every hosted *.supabase.co ` +
        `project, staging, and production. If you genuinely intended to test against a local ` +
        `stack, check that \`supabase start\` printed a URL on 127.0.0.1/localhost and that ` +
        `you exported the matching env var (see tests/rls/README.md).`,
    )
  }

  return rawUrl
}

/**
 * Reads and validates the three env vars every RLS test needs, once,
 * at module load — so a missing/misconfigured var fails immediately
 * and loudly instead of surfacing as a confusing runtime error deep in
 * a test. Deliberately DIFFERENT variable names from the app's own
 * `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (see
 * clients.ts) — so that even if `.env.local` (which holds this
 * project's REAL configured credentials, local or hosted) were ever
 * accidentally loaded into this process's environment, this suite
 * would still find nothing under these names and refuse to run,
 * rather than silently picking up real credentials.
 */
export interface RlsEnv {
  url: string
  anonKey: string
  serviceRoleKey: string
}

export function loadRlsEnv(): RlsEnv {
  const url = assertLocalSupabaseUrl(process.env.RLS_TEST_SUPABASE_URL, 'RLS_TEST_SUPABASE_URL')
  const anonKey = process.env.RLS_TEST_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.RLS_TEST_SUPABASE_SERVICE_ROLE_KEY
  if (!anonKey) {
    throw new Error('[rls-guard] RLS_TEST_SUPABASE_ANON_KEY is not set — see tests/rls/README.md.')
  }
  if (!serviceRoleKey) {
    throw new Error('[rls-guard] RLS_TEST_SUPABASE_SERVICE_ROLE_KEY is not set — see tests/rls/README.md.')
  }
  return { url, anonKey, serviceRoleKey }
}

// Runs immediately on import — this is what makes `setupFiles` enforce
// the guard for every test file without each one calling anything.
// A missing/remote URL throws here and aborts the whole run before any
// test body executes.
loadRlsEnv()
