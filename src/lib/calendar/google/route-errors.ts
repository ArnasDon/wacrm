import { NextResponse } from 'next/server'
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account'
import { CalendarError } from './client'
import { OAuthConfigError } from './env'
import { OAuthStateError } from './oauth-state'

/**
 * Shared error → NextResponse mapping for the Google Calendar OAuth
 * routes. Unlike `toErrorResponse` in `@/lib/auth/account` (which
 * collapses every non-auth error to a generic 500 to avoid leaking
 * internals on arbitrary app routes), these routes are admin-only
 * config actions where a specific "OAuth isn't configured" or "your
 * connection link expired" message is genuinely useful — so
 * `CalendarError` / `OAuthConfigError` / `OAuthStateError` get their
 * own message surfaced, still with no stack traces or raw Google
 * response bodies.
 */
export function oauthRouteErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  if (err instanceof OAuthConfigError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 500 })
  }
  if (err instanceof OAuthStateError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
  }
  if (err instanceof CalendarError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
  }
  console.error('[calendar/google] uncategorized error:', err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
