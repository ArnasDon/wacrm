import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { locales, defaultLocale, type Locale } from "@/i18n/config";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Copy refreshed cookies onto whatever response we return to prevent
  // session wedge after token rotation (issue #288).
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie);
    });
    return response;
  };

  // --- Auth page redirects (locale-aware) ---
  // Match /{locale}/login, /{locale}/signup, /{locale}/forgot-password
  const authPageRegex = /^\/[a-z]{2}(?:\/(login|signup|forgot-password))?$/;
  const authPageMatch = request.nextUrl.pathname.match(authPageRegex);

  // Also match bare /login, /signup, /forgot-password (no locale prefix)
  // so direct hits from old bookmarks still work.
  const bareAuthPaths = ["/login", "/signup", "/forgot-password"];
  const isAuthPage =
    bareAuthPaths.includes(request.nextUrl.pathname) ||
    (authPageMatch && authPageMatch[1]);

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    // Preserve the locale prefix if present
    const localeMatch = request.nextUrl.pathname.match(/^\/([a-z]{2})\//);
    const localePrefix = localeMatch ? `/${localeMatch[1]}` : "";

    const inviteToken = request.nextUrl.searchParams.get("invite");
    if (
      inviteToken &&
      (request.nextUrl.pathname.includes("/login") ||
        request.nextUrl.pathname.includes("/signup"))
    ) {
      url.pathname = `${localePrefix}/join/${encodeURIComponent(inviteToken)}`;
      url.search = "";
    } else {
      url.pathname = `${localePrefix}/dashboard`;
      url.search = "";
    }
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // --- Protected pages ---
  const protectedSegments = [
    "dashboard",
    "inbox",
    "contacts",
    "pipelines",
    "broadcasts",
    "automations",
    "flows",
    "settings",
  ];
  const isProtectedPage = protectedSegments.some(
    (segment) =>
      request.nextUrl.pathname.includes(`/${segment}`) ||
      request.nextUrl.pathname === `/${segment}`,
  );

  if (!user && isProtectedPage) {
    const url = request.nextUrl.clone();
    // Try to preserve locale prefix
    const localeMatch = request.nextUrl.pathname.match(/^\/([a-z]{2})\//);
    const localePrefix = localeMatch ? `/${localeMatch[1]}` : "";
    url.pathname = `${localePrefix}/login`;
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // --- API routes that need auth (not webhooks) ---
  if (
    !user &&
    request.nextUrl.pathname.startsWith("/api/whatsapp/") &&
    !request.nextUrl.pathname.includes("/webhook")
  ) {
    return withRefreshedCookies(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
  }

  // --- i18n routing (manual locale detection) ---
  // Skip for API routes — they don't use locale-based routing.
  const pathname = request.nextUrl.pathname;
  const isApiRoute = pathname.startsWith("/api/");

  if (!isApiRoute) {
    const pathnameHasLocale = locales.some(
      (locale) =>
        pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`,
    );

    if (!pathnameHasLocale) {
      const url = request.nextUrl.clone();
      url.pathname = `/${defaultLocale}${pathname}`;
      return withRefreshedCookies(NextResponse.redirect(url));
    }

    // Reject invalid locale prefixes (e.g. /xx/settings → /en/settings).
    const locale = pathname.split("/")[1];
    if (locale && !locales.includes(locale as Locale)) {
      const rest = pathname.slice(3); // strip "/xx"
      const url = request.nextUrl.clone();
      url.pathname = `/${defaultLocale}${rest}`;
      return withRefreshedCookies(NextResponse.redirect(url));
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Match all paths except static assets and API internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
