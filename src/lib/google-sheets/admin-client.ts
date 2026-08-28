import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for Google Sheets disconnect
// notifications + status bookkeeping (oauth.ts's getValidAccessToken)
// and the append path invoked from `dispatchWebhookEvent`, which runs
// in an `after()` block with whatever client the caller had. Mirrors
// src/lib/google-calendar/admin-client.ts.
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
