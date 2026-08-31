// ============================================================
// /signup — server gate in front of the registration form.
//
// The decision has to happen here rather than inside the client
// form for two reasons:
//
//   1. `SIGNUP_MODE` carries no NEXT_PUBLIC_ prefix, so it does
//      not exist in the browser bundle. Reading it client-side
//      would always answer "open".
//   2. Validating an `?invite=` token means a `peek_invitation`
//      round trip, and a gate the client evaluates is a gate the
//      client can skip.
//
// Rendering the form at all is the permission — the form itself
// stays a dumb component that assumes it was allowed to appear.
// ============================================================

import { resolveSignupAccess } from "@/lib/auth/signup-gate";
import { SignupClosed } from "./signup-closed";
import { SignupForm } from "./signup-form";

// `searchParams` makes this route dynamic, which is what we want:
// the mode is read from the environment per request, so an
// operator flipping SIGNUP_MODE takes effect on the next request
// rather than at the next build.
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.invite;
  // `?invite=a&invite=b` arrives as an array. Take the first entry
  // rather than rejecting outright — a duplicated param is far more
  // likely to be a forwarded/mangled link than an attack, and the
  // token still has to survive `peek_invitation`.
  const inviteToken =
    typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? null) : null;

  const access = await resolveSignupAccess(inviteToken);

  if (!access.allowed) {
    return <SignupClosed reason={access.reason} inviteToken={inviteToken} />;
  }

  return <SignupForm inviteToken={inviteToken} />;
}
