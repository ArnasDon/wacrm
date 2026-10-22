import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Singleton instance — one client shared across the whole browser session.
// Creating multiple clients causes auth-lock contention ("Lock was released
// because another request stole it") and intermittent fetch failures.
let browserClient: SupabaseClient | undefined

export function createClient() {
  if (browserClient) return browserClient

  // Fall back to placeholder values so `next build` succeeds in environments
  // without NEXT_PUBLIC_* vars set (CI, Docker build stage without --build-arg).
  // At runtime the browser client is always instantiated after env vars are
  // baked in by Next.js, so the placeholders are never actually used.
  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:8000',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-build-key'
  )

  return browserClient
}
