import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Lands here from a Supabase Auth email link (password recovery,
 * platform company invite — see `resetPasswordForEmail` in
 * `forgot-password/page.tsx` and `inviteUserByEmail` in
 * `api/admin/companies/route.ts`, both of which point `redirectTo` at
 * this route). Both link types carry a PKCE `code` query param (the
 * `@supabase/ssr` browser client defaults to `flowType: 'pkce'`), so
 * this exchanges it for a real session — using the cookie-aware server
 * client so the session actually lands in the browser, not just this
 * one request — then forwards to `next` (the page that finishes the
 * flow, e.g. `/reset-password` to set a first/new password).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=invalid_or_expired_link`)
}
