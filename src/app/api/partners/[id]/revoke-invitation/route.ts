// ============================================================
// POST /api/partners/:id/revoke-invitation
//
// Marks a PENDING (or lapsed) invitation REVOKED; its link stops
// working immediately. Accepted invitations can't be revoked — use
// PATCH /api/partners/:id/status to disable the SubUser instead.
// ============================================================

import { NextResponse } from "next/server";

import { requireMainUser, toErrorResponse } from "@/lib/auth/account";
import { isUuid, partnersDb } from "@/lib/partners/server";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireMainUser();

    const limit = checkRateLimit(`partners:revoke:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json(
        { error: "Invitation not found or can no longer be revoked" },
        { status: 404 },
      );
    }

    // Ownership and state are both part of the WHERE clause, so the
    // update is a no-op for someone else's row or an accepted one.
    const { data, error } = await partnersDb()
      .from("partner_invitations")
      .update({ status: "REVOKED" })
      .eq("id", id)
      .eq("parent_user_id", ctx.userId)
      .in("status", ["PENDING", "EXPIRED"])
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[revoke-invitation] update error:", error);
      return NextResponse.json({ error: "Failed to revoke invitation" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: "Invitation not found or can no longer be revoked" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
