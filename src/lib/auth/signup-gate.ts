// ============================================================
// Server-side signup gate.
//
// Answers one question for the /signup route: given this
// deployment's `SIGNUP_MODE` and the invite token (if any) the
// visitor arrived with, may we render the registration form?
//
// The invite check runs against `peek_invitation` — the same
// SECURITY DEFINER RPC the /join page uses — so `invite_only`
// means a *real, unredeemed, unexpired* token, not merely the
// presence of an `?invite=` parameter. Without that round trip
// the mode would be trivially defeated by `?invite=anything`.
//
// Server-only: pulls in `@/lib/supabase/server` (next/headers) and
// `node:crypto` via the token hasher.
// ============================================================

import { hashInviteToken } from "./invitations";
import {
  allowsInviteSignup,
  allowsSelfServeSignup,
  getSignupMode,
  type SignupMode,
} from "./signup-mode";
import { createClient } from "@/lib/supabase/server";

export type SignupDenialReason =
  /** Mode is `disabled`; nobody may register here. */
  | "disabled"
  /** Mode is `invite_only` and the visitor brought no token. */
  | "invite_required"
  /** Mode is `invite_only` and the token is unusable or unverifiable. */
  | "invalid_invite";

export type SignupAccess =
  | { allowed: true; mode: SignupMode }
  | { allowed: false; mode: SignupMode; reason: SignupDenialReason };

/** Shape returned by the `peek_invitation` RPC (see migration 019). */
interface PeekResult {
  ok?: boolean;
}

/**
 * Decide whether the signup form may be shown.
 *
 * `inviteToken` is the raw `?invite=` value from the URL, or null.
 *
 * Failure of the peek round trip denies rather than allows: a
 * transient database blip should not become a window in which the
 * `invite_only` front door stands open. The invitee retries from
 * the same link and gets in.
 */
export async function resolveSignupAccess(
  inviteToken: string | null,
): Promise<SignupAccess> {
  const mode = getSignupMode();

  if (allowsSelfServeSignup(mode)) return { allowed: true, mode };

  if (!allowsInviteSignup(mode)) {
    return { allowed: false, mode, reason: "disabled" };
  }

  // invite_only from here down.
  if (!inviteToken) {
    return { allowed: false, mode, reason: "invite_required" };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("peek_invitation", {
      p_token_hash: hashInviteToken(inviteToken),
    });

    if (error) {
      console.error("[signup-gate] peek_invitation failed:", error);
      return { allowed: false, mode, reason: "invalid_invite" };
    }

    if ((data as PeekResult | null)?.ok === true) {
      return { allowed: true, mode };
    }
    return { allowed: false, mode, reason: "invalid_invite" };
  } catch (err) {
    console.error("[signup-gate] peek_invitation threw:", err);
    return { allowed: false, mode, reason: "invalid_invite" };
  }
}
