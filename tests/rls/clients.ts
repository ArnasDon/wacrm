// ============================================================
// RLS test suite — Supabase client factories.
//
// Three, and only three, kinds of client exist here:
//   1. `serviceRoleClient()` — bypasses RLS entirely. Used ONLY to
//      prepare/tear down fixtures (create Auth users, seed rows,
//      delete them afterward). NEVER used inside an assertion that
//      claims to test RLS — doing so would prove nothing, since
//      service_role sees everything by design.
//   2. `signInAsFixtureUser()` — returns a normal, `anon`-key client
//      that has completed `signInWithPassword`, i.e. an ordinary
//      authenticated user session exactly like the real app uses.
//      EVERY isolation assertion in this suite must go through a
//      client obtained this way.
//   3. `anonClient()` — an anon-key client with no session at all,
//      for the (out-of-scope-but-cheap-to-note) case of a fully
//      unauthenticated request.
//
// Every function here re-validates the local-only URL guard (defense
// in depth on top of the setupFiles-level check in env-guard.ts) —
// this file is exactly where a request actually leaves the process.
// ============================================================

import { createClient, type SupabaseClient, type WebSocketLikeConstructor } from '@supabase/supabase-js'
import ws from 'ws'
import { assertLocalSupabaseUrl, loadRlsEnv } from './env-guard'

// `SupabaseClient`'s constructor initializes its Realtime client
// unconditionally (this suite never opens a channel), and Node 20 —
// the version `.github/workflows/rls.yml` pins — has no native
// `WebSocket` global (added in Node 22). Without an explicit
// transport, `createClient(...)` itself throws "Node.js 20 detected
// without native WebSocket support" before any query ever runs.
// `ws` is exactly what @supabase/realtime-js's own error message
// recommends providing via `realtime: { transport: ws }` — confirmed
// against the installed @supabase/supabase-js's own type declarations
// (`SupabaseClientOptions.realtime: RealtimeClientOptions`,
// `RealtimeClientOptions.transport?: WebSocketLikeConstructor`), not
// assumed. Applied to every `createClient()` in this file — both
// clients hit the same constructor path.
// `@types/ws`'s constructor signature isn't structurally identical to
// `WebSocketLikeConstructor` (their `address` parameter types differ:
// this is the exact, well-known friction between Node's `ws` and the
// DOM `WebSocket` shape realtime-js models its type on, not something
// specific to this file) — the cast through `unknown` is the standard,
// minimal bridge for it; `ws` is still the real runtime value realtime-js
// receives and uses.
const REALTIME_OPTIONS = { transport: ws as unknown as WebSocketLikeConstructor }

let cachedServiceRoleClient: SupabaseClient | null = null

/** A service-role client. Bypasses RLS — fixtures/cleanup ONLY. */
export function serviceRoleClient(): SupabaseClient {
  if (cachedServiceRoleClient) return cachedServiceRoleClient
  const env = loadRlsEnv()
  assertLocalSupabaseUrl(env.url, 'RLS_TEST_SUPABASE_URL')
  cachedServiceRoleClient = createClient(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: REALTIME_OPTIONS,
  })
  return cachedServiceRoleClient
}

/** A plain anon-key client with no session — never authenticated. */
export function anonClient(): SupabaseClient {
  const env = loadRlsEnv()
  assertLocalSupabaseUrl(env.url, 'RLS_TEST_SUPABASE_URL')
  return createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: REALTIME_OPTIONS,
  })
}

/**
 * Signs in as a fixture user with the anon key — exactly the auth
 * path the real application uses (`supabase.auth.signInWithPassword`)
 * — and returns the resulting authenticated client. Every RLS
 * assertion in this suite must be run through a client obtained here,
 * never through `serviceRoleClient()`.
 */
export async function signInAsFixtureUser(email: string, password: string): Promise<SupabaseClient> {
  const client = anonClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    throw new Error(`[rls-suite] signInWithPassword failed for ${email}: ${error?.message ?? 'no session returned'}`)
  }
  return client
}
