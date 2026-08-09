// ============================================================
// signup-gate.ts — pure decision logic for the public /signup page.
//
// Public sign-up is closed (see `DISABLE_SIGNUP=true` on GoTrue,
// the server-side half of this gate). The only way to create an
// account client-side is by following an invite link, which lands
// on /signup?invite=<token>. This helper is the single source of
// truth for "does this visit get to see the sign-up form" so the
// page component and any future entry point (e.g. a server action)
// stay in sync without duplicating the condition.
//
// Kept as a pure function (no React, no Supabase) so it's trivially
// unit-testable — the page component itself has no test harness in
// this repo (vitest runs in the "node" environment, no jsdom/RTL).
// ============================================================

/**
 * Whether the sign-up form should be shown for a given `?invite=`
 * query param value. `null`/`undefined`/empty string (no token, or
 * a stripped/whitespace-only one) means "arrived here directly" —
 * gated. Anything else means "arrived via an invite link" — allowed
 * to attempt signup (GoTrue + the invite-redemption flow still do
 * their own validation; this only controls whether the form renders).
 */
export function shouldAllowSignup(inviteToken: string | null | undefined): boolean {
  return typeof inviteToken === "string" && inviteToken.trim().length > 0;
}
