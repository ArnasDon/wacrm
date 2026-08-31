import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Is this the specific auth failure that means "the session is gone and
 * retrying will never help"?
 *
 * Deliberately narrow. A transient outage between us and GoTrue also
 * surfaces as an error here, and expiring the user's cookies over a
 * blip would sign them out for no reason — so we only act on the codes
 * that describe a refresh token the server has definitively rejected.
 * Anything else falls through and the session is left intact.
 */
function isDeadRefreshToken(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === 'refresh_token_not_found') return true
  if (error.code === 'refresh_token_already_used') return true
  const message = error.message?.toLowerCase() ?? ''
  return message.includes('invalid refresh token') || message.includes('refresh token not found')
}

/**
 * Expire the Supabase auth cookies on the outgoing response so the
 * browser stops replaying a token GoTrue has already refused.
 *
 * Supabase names these `sb-<project-ref>-auth-token`, sharding large
 * ones into `.0` / `.1` chunks, so we match the prefix+suffix shape
 * rather than hardcoding a project ref. Only auth cookies are touched;
 * anything else the app has set survives.
 */
function clearDeadSession(request: NextRequest, response: NextResponse): void {
  request.cookies.getAll().forEach(({ name }) => {
    if (name.startsWith('sb-') && name.includes('auth-token')) {
      response.cookies.set(name, '', { maxAge: 0, path: '/' })
    }
  })
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Only name/value go back onto the *request* — cookie options
          // (path, maxAge, sameSite) describe how a browser should store
          // a cookie and mean nothing on an inbound request object. They
          // are applied to the response below, where they do matter.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  // A refresh token the server won't accept — revoked, already consumed,
  // or expired while the tab slept — is terminal for this session, but
  // the browser has no way to know that and keeps replaying the same
  // dead cookie on every subsequent request. Each one costs a failed
  // round trip to GoTrue and logs `AuthApiError: Invalid Refresh Token:
  // Refresh Token Not Found` server-side, so a single stale cookie
  // produces an unbounded stream of identical errors until the user
  // clears their cookies by hand.
  //
  // `getUser()` reports this in `error` and leaves `user` null, so the
  // routing below already does the right thing (treat as signed out).
  // What it can't do is stop the replay — that needs the dead cookie
  // expired on the way out, which is what `clearDeadSession` does.
  const hasDeadSession = isDeadRefreshToken(authError)

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    // Order matters: clear *after* copying. On a dead session Supabase
    // wrote nothing to copy, but if that ever changes we want the
    // expiry to win rather than resurrect a token GoTrue rejected.
    if (hasDeadSession) clearDeadSession(request, response)
    return response
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (user && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/dashboard'
      url.search = ''
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/settings']
  if (!user && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // API routes that need auth (not webhooks)
  if (!user && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !request.nextUrl.pathname.includes('/webhook')) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
  }

  // The pass-through branch needs the same cleanup as the redirects
  // above: a dead session on a public page (say `/join/<token>`) would
  // otherwise keep replaying its cookie on every asset request.
  if (hasDeadSession) clearDeadSession(request, supabaseResponse)

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
