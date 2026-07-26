import { NextResponse } from "next/server";
import { z } from "zod";

export const approvalDecisionSchema = z.strictObject({
  decision: z.enum(["approved", "rejected"]),
  expected_revision: z.number().int().nonnegative(),
  note: z.string().trim().max(1_000).optional(),
});

export interface ApprovalRequestDto {
  id: string;
  account_id: string;
  flow_id: string;
  flow_version_id: string;
  flow_run_id: string;
  node_key: string;
  assignee_user_id: string;
  title: string;
  message: string;
  status: "pending" | "resolved" | "resuming" | "completed" | "failed";
  decision: "approved" | "rejected" | "timed_out" | null;
  revision: number;
  decision_note: string | null;
  decided_at: string | null;
  expires_at: string;
  created_at: string;
}

export function sanitizeApprovalRequest(
  row: Record<string, unknown>,
): ApprovalRequestDto {
  return {
    id: String(row.id),
    account_id: String(row.account_id),
    flow_id: String(row.flow_id),
    flow_version_id: String(row.flow_version_id),
    flow_run_id: String(row.flow_run_id),
    node_key: String(row.node_key),
    assignee_user_id: String(row.assignee_user_id),
    title: String(row.title),
    message: String(row.message),
    status: row.status as ApprovalRequestDto["status"],
    decision:
      row.decision === "approved" ||
      row.decision === "rejected" ||
      row.decision === "timed_out"
        ? row.decision
        : null,
    revision: Number(row.revision),
    decision_note:
      typeof row.decision_note === "string" ? row.decision_note : null,
    decided_at: typeof row.decided_at === "string" ? row.decided_at : null,
    expires_at: String(row.expires_at),
    created_at: String(row.created_at),
  };
}

export async function readApprovalDecision(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 5_000) {
    throw new Error("approval_request_too_large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 5_000) {
    throw new Error("approval_request_too_large");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("approval_invalid_json");
  }
  const parsed = approvalDecisionSchema.safeParse(value);
  if (!parsed.success) throw new Error("approval_invalid_request");
  return parsed.data;
}

export function approvalRpcError(error: unknown): NextResponse {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "";
  if (
    message.includes("approval_revision_conflict") ||
    message.includes("approval_already_decided")
  ) {
    return NextResponse.json(
      {
        code: "APPROVAL_CONFLICT",
        error: "This approval was already changed. Reload and retry.",
      },
      { status: 409 },
    );
  }
  if (
    message.includes("approval_not_found") ||
    message.includes("approval_unauthorized")
  ) {
    return NextResponse.json(
      { code: "APPROVAL_NOT_FOUND", error: "Approval not found." },
      { status: 404 },
    );
  }
  if (
    message.includes("approval_invalid") ||
    message.includes("invalid_flow_approval")
  ) {
    return NextResponse.json(
      { code: "APPROVAL_INVALID", error: "Invalid approval request." },
      { status: 400 },
    );
  }
  console.error("[flow-approval] operation failed");
  return NextResponse.json(
    {
      code: "APPROVAL_OPERATION_FAILED",
      error: "The approval operation could not be completed.",
    },
    { status: 500 },
  );
}
