// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role and/or their conversation
//            scope.                    Admin+.
//   DELETE — remove a member.          Admin+.
//
// Both delegate to SECURITY DEFINER RPCs from migrations 018/040:
//   - set_member_role(p_user_id, p_new_role)
//   - set_member_conversation_access(p_user_id, p_can_view_all)
//   - remove_account_member(p_user_id)
//
// The RPCs do the *real* authorisation work — caller must be
// admin+, target must be in caller's account, target can't be the
// owner, can't be self. The TS layer here only forwards the call
// and maps Postgres SQLSTATEs back to HTTP statuses.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole, type AccountRole } from "@/lib/auth/roles";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// Map known SQLSTATEs from the RPCs (see migration 018) onto HTTP
// statuses. The `error.code` field is the SQLSTATE; the `message`
// is the human-readable RAISE message we put in the migration.
function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[members route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update member" },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRole:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    // Both fields are optional, but the body has to ask for
    // *something* — a PATCH with neither is a caller bug, not a
    // successful no-op.
    const body = (await request.json().catch(() => null)) as
      | { role?: unknown; can_view_all_conversations?: unknown }
      | null;
    const role = body?.role;
    const canViewAll = body?.can_view_all_conversations;

    const wantsRole = role !== undefined;
    const wantsAccess = canViewAll !== undefined;

    if (!wantsRole && !wantsAccess) {
      return NextResponse.json(
        {
          error:
            "Provide 'role' and/or 'can_view_all_conversations' to update",
        },
        { status: 400 },
      );
    }

    if (wantsRole) {
      if (!isAccountRole(role)) {
        return NextResponse.json(
          { error: "'role' must be one of owner, admin, agent, viewer" },
          { status: 400 },
        );
      }

      // The RPC blocks promotion to / demotion from owner, but
      // surface the friendlier 400 before crossing the wire too.
      if (role === "owner") {
        return NextResponse.json(
          {
            error:
              "Use POST /api/account/transfer-ownership to promote a member to owner",
          },
          { status: 400 },
        );
      }
    }

    if (wantsAccess && typeof canViewAll !== "boolean") {
      return NextResponse.json(
        { error: "'can_view_all_conversations' must be a boolean" },
        { status: 400 },
      );
    }

    // Role first: if both are present and the role change is
    // rejected, the scope change shouldn't land either. The reverse
    // order would leave a member restricted under a role they were
    // never actually moved to.
    if (wantsRole) {
      const { error } = await ctx.supabase.rpc("set_member_role", {
        p_user_id: userId,
        p_new_role: role as AccountRole,
      });
      if (error) return rpcErrorToResponse(error);
    }

    if (wantsAccess) {
      const { error } = await ctx.supabase.rpc(
        "set_member_conversation_access",
        { p_user_id: userId, p_can_view_all: canViewAll as boolean },
      );
      if (error) return rpcErrorToResponse(error);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const { data, error } = await ctx.supabase.rpc("remove_account_member", {
      p_user_id: userId,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true, newPersonalAccountId: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
