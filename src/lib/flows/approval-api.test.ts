import { describe, expect, it } from "vitest";

import {
  approvalDecisionSchema,
  approvalRpcError,
  sanitizeApprovalRequest,
} from "./approval-api";

describe("approval API boundary", () => {
  it("accepts bounded CAS decisions and rejects extra or oversized fields", () => {
    expect(
      approvalDecisionSchema.safeParse({
        decision: "approved",
        expected_revision: 0,
        note: "Looks good",
      }).success,
    ).toBe(true);
    expect(
      approvalDecisionSchema.safeParse({
        decision: "approved",
        expected_revision: 0,
        note: "x".repeat(1_001),
      }).success,
    ).toBe(false);
    expect(
      approvalDecisionSchema.safeParse({
        decision: "approved",
        expected_revision: 0,
        decided_by: "forged",
      }).success,
    ).toBe(false);
  });

  it("returns a minimal DTO without contact channels or internal claim tokens", () => {
    const dto = sanitizeApprovalRequest({
      id: "request-1",
      account_id: "account-1",
      flow_id: "flow-1",
      flow_version_id: "version-1",
      flow_run_id: "run-1",
      node_key: "approval",
      assignee_user_id: "user-1",
      title: "Review",
      message: "Review this",
      status: "pending",
      decision: null,
      revision: 0,
      decision_note: null,
      decided_at: null,
      expires_at: "2026-01-01T00:00:00.000Z",
      created_at: "2025-12-31T00:00:00.000Z",
      resolution_token: "secret",
      email: "private@example.com",
      phone: "+15555550123",
    });

    expect(dto).not.toHaveProperty("resolution_token");
    expect(dto).not.toHaveProperty("email");
    expect(dto).not.toHaveProperty("phone");
    expect(dto).toMatchObject({
      id: "request-1",
      title: "Review",
      revision: 0,
    });
  });

  it("maps conflicts and authorization without leaking database messages", async () => {
    const conflict = approvalRpcError({
      message: "approval_revision_conflict details",
    });
    const forbidden = approvalRpcError({ message: "approval_not_found" });
    const unknown = approvalRpcError({ message: "postgres internals" });

    expect(conflict.status).toBe(409);
    expect(forbidden.status).toBe(404);
    expect(unknown.status).toBe(500);
    expect(await unknown.json()).toEqual({
      code: "APPROVAL_OPERATION_FAILED",
      error: "The approval operation could not be completed.",
    });
  });
});
