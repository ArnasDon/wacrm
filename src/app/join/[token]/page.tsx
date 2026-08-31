// ============================================================
// /join/[token] — server shell around the invite-redemption UI.
//
// Reads the route's token and this deployment's `SIGNUP_MODE`
// (server-only env) so the client can render the right call to
// action. Redemption itself is unchanged and still happens against
// `/api/invitations/[token]/redeem`: an invite is always redeemable
// by someone who already has a login, whatever signup mode says.
// Signup mode governs only whether a *new* login may be minted here.
// ============================================================

import {
  allowsInviteSignup,
  allowsSelfServeSignup,
  getSignupMode,
} from "@/lib/auth/signup-mode";
import { JoinClient } from "./join-client";

// The mode must be read per request, not baked at build time.
export const dynamic = "force-dynamic";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const mode = getSignupMode();

  return (
    <JoinClient
      // Passed through verbatim. Next.js already decodes route
      // segments, so this is the same string `useParams` used to
      // hand the client — and decoding a second time would throw on
      // a stray `%` rather than degrading to "invite not found".
      token={token}
      inviteSignupAllowed={allowsInviteSignup(mode)}
      selfServeSignupAllowed={allowsSelfServeSignup(mode)}
    />
  );
}
