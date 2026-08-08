import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Exchanges a Supabase email-link `code` (password recovery, invite
 * accept-via-email, etc.) for a session cookie, then redirects to
 * `next`. This is the `redirectTo` target `forgot-password/page.tsx`
 * passes to `resetPasswordForEmail` — without this route the reset
 * email links 404 and password recovery silently doesn't work.
 *
 * Mirrors Supabase's documented Next.js App Router callback pattern
 * for `@supabase/ssr`.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Only ever redirect to a same-app path — `next` rides in a public
  // email link, so treat it as untrusted input, not a trusted origin.
  const rawNext = searchParams.get('next') ?? '/dashboard'
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
