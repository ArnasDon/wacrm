import { createBrowserClient } from '@supabase/ssr'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'

// Uma única instância partilhada durante a sessão do navegador.
let browserClient: WacrmSupabaseClient | undefined

export function createClient(): WacrmSupabaseClient {
  if (browserClient) return browserClient

  const client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: {
        schema: 'wacrm',
      },
    }
  )

  browserClient = client
  return client
}
