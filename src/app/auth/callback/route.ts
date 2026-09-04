// ============================================================
// GET /auth/callback — Supabase Auth PKCE code-exchange endpoint
// (security audit finding AUTH-N1, closing the flow
// `/forgot-password` already starts).
//
// `resetPasswordForEmail` (forgot-password/page.tsx) points its
// recovery email at:
//   ${origin}/auth/callback?next=/reset-password
//
// Supabase Auth's own link takes the visitor here with a one-time
// `code` query param. This route exchanges it for a real session
// (cookies set on the response below — the standard `@supabase/ssr`
// pattern for Next.js App Router Route Handlers, the same one
// src/lib/supabase/server.ts's `createClient()` is built for) and
// redirects on to `next`.
//
// Not password-reset-specific: any other Supabase Auth flow that
// lands a `code` here (email confirmation, a future magic-link sign-in)
// exchanges and redirects the same way, so `next` is validated
// generically, not assumed to always be `/reset-password`.
//
// Security notes:
//   - `next` is NEVER trusted as-is — see src/lib/auth/safe-redirect.ts.
//     Only a same-origin absolute path is ever redirected to.
//   - Neither the `code` nor any Supabase error detail is ever logged
//     or shown to the visitor — failures collapse to the same generic
//     redirect regardless of *why* the exchange failed (missing code,
//     expired code, already-used code), so this endpoint can't be used
//     to distinguish those cases from the outside.
// ============================================================

import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { sanitizeNextPath } from '@/lib/auth/safe-redirect'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = sanitizeNextPath(url.searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin))
    }
    // Expired / already-used / malformed code. Log only that it
    // failed and why in Supabase's own terms — never the code value
    // itself, which is the actual secret here.
    console.warn('[auth/callback] exchangeCodeForSession failed:', error.message)
  }

  // No code at all, or the exchange failed — same generic destination
  // either way, so a probe can't tell "no code" from "bad code" from
  // "expired code".
  return NextResponse.redirect(new URL('/login', url.origin))
}
