import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";
import { sanitizeApprovalRequest } from "@/lib/flows/approval-api";
import { supabaseAdmin } from "@/lib/flows/admin-client";

const SAFE_COLUMNS =
  "id,account_id,flow_id,flow_version_id,flow_run_id,node_key,assignee_user_id,title,message,status,decision,revision,decision_note,decided_at,expires_at,created_at";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const account = await getCurrentAccount();
    const { id } = await context.params;
    const { data, error } = await supabaseAdmin()
      .from("flow_approval_requests")
      .select(SAFE_COLUMNS)
      .eq("id", id)
      .eq("account_id", account.accountId)
      .maybeSingle();
    if (error || !data) {
      return NextResponse.json(
        { code: "APPROVAL_NOT_FOUND", error: "Approval not found." },
        { status: 404 },
      );
    }
    if (
      !hasMinRole(account.role, "admin") &&
      (data as { assignee_user_id?: string }).assignee_user_id !==
        account.userId
    ) {
      return NextResponse.json(
        { code: "APPROVAL_NOT_FOUND", error: "Approval not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({
      approval: sanitizeApprovalRequest(data as Record<string, unknown>),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
