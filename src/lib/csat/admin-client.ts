import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for the CSAT paths: the dispatch
// hooks invoked from `dispatchWebhookEvent` (an `after()` block with
// whatever client the caller had) and the /api/csat/cron sweep.
// Mirrors src/lib/google-sheets/admin-client.ts.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
