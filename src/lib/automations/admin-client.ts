import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseServerUrl } from '@/lib/supabase/internal-url'

// Lazy, shared service-role client for automation engine work.
// Mirrors the pattern used by the webhook handler
// (src/app/api/whatsapp/webhook/route.ts).
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      // Containerised deploys reach kong by its compose DNS name; the public
      // URL is localhost, unreachable from inside the app container.
      supabaseServerUrl(),
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
