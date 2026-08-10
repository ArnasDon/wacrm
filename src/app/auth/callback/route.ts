import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { defaultLocale } from '@/i18n/config';

// Supabase auth callback handler (PKCE code exchange).
//
// Email confirmation, magic-link, and password-recovery emails send the user
// to a URL carrying a one-time `?code=...` (and, for recovery, a `type`).
// The browser Supabase client that started the flow stored a PKCE verifier in
// a cookie; here on the server we trade the code for a real session and set
// the session cookies before redirecting the user into the app.
//
// This route lives OUTSIDE the [locale] segment on purpose: the confirmation
// link's base URL is the Supabase project "Site URL", which has no locale
// prefix. The middleware bypasses next-intl for `/auth/*` so this handler runs
// directly (see src/middleware.ts).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');

  // Where to send the user after a successful exchange. `next` is an
  // app-relative path (e.g. /reset-password); we sanitize it to avoid open
  // redirects and always prefix the default locale.
  const rawNext = searchParams.get('next');
  const safeNext =
    rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//')
      ? rawNext
      : '/dashboard';
  const destination = `/${defaultLocale}${safeNext}`;

  if (!code) {
    // No code to exchange — bounce to login with an error flag.
    return NextResponse.redirect(
      new URL(`/${defaultLocale}/login?error=missing_code`, origin)
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/${defaultLocale}/login?error=${encodeURIComponent(error.message)}`,
        origin
      )
    );
  }

  return NextResponse.redirect(new URL(destination, origin));
}
