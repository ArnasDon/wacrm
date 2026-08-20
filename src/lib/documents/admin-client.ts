import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for document-preview generation.
// Mirrors src/lib/ai/admin-client.ts and src/lib/flows/admin-client.ts —
// preview generation runs from the inbound webhook (no `auth.uid()`) and
// from the shared send core (which may itself run without a user
// session, e.g. Flows), so it always writes through the service role.
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
