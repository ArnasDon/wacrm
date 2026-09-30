// ============================================================
// GET /api/partner-invitations/validate?token=… — public.
//
// Lets /partner/signup decide what to render before the visitor
// types anything. The plaintext token is hashed here and looked up
// by `token_hash`; it never reaches the database.
//
// Responses (fixed shape — no columns beyond what the page shows):
//   200 { state: "valid", invitation: { companyName, email, phone,
//                                       expiresAt, inviterName } }
//   200 { state: "expired" | "used" | "revoked" | "account_exists" }
//   404 { state: "invalid" }
//   429 rate limited (per IP)
// ============================================================

import { NextResponse } from "next/server";

import {
  hashPartnerToken,
  looksLikePartnerToken,
} from "@/lib/partners/invitations";
import {
  accountExistsForEmail,
  getClientIp,
  getInviterIdentity,
  partnersDb,
  type PartnerInvitationRow,
} from "@/lib/partners/server";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const limit = checkRateLimit(
    `partnerPeek:${getClientIp(request)}`,
    RATE_LIMITS.invitationPeek,
  );
  if (!limit.success) return rateLimitResponse(limit);

  const token = new URL(request.url).searchParams.get("token");
  if (!looksLikePartnerToken(token)) {
    return NextResponse.json({ state: "invalid" }, { status: 404, headers: NO_STORE });
  }

  try {
    const db = partnersDb();
    const { data, error } = await db
      .from("partner_invitations")
      .select("id, parent_user_id, email, company_name, phone, status, expires_at")
      .eq("token_hash", hashPartnerToken(token))
      .maybeSingle();
    if (error) throw error;

    const inv = data as Pick<
      PartnerInvitationRow,
      "id" | "parent_user_id" | "email" | "company_name" | "phone" | "status" | "expires_at"
    > | null;
    if (!inv) {
      return NextResponse.json({ state: "invalid" }, { status: 404, headers: NO_STORE });
    }

    if (inv.status === "ACCEPTED") {
      return NextResponse.json({ state: "used" }, { headers: NO_STORE });
    }
    if (inv.status === "REVOKED") {
      return NextResponse.json({ state: "revoked" }, { headers: NO_STORE });
    }
    if (inv.status === "EXPIRED" || new Date(inv.expires_at).getTime() <= Date.now()) {
      if (inv.status === "PENDING") {
        await db
          .from("partner_invitations")
          .update({ status: "EXPIRED" })
          .eq("id", inv.id)
          .eq("status", "PENDING");
      }
      return NextResponse.json({ state: "expired" }, { headers: NO_STORE });
    }
    if (await accountExistsForEmail(db, inv.email)) {
      return NextResponse.json({ state: "account_exists" }, { headers: NO_STORE });
    }

    const inviter = await getInviterIdentity(db, inv.parent_user_id);
    return NextResponse.json(
      {
        state: "valid",
        invitation: {
          companyName: inv.company_name,
          email: inv.email,
          phone: inv.phone,
          expiresAt: inv.expires_at,
          inviterName: inviter.name || inviter.email,
        },
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[partner-invitations/validate] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
