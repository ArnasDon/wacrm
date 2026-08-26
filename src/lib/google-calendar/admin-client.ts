import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for Google Calendar disconnect
// notifications + status bookkeeping (oauth.ts's getValidAccessToken).
// Mirrors src/lib/webhooks/admin-client.ts and its siblings — used
// instead of whatever RLS-scoped client the caller passed to
// getValidAccessToken() so the notification/status-update always
// succeeds regardless of which caller (auto-reply's background job, the
// owner's own session, ...) hit the expired token first.
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
