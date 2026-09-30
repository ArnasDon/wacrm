// ============================================================
// PATCH /api/partners/:id/status — enable / disable a SubUser.
//
// Body: { status: "ACTIVE" | "DISABLED" }. `:id` is the invitation
// id from GET /api/partners. Only the SubUser's own Main User can do
// this: ownership is enforced on both the invitation and the profile
// (`parent_user_id = caller`, `role = 'SubUser'`).
//
// Disabling is enforced in three layers:
//   1. profiles.status = 'DISABLED' → is_account_member() is false,
//      so RLS denies every CRM table immediately (even for a still-
//      valid access token), and getCurrentAccount() 403s API routes.
//   2. Supabase Auth ban → the SubUser can't sign in or refresh.
//   3. The dashboard signs a DISABLED user out on its next profile load.
// Enabling reverses 1 and 2. The role stays 'SubUser' either way.
// ============================================================

import { NextResponse } from "next/server";

import { requireMainUser, toErrorResponse } from "@/lib/auth/account";
import { isUserStatus, type UserStatus } from "@/lib/auth/user-roles";
import { getOwnedInvitation, isUuid, partnersDb } from "@/lib/partners/server";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

// Supabase Auth has no "forever" — ~100 years is the conventional value.
const BAN_FOREVER = "876000h";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireMainUser();

    const limit = checkRateLimit(`partners:status:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Partner not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
    if (!isUserStatus(body?.status)) {
      return NextResponse.json(
        { error: "'status' must be ACTIVE or DISABLED" },
        { status: 400 },
      );
    }
    const nextStatus: UserStatus = body.status;
    const db = partnersDb();

    const invitation = await getOwnedInvitation(db, ctx.userId, id);
    if (!invitation || !invitation.created_user_id) {
      return NextResponse.json({ error: "Partner not found" }, { status: 404 });
    }
    const subUserId = invitation.created_user_id;

    const { data: profile, error: readErr } = await db
      .from("profiles")
      .select("user_id, status")
      .eq("user_id", subUserId)
      .eq("parent_user_id", ctx.userId)
      .eq("role", "SubUser")
      .maybeSingle();
    if (readErr) throw readErr;
    if (!profile) {
      return NextResponse.json({ error: "Partner not found" }, { status: 404 });
    }
    const previousStatus = profile.status as UserStatus;

    const { error: updateErr } = await db
      .from("profiles")
      .update({ status: nextStatus })
      .eq("user_id", subUserId)
      .eq("parent_user_id", ctx.userId)
      .eq("role", "SubUser");
    if (updateErr) throw updateErr;

    const { error: banErr } = await db.auth.admin.updateUserById(subUserId, {
      ban_duration: nextStatus === "DISABLED" ? BAN_FOREVER : "none",
    });
    if (banErr) {
      // Keep the two stores consistent: roll the profile back so the
      // Main User sees the real state and can retry.
      console.error("[partners/status] auth ban update failed:", banErr);
      await db
        .from("profiles")
        .update({ status: previousStatus })
        .eq("user_id", subUserId)
        .eq("parent_user_id", ctx.userId);
      return NextResponse.json(
        { error: "Could not update the partner's sign-in access. Please try again." },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, status: nextStatus });
  } catch (err) {
    return toErrorResponse(err);
  }
}
