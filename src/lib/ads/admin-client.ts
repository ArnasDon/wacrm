import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for the ads sync. Mirrors the same
// small helper duplicated per subsystem (automations, flows, ai) —
// see src/lib/automations/admin-client.ts.
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
