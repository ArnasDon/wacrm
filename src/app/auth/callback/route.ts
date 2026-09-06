import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveBaseUrl } from '@/lib/http/base-url'

/**
 * LEGACY landing route for Supabase Auth email links that still use
 * `{{ .ConfirmationURL }}`. New links go through `/auth/confirm`
 * instead — a bot-safe page that doesn't spend the one-time token on a
 * GET (see the comment there). This route is kept working for links
 * already in flight and for any email template not yet swapped.
 *
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
 *
 * Redirects are built from `resolveBaseUrl(request)`, never
 * `new URL(request.url).origin` — behind EasyPanel's reverse proxy the
 * raw request URL resolves to the container's internal bind address
 * (`0.0.0.0:80`), not the public hostname, which sent the very first
 * users through this route to an unreachable link.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'
  const baseUrl = resolveBaseUrl(request)

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${baseUrl}${next}`)
    }
  }

  return NextResponse.redirect(`${baseUrl}/login?error=invalid_or_expired_link`)
}
