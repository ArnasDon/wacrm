import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAuthCookieName, supabaseServerUrl } from './internal-url'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    supabaseServerUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: supabaseAuthCookieName() },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  )
}
