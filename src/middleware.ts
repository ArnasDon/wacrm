import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Supabase Auth (GoTrue) can become unavailable while the rest of the
// project (REST/Storage/gateway) stays healthy. Without a hard ceiling
// here, a hung getUser() call blocks this middleware — which runs on
// nearly every route via the matcher below — until Vercel's own platform
// limit fires, turning a scoped third-party Auth outage into a site-wide
// 504 (MIDDLEWARE_INVOCATION_TIMEOUT). AUTH_TIMEOUT_MS only bounds how
// long we wait for an answer; it never changes what a *successful*
// answer means.
const AUTH_TIMEOUT_MS = 5000

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })
  const authController = new AbortController()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
      global: {
        // Actually cancels the in-flight request once AUTH_TIMEOUT_MS
        // elapses (see below), instead of merely racing past a call that
        // keeps running unattended in the background.
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, signal: authController.signal }),
      },
    }
  )

  // A timeout means Auth did not answer in time — that is NOT the same
  // thing as "Auth answered and there is no user". The two must never be
  // conflated: `authTimedOut` keeps the distinction explicit (used below
  // only for a minimal, non-sensitive log line), while `user` itself is
  // null in both cases so every existing gate below fails closed on a
  // timeout exactly as it already does for a confirmed logged-out
  // visitor — protected paths and /api/whatsapp/* both deny, public
  // paths are unaffected since they never key off `user` at all.
  let authTimedOut = false
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      authTimedOut = true
      authController.abort()
      resolve(null)
    }, AUTH_TIMEOUT_MS)
  })
  const call = supabase.auth.getUser().then(
    ({ data }) => data.user,
    () => {
      // A network/abort error from Auth is indistinguishable from Auth
      // being down — treat it the same as a timeout, never as a
      // confirmed logout.
      authTimedOut = true
      return null
    }
  )

  let user: Awaited<typeof call>
  try {
    user = await Promise.race([call, timeout])
  } finally {
    clearTimeout(timer!)
  }

  if (authTimedOut) {
    // Minimal, non-sensitive signal for ops visibility — no token,
    // cookie, user id, or request body is ever logged here.
    console.warn(`[middleware] supabase.auth.getUser() did not respond within ${AUTH_TIMEOUT_MS}ms`)
  }

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

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
