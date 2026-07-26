import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  approvalRpcError,
  readApprovalDecision,
  sanitizeApprovalRequest,
} from "@/lib/flows/approval-api";
import { resumeFlowApprovalResolutions } from "@/lib/flows/approval-runtime";
import { supabaseAdmin } from "@/lib/flows/admin-client";

export async function POST(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
) {
  try {
    const context = await getCurrentAccount();
    const { id } = await routeContext.params;
    let input;
    try {
      input = await readApprovalDecision(request);
    } catch (error) {
      return approvalRpcError(error);
    }
    const { data, error } = await context.supabase.rpc(
      "decide_flow_approval",
      {
        p_request_id: id,
        p_expected_revision: input.expected_revision,
        p_decision: input.decision,
        p_note: input.note ?? null,
      },
    );
    const row =
      data && typeof data === "object" && !Array.isArray(data) ? data : null;
    if (error || !row) return approvalRpcError(error);

    let resumed = false;
    try {
      const result = await resumeFlowApprovalResolutions(supabaseAdmin(), {
        requestId: id,
        limit: 1,
      });
      resumed = result.resumed === 1;
    } catch {
      // The durable resolved row remains claimable by the cron. A transient
      // worker failure must not roll back or invite a second human decision.
      console.error("[flow-approval] immediate resume deferred to cron");
    }
    return NextResponse.json({
      approval: sanitizeApprovalRequest(row as Record<string, unknown>),
      resumed,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
