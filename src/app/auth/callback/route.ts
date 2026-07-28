import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /auth/callback
 *
 * Exchanges a Supabase auth `code` (password-reset link, seller-invite
 * link — anything using the PKCE email-link flow) for a real session,
 * then redirects to `next`. forgot-password/page.tsx and the seller
 * invite flow (api/organization/sellers) both point their emails here;
 * this route previously didn't exist, which silently broke both
 * ("forgot password" links 404'd) until this fix.
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
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message)
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
