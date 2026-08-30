// ============================================================
// GET /auth/callback
//
// The landing point for every link Supabase mails out — password
// recovery, signup confirmation, email-change confirmation. GoTrue
// appends `?code=<pkce-code>` to whatever `redirectTo` the client
// asked for; this handler trades that code for a real session
// cookie and then forwards the browser to the page that actually
// does something with it (`?next=`).
//
// Why this has to be a server route rather than a client page:
// `exchangeCodeForSession` is what mints the session, and the
// cookies it writes need to be on an HTTP response the browser
// stores before the destination page renders. Doing it client-side
// leaves a window where the destination loads unauthenticated.
//
// The PKCE verifier that pairs with `code` was written to a cookie
// by `createBrowserClient` when the user requested the email, so
// the server client reads it back off this same request.
// ============================================================

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * `next` arrives in a URL that anyone can forge and mail to a user,
 * so it is only ever allowed to name a path on this origin. A value
 * starting with `//` (or `/\`) is protocol-relative — browsers read
 * `//evil.com` as an absolute URL — which would turn this route into
 * an open redirect that borrows our domain's credibility.
 */
function safeNext(next: string | null): string {
  if (!next) return "/dashboard";
  if (!next.startsWith("/")) return "/dashboard";
  if (next.startsWith("//") || next.startsWith("/\\")) return "/dashboard";
  return next;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  // GoTrue reports a rejected link (expired, already consumed) by
  // redirecting here with `error_description` instead of a code.
  const errorDescription = searchParams.get("error_description");
  if (errorDescription) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorDescription)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        "That link is missing its confirmation code. Please request a new one."
      )}`
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
