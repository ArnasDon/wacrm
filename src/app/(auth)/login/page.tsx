// ============================================================
// /login — thin server shell around the client sign-in form.
//
// Its only job is to read `SIGNUP_MODE` (server-only env, absent
// from the browser bundle) and hand the answer to the form, which
// uses it to decide whether a "Create account" link would lead
// anywhere. Sign-in itself is untouched by signup mode: existing
// users always sign in, however locked down registration is.
//
// The Suspense boundary stays because the form reads
// `useSearchParams` (invite token, `?error=` from /auth/callback),
// which opts it out of static prerendering.
// ============================================================

import { Suspense } from "react";

import { getSignupMode } from "@/lib/auth/signup-mode";
import { LoginForm } from "./login-form";

// Without this the page prerenders at build time and `SIGNUP_MODE`
// is baked into the static RSC payload — an operator who later
// flips the variable would keep seeing the old CTA until the next
// build. Nothing here is cacheable anyway; it's an auth form.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm signupMode={getSignupMode()} />
    </Suspense>
  );
}
