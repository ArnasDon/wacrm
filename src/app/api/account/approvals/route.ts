// ============================================================
// GET /api/account/approvals — List pending signups
// POST /api/account/approvals — Approve or reject a user signup
//
// Admin+ only. Used by Settings -> Team Members to review and
// approve/reject self-service signups before they get workspace access.
// ============================================================

import { NextResponse } from "next/server";
import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole, type AccountRole } from "@/lib/auth/roles";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const ctx = await requireRole("admin");
    const admin = getSupabaseAdmin();

    let pendingUsers: Array<{
      user_id: string;
      full_name: string;
      email: string;
      avatar_url: string | null;
      created_at: string;
    }> = [];

    const { data, error } = await admin
      .from("profiles")
      .select("user_id, full_name, email, created_at, avatar_url, approval_status, account_id")
      .eq("approval_status", "pending")
      .order("created_at", { ascending: false });

    // Resilient fallback if migration 045 hasn't been executed in Supabase SQL Editor yet
    if (error && (error as any).code === "42703") {
      const fallback = await admin
        .from("profiles")
        .select("user_id, full_name, email, created_at, avatar_url, account_id")
        .neq("account_id", ctx.accountId)
        .order("created_at", { ascending: false });

      if (fallback.error) {
        console.error("[GET /api/account/approvals] fallback error:", fallback.error);
        return NextResponse.json(
          { error: "Failed to load pending approvals" },
          { status: 500 },
        );
      }

      pendingUsers = (fallback.data ?? []).map((row) => ({
        user_id: row.user_id,
        full_name: row.full_name || "",
        email: row.email || "",
        avatar_url: row.avatar_url,
        created_at: row.created_at,
      }));
    } else if (error) {
      console.error("[GET /api/account/approvals] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load pending approvals" },
        { status: 500 },
      );
    } else {
      pendingUsers = (data ?? []).map((row) => ({
        user_id: row.user_id,
        full_name: row.full_name || "",
        email: row.email || "",
        avatar_url: row.avatar_url,
        created_at: row.created_at,
      }));
    }

    return NextResponse.json({ pendingUsers });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = await request.json();

    const { userId, action, role = "agent" } = body as {
      userId?: string;
      action?: "approve" | "reject";
      role?: AccountRole;
    };

    if (!userId || typeof userId !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid userId" },
        { status: 400 },
      );
    }

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { error: "Action must be 'approve' or 'reject'" },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdmin();

    if (action === "approve") {
      const assignedRole: AccountRole = isAccountRole(role) && role !== "owner" ? role : "agent";

      const payloadWithStatus = {
        account_id: ctx.accountId,
        account_role: assignedRole,
        approval_status: "approved",
        updated_at: new Date().toISOString(),
      };

      const { error: updateError } = await admin
        .from("profiles")
        .update(payloadWithStatus)
        .eq("user_id", userId);

      if (updateError && (updateError as any).code === "42703") {
        const { error: fallbackErr } = await admin
          .from("profiles")
          .update({
            account_id: ctx.accountId,
            account_role: assignedRole,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);

        if (fallbackErr) {
          console.error("[POST /api/account/approvals] fallback approve error:", fallbackErr);
          return NextResponse.json({ error: "Failed to approve user" }, { status: 500 });
        }
      } else if (updateError) {
        console.error("[POST /api/account/approvals] approve error:", updateError);
        return NextResponse.json(
          { error: "Failed to approve user" },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        message: "User successfully approved and joined to the workspace.",
      });
    }

    if (action === "reject") {
      const { error: updateError } = await admin
        .from("profiles")
        .update({
          approval_status: "rejected",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (updateError && (updateError as any).code === "42703") {
        await admin
          .from("profiles")
          .update({ account_id: null, updated_at: new Date().toISOString() })
          .eq("user_id", userId);
      } else if (updateError) {
        console.error("[POST /api/account/approvals] reject error:", updateError);
        return NextResponse.json(
          { error: "Failed to reject user" },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        message: "User registration rejected.",
      });
    }

    return NextResponse.json({ error: "Unhandled action" }, { status: 400 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
