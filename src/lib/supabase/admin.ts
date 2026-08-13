import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// The single service-role client for the whole system.
//
// Lazy so a missing env var doesn't crash the build — it only throws when
// something actually reaches for the client at request time.
//
// Service-role bypasses RLS, so this belongs to paths that have no
// `auth.uid()` of their own: inbound webhooks, cron jobs, and engine work
// running on a contact's behalf. Anything with a user session should go
// through `createClient()` in ./server instead.
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
