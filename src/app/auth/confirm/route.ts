import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Supabase auth emails (password reset, invite, signup confirmation,
// magic link) that use the `token_hash` template land here. This is
// the OTP-verification flow, NOT the OAuth-style PKCE `code` flow —
// Supabase's recovery/invite/magic-link emails ship the token as a
// `token_hash` + `type` pair meant for `verifyOtp`, not a `code`
// meant for `exchangeCodeForSession`. Using the wrong method against
// the wrong link format is why this previously landed on /login
// instead of /reset-password: an exchangeCodeForSession-based
// handler never receives a `code` param at all for these email
// types, so it always fell through to the error redirect.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/dashboard";

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_confirm_failed`);
}
