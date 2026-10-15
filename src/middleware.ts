import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
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
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

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
  // Every top-level route under src/app/(dashboard)/ belongs here —
  // middleware.test.ts reads that directory and fails on a missing one.
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/flows', '/agents', '/notifications', '/settings']












  
if (
  process.env.CLIENT_SUSPENDED === 'true' &&
  protectedPaths.some(path =>
    request.nextUrl.pathname.startsWith(path)
  )
) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>CRM Temporarily Suspended | Digital Magnet</title>
  <style>
    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font-family: Arial, Helvetica, sans-serif;
      color: #f1f5f9;
      background:
        radial-gradient(ellipse at 15% 20%, #092e46 0%, transparent 45%),
        radial-gradient(ellipse at 85% 80%, #241044 0%, transparent 45%),
        #050816;
      overflow-x: hidden;
    }

    .card {
      position: relative;
      width: 100%;
      max-width: 560px;
      padding: 42px 28px;
      text-align: center;
      border: 1px solid rgba(0, 229, 255, 0.55);
      border-radius: 24px;
      background: rgba(9, 17, 38, 0.88);
      box-shadow:
        0 0 18px rgba(0, 229, 255, 0.13),
        0 0 55px rgba(0, 229, 255, 0.08),
        inset 0 0 25px rgba(0, 229, 255, 0.035);
      animation: appear 0.8s ease-out both, glow 4s ease-in-out infinite;
    }

    .icon {
      width: 76px;
      height: 76px;
      display: grid;
      place-items: center;
      margin: 0 auto 26px;
      border: 1px solid #00e5ff;
      border-radius: 50%;
      color: #00e5ff;
      font-size: 36px;
      text-shadow: 0 0 15px #00e5ff;
      box-shadow: 0 0 24px rgba(0, 229, 255, 0.18);
    }

    h1 {
      margin: 0 0 18px;
      font-size: clamp(25px, 5vw, 34px);
      line-height: 1.25;
      color: #ffffff;
    }

    h1 span {
      color: #00e5ff;
      text-shadow: 0 0 16px rgba(0, 229, 255, 0.38);
    }

    .message {
      margin: 0 auto 30px;
      max-width: 410px;
      color: #b9c7dc;
      font-size: 15px;
      line-height: 1.8;
    }

    .brand {
      padding: 24px 16px;
      border: 1px solid rgba(0, 229, 255, 0.2);
      border-radius: 16px;
      background: rgba(0, 229, 255, 0.045);
    }

    .brand-name {
      margin: 0;
      font-size: 27px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }

    .brand-subtitle {
      margin: 7px 0 22px;
      color: #00e5ff;
      font-size: 13px;
      letter-spacing: 2px;
      text-transform: uppercase;
    }

    .contact-label {
      margin: 0 0 6px;
      color: #91a4c2;
      font-size: 12px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }

    .contact-name {
      margin: 0 0 8px;
      font-size: 19px;
      font-weight: 700;
    }

    .phone {
      margin: 0 0 22px;
      color: #c4d2e5;
      font-size: 15px;
    }

    .whatsapp {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      max-width: 290px;
      padding: 15px 20px;
      border-radius: 12px;
      background: #20c96b;
      color: #04180c;
      font-size: 15px;
      font-weight: 700;
      text-decoration: none;
      transition: transform 0.2s, box-shadow 0.2s;
      box-shadow: 0 0 20px rgba(32, 201, 107, 0.17);
    }

    .whatsapp:hover {
      transform: translateY(-2px);
      box-shadow: 0 0 28px rgba(32, 201, 107, 0.38);
    }

    .whatsapp svg {
      width: 23px;
      height: 23px;
      fill: currentColor;
    }

    footer {
      margin-top: 27px;
      color: #71819c;
      font-size: 12px;
      line-height: 1.8;
    }

    @keyframes glow {
      0%, 100% {
        box-shadow: 0 0 18px rgba(0,229,255,.13),
                    0 0 55px rgba(0,229,255,.08);
      }
      50% {
        box-shadow: 0 0 26px rgba(0,229,255,.22),
                    0 0 70px rgba(0,229,255,.12);
      }
    }

    @keyframes appear {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 420px) {
      .card { padding: 32px 18px; }
      .brand-name { font-size: 24px; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="icon" aria-hidden="true">!</div>

    <h1>CRM Access<br /><span>Temporarily Suspended</span></h1>

    <p class="message">
      Please contact us for assistance in restoring access.
    </p>

    <section class="brand">
      <h2 class="brand-name">Digital Magnet</h2>
      <p class="brand-subtitle">Business Solutions</p>

      <p class="contact-label">Contact</p>
      <p class="contact-name">Periyar Dasan</p>
      <p class="phone">+91 7639769304</p>

      <a
        class="whatsapp"
        href="https://wa.me/917639769304?text=Hi%20Periyar%2C%20I%20need%20help%20with%20my%20CRM%20account."
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Contact Periyar Dasan on WhatsApp"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.52 3.48A11.8 11.8 0 0 0 12.08 0C5.5 0 .14 5.36.14 11.94c0 2.1.55 4.15 1.6 5.96L0 24l6.25-1.64a11.9 11.9 0 0 0 5.82 1.48h.01c6.58 0 11.94-5.36 11.94-11.94 0-3.19-1.24-6.19-3.5-8.42ZM12.08 21.8a9.9 9.9 0 0 1-5.04-1.38l-.36-.21-3.71.97.99-3.62-.23-.37a9.84 9.84 0 0 1-1.51-5.25c0-5.45 4.43-9.88 9.88-9.88a9.8 9.8 0 0 1 6.98 2.9 9.8 9.8 0 0 1 2.9 6.98c0 5.45-4.43 9.88-9.9 9.88Zm5.42-7.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.48-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.48.71.31 1.26.5 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35Z"/>
        </svg>
        Contact via WhatsApp
      </a>
    </section>

    <footer>
      Your business growth partner<br />
      &copy; 2026 Digital Magnet Business Solutions
    </footer>
  </main>
</body>
</html>`;

  return new NextResponse(html, {
    status: 403,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

  













  
  
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
