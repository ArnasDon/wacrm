// ============================================================
// Signup mode — instance-wide control over who may create an
// account on this deployment.
//
// Why an env var and not an account setting
// -----------------------------------------
// "Can a stranger register?" is a property of the *deployment*,
// not of any one account: a signup creates a brand-new account
// (see `handle_new_user` in 017_account_sharing.sql), so there is
// no existing account whose settings could govern it. Putting the
// switch in the environment also means an operator can lock down a
// self-hosted instance without first having to sign in to it.
//
// Modes
// -----
//   open         (default) anyone may self-register at /signup.
//   invite_only  /signup only works when the visitor arrives with
//                a valid, unredeemed invite token. Teams stay able
//                to onboard new people via Settings → Members
//                while the front door is shut.
//   disabled     /signup is off entirely. New teammates must
//                already have a login before an invite can be
//                redeemed.
//
// Enforcement boundary — read this before relying on it
// -----------------------------------------------------
// Everything this module gates is *application* level: the /signup
// route, the links that point at it, and the join page's
// "Create account" CTA. Account creation itself is performed by
// `supabase.auth.signUp()` from the browser straight against
// GoTrue, which never passes through this app. Someone who scripts
// that endpoint directly can still register while the app says
// signups are closed.
//
// For a hard guarantee, also turn off Supabase Dashboard →
// Authentication → Sign In / Providers → "Allow new users to sign
// up". Note that this blocks invited users too, so pair it with
// `disabled` (not `invite_only`) and create teammates from the
// Supabase dashboard.
// ============================================================

export type SignupMode = "open" | "invite_only" | "disabled";

/** Every valid mode, most permissive first. */
export const SIGNUP_MODES: readonly SignupMode[] = [
  "open",
  "invite_only",
  "disabled",
] as const;

/** What an unset `SIGNUP_MODE` means — unchanged from pre-feature behaviour. */
export const DEFAULT_SIGNUP_MODE: SignupMode = "open";

/**
 * Spellings we accept for each mode. Operators reach for
 * `SIGNUP_MODE=false` or `SIGNUP_MODE=invite-only` at least as
 * often as the canonical value, and silently mis-parsing either
 * one is worse than accepting both.
 */
const ALIASES: Record<string, SignupMode> = {
  open: "open",
  enabled: "open",
  true: "open",
  on: "open",
  yes: "open",
  public: "open",

  invite_only: "invite_only",
  inviteonly: "invite_only",
  invite: "invite_only",
  invited: "invite_only",

  disabled: "disabled",
  disable: "disabled",
  false: "disabled",
  off: "disabled",
  no: "disabled",
  closed: "disabled",
  none: "disabled",
};

/**
 * Normalise a raw env value into a `SignupMode`.
 *
 * Unset / empty → `open`, i.e. an existing deployment that never
 * sets the variable keeps working exactly as before.
 *
 * A value we don't recognise → `disabled`, with a warning. The
 * operator plainly meant to restrict *something*; guessing "open"
 * on a typo would hand them a wide-open front door they believe is
 * shut, which is the one outcome worth failing loudly to avoid.
 */
export function parseSignupMode(raw: string | undefined | null): SignupMode {
  if (raw === undefined || raw === null) return DEFAULT_SIGNUP_MODE;

  const normalised = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalised === "") return DEFAULT_SIGNUP_MODE;

  const mode = ALIASES[normalised];
  if (mode) return mode;

  console.warn(
    `[signup-mode] Unrecognised SIGNUP_MODE=${JSON.stringify(raw)}. ` +
      `Falling back to "disabled". Valid values: ${SIGNUP_MODES.join(", ")}.`,
  );
  return "disabled";
}

/**
 * The deployment's current mode. Reads `SIGNUP_MODE` from the
 * environment on every call — deliberately not cached, so a
 * platform that swaps env between requests (or a test that mutates
 * `process.env`) sees the change without a restart.
 *
 * Server-side only in practice: `SIGNUP_MODE` has no `NEXT_PUBLIC_`
 * prefix, so it is absent in the browser bundle and would read as
 * `open` there. Resolve it in a server component / route handler
 * and pass the result down as a prop.
 */
export function getSignupMode(): SignupMode {
  return parseSignupMode(process.env.SIGNUP_MODE);
}

/** True when a visitor with no invite may register. */
export function allowsSelfServeSignup(mode: SignupMode): boolean {
  return mode === "open";
}

/** True when a visitor holding a valid invite may register. */
export function allowsInviteSignup(mode: SignupMode): boolean {
  return mode !== "disabled";
}
