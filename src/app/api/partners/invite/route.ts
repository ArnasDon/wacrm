// ============================================================
// POST /api/partners/invite — create a Partner invitation and email it.
//
// Body: { companyName, email, phone }. The parent user is ALWAYS the
// authenticated Main User; any owner/role field in the body is
// ignored by construction (it is never read).
//
// Responses
//   201 { invitation, emailSent, signupUrl? }
//   400 validation error          403 not a Main User
//   409 account / pending invite already exists
//   429 rate limited
//
// `signupUrl` is only present when the email could not be delivered
// (e.g. RESEND_API_KEY not configured), so the inviter can share the
// link manually. It is never stored.
// ============================================================

import { NextResponse } from "next/server";

import { requireMainUser, toErrorResponse } from "@/lib/auth/account";
import { getBaseUrl } from "@/lib/auth/base-url";
import {
  generatePartnerToken,
  partnerInvitationExpiresAt,
  partnerInvitationExpiryHours,
} from "@/lib/partners/invitations";
import {
  accountExistsForEmail,
  deliverPartnerInvitation,
  expireStaleInvitations,
  getInviterIdentity,
  partnersDb,
} from "@/lib/partners/server";
import { describeFieldError, validatePartnerInvite } from "@/lib/partners/validation";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const ctx = await requireMainUser();

    const limit = checkRateLimit(`partners:invite:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const parsed = validatePartnerInvite(body);
    if (!parsed.ok) {
      const [field, code] = Object.entries(parsed.errors)[0];
      return NextResponse.json(
        { error: describeFieldError(field, code!), fields: parsed.errors },
        { status: 400 },
      );
    }
    const { companyName, email, phone } = parsed.value;
    const db = partnersDb();

    const inviter = await getInviterIdentity(db, ctx.userId);
    if (inviter.email.toLowerCase() === email) {
      return NextResponse.json(
        { error: "You cannot invite yourself", fields: { email: "duplicate" } },
        { status: 400 },
      );
    }

    if (await accountExistsForEmail(db, email)) {
      return NextResponse.json(
        { error: "An account with this email already exists", fields: { email: "accountExists" } },
        { status: 409 },
      );
    }

    // Free the one-pending-per-email slot held by lapsed invitations
    // before checking for a live duplicate.
    await expireStaleInvitations(db, { email });

    const expiryHours = partnerInvitationExpiryHours();
    const { token, hash } = generatePartnerToken();

    const { data: invitation, error } = await db
      .from("partner_invitations")
      .insert({
        parent_user_id: ctx.userId,
        email,
        company_name: companyName,
        phone,
        token_hash: hash,
        status: "PENDING",
        expires_at: partnerInvitationExpiresAt(expiryHours).toISOString(),
        last_sent_at: new Date().toISOString(),
      })
      .select("id, email, company_name, phone, status, expires_at, created_at")
      .single();

    if (error || !invitation) {
      if (error?.code === "23505") {
        return NextResponse.json(
          {
            error: "A pending invitation for this email already exists",
            fields: { email: "pendingInvitation" },
          },
          { status: 409 },
        );
      }
      console.error("[POST /api/partners/invite] insert error:", error);
      return NextResponse.json({ error: "Failed to create invitation" }, { status: 500 });
    }

    const delivery = await deliverPartnerInvitation({
      to: email,
      companyName,
      inviter,
      token,
      baseUrl: getBaseUrl(request, "[POST /api/partners/invite]"),
      expiryHours,
    });

    return NextResponse.json({ invitation, ...delivery }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
