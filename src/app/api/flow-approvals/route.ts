import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";
import { sanitizeApprovalRequest } from "@/lib/flows/approval-api";
import { supabaseAdmin } from "@/lib/flows/admin-client";

const SAFE_COLUMNS = [
  "id",
  "account_id",
  "flow_id",
  "flow_version_id",
  "flow_run_id",
  "node_key",
  "assignee_user_id",
  "title",
  "message",
  "status",
  "decision",
  "revision",
  "decision_note",
  "decided_at",
  "expires_at",
  "created_at",
].join(",");

export async function GET() {
  try {
    const context = await getCurrentAccount();
    let query = supabaseAdmin()
      .from("flow_approval_requests")
      .select(SAFE_COLUMNS)
      .eq("account_id", context.accountId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!hasMinRole(context.role, "admin")) {
      query = query.eq("assignee_user_id", context.userId);
    }
    const { data, error } = await query;
    if (error) {
      console.error("[flow-approvals] list failed");
      return NextResponse.json(
        { error: "Could not load approvals." },
        { status: 500 },
      );
    }
    return NextResponse.json({
      approvals: (data ?? []).map((row) =>
        sanitizeApprovalRequest(row as unknown as Record<string, unknown>),
      ),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
