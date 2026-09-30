// ============================================================
// POST /api/partners/:id/resend-invitation
//
// Rotates the token (the previous link stops working immediately),
// resets the expiry, and re-sends the email. Allowed for PENDING and
// EXPIRED invitations. Limited to PARTNER_INVITATION_RESEND_LIMIT
// (default 3) per invitation per hour, enforced atomically in the
// `resend_partner_invitation` RPC so it holds across instances.
// ============================================================

import { NextResponse } from "next/server";

import { requireMainUser, toErrorResponse } from "@/lib/auth/account";
import { getBaseUrl } from "@/lib/auth/base-url";
import {
  generatePartnerToken,
  partnerInvitationExpiresAt,
  partnerInvitationExpiryHours,
  partnerResendLimit,
  PARTNER_RESEND_WINDOW_SECONDS,
} from "@/lib/partners/invitations";
import {
  accountExistsForEmail,
  deliverPartnerInvitation,
  getInviterIdentity,
  getOwnedInvitation,
  isUuid,
  partnersDb,
} from "@/lib/partners/server";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

type ResendOutcome =
  | { outcome: "ok" }
  | { outcome: "not_found" }
  | { outcome: "not_resendable"; status: string }
  | { outcome: "rate_limited"; retry_after_seconds: number };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireMainUser();

    const limit = checkRateLimit(`partners:resend:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Partner not found" }, { status: 404 });
    }
    const db = partnersDb();

    const invitation = await getOwnedInvitation(db, ctx.userId, id);
    if (!invitation) {
      return NextResponse.json({ error: "Partner not found" }, { status: 404 });
    }
    if (invitation.status !== "PENDING" && invitation.status !== "EXPIRED") {
      return NextResponse.json(
        { error: `A ${invitation.status.toLowerCase()} invitation cannot be resent` },
        { status: 409 },
      );
    }
    if (await accountExistsForEmail(db, invitation.email)) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 },
      );
    }

    const expiryHours = partnerInvitationExpiryHours();
    const { token, hash } = generatePartnerToken();

    const { data, error } = await db.rpc("resend_partner_invitation", {
      p_invitation_id: id,
      p_parent_user_id: ctx.userId,
      p_token_hash: hash,
      p_expires_at: partnerInvitationExpiresAt(expiryHours).toISOString(),
      p_limit: partnerResendLimit(),
      p_window_seconds: PARTNER_RESEND_WINDOW_SECONDS,
    });

    if (error) {
      if (error.code === "23505") {
        // An EXPIRED row being revived while a newer PENDING invite
        // for the same email exists.
        return NextResponse.json(
          { error: "A newer pending invitation for this email already exists" },
          { status: 409 },
        );
      }
      console.error("[resend-invitation] rpc error:", error);
      return NextResponse.json({ error: "Failed to resend invitation" }, { status: 500 });
    }

    const result = data as ResendOutcome;
    switch (result.outcome) {
      case "not_found":
        return NextResponse.json({ error: "Partner not found" }, { status: 404 });
      case "not_resendable":
        return NextResponse.json(
          { error: "This invitation can no longer be resent" },
          { status: 409 },
        );
      case "rate_limited":
        return NextResponse.json(
          {
            error: `Resend limit reached. Try again in ${Math.ceil(result.retry_after_seconds / 60)} minute(s).`,
            retry_after_seconds: result.retry_after_seconds,
          },
          { status: 429, headers: { "Retry-After": String(result.retry_after_seconds) } },
        );
    }

    const delivery = await deliverPartnerInvitation({
      to: invitation.email,
      companyName: invitation.company_name,
      inviter: await getInviterIdentity(db, ctx.userId),
      token,
      baseUrl: getBaseUrl(request, "[POST /api/partners/:id/resend-invitation]"),
      expiryHours,
    });

    return NextResponse.json({ ok: true, ...delivery });
  } catch (err) {
    return toErrorResponse(err);
  }
}
