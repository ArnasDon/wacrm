// Re-export of the system's single service-role client.
// The inbound webhook has no `auth.uid()`, so the bot reads config +
// conversation state and sends through the service role.
// Canonical source: src/lib/supabase/admin.ts
export { supabaseAdmin } from '@/lib/supabase/admin'
