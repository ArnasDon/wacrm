import { NextResponse, type NextRequest } from 'next/server'

// ============================================================
// Proxy (Next 16's rename of middleware).
//
// Deliberately cheap: it only looks at whether a session cookie
// EXISTS, to redirect signed-out visitors away from app pages.
// It is not the authorization layer — every route handler still
// calls requireRole(), which validates the session against the DB.
//
// It also enforces a same-origin check on state-changing API calls
// (CSRF defense in depth on top of SameSite=Lax cookies). Inbound
// webhooks from Meta / Paystack / Flutterwave are exempt — they
// carry no cookies and are authenticated by signature instead.
// ============================================================

const SESSION_COOKIE = 'wacrm_session'

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/inbox',
  '/contacts',
  '/orders',
  '/inventory',
  '/settings',
  '/pipelines',
  '/broadcasts',
  '/automations',
  '/flows',
]

const AUTH_PAGES = ['/login', '/signup', '/forgot-password', '/reset-password']

/** Server-to-server endpoints: signature- or secret-authenticated. */
function isMachineEndpoint(pathname: string): boolean {
  return (
    pathname === '/api/whatsapp/webhook' ||
    /^\/api\/payments\/(paystack|flutterwave)\/[a-f0-9]{24}\/webhook$/.test(pathname) ||
    pathname.endsWith('/cron')
  )
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hasSession = !!request.cookies.get(SESSION_COOKIE)?.value

  // --- CSRF: mutating API calls must come from our own origin ---
  if (
    pathname.startsWith('/api/') &&
    !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
    !isMachineEndpoint(pathname)
  ) {
    const origin = request.headers.get('origin')
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    if (origin) {
      let originHost: string | null = null
      try {
        originHost = new URL(origin).host
      } catch {
        originHost = null
      }
      if (!originHost || originHost !== host) {
        return NextResponse.json({ error: 'Cross-origin request refused' }, { status: 403 })
      }
    }
  }

  // --- signed-in users don't need the auth pages ---
  if (hasSession && AUTH_PAGES.includes(pathname)) {
    const invite = request.nextUrl.searchParams.get('invite')
    const url = request.nextUrl.clone()
    url.search = ''
    url.pathname = invite ? `/join/${encodeURIComponent(invite)}` : '/dashboard'
    return NextResponse.redirect(url)
  }

  // --- signed-out users can't see app pages ---
  if (!hasSession && PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
