import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
  previewDigest: "a".repeat(64),
  blocking: false,
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: h.requireRole,
  toErrorResponse: () =>
    Response.json({ code: "IMPORT_FORBIDDEN" }, { status: 403 }),
}));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({ rpc: h.rpc }),
}));

vi.mock("@/lib/flows/flow-code-server", () => ({
  loadFlowCodeCatalog: async () => ({ resources: [], flows: [] }),
  previewFlowCode: () => ({
    preview: {
      normalized: "{}\n",
      digest: h.previewDigest,
      resolved: {},
      secret_requirements: [],
      issues: h.blocking
        ? [
            {
              code: "RESOURCE_MISSING",
              severity: "blocking",
              message: "missing",
            },
          ]
        : [],
    },
    graph: {
      name: "Imported",
      description: null,
      trigger_type: "manual",
      trigger_config: {},
      entry_node_id: null,
      fallback_policy: {
        on_unknown_reply: "reprompt",
        max_reprompts: 2,
        on_timeout_hours: 24,
        on_exhaust: "handoff",
      },
      variable_schema: [],
      nodes: [],
    },
  }),
  hasCommitBlockingIssues: (
    issues: Array<{ severity: string }>,
  ) => issues.some((issue) => issue.severity === "blocking"),
  safeImportRpcError: (message: string) =>
    message.includes("draft_revision_conflict")
      ? { status: 409, code: "DRAFT_REVISION_CONFLICT" }
      : { status: 500, code: "IMPORT_FAILED" },
}));

import { POST as CREATE } from "./route";
import { POST as REPLACE } from "../[id]/import/route";
import { parseFlowCodeInput } from "@/lib/flows/flow-code";

const document = JSON.stringify({
  kind: "wacrm.flow",
  schema_version: 1,
  name: "Imported",
  description: null,
  trigger: { type: "manual", config: {} },
  fallback: {
    on_unknown_reply: "reprompt",
    max_reprompts: 2,
    on_timeout_hours: 24,
    on_exhaust: "handoff",
  },
  variables: [],
  resources: [],
  secret_requirements: [],
  entry: null,
  nodes: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  h.previewDigest = parseFlowCodeInput(document).digest;
  h.blocking = false;
  h.requireRole.mockResolvedValue({
    userId: "actor-1",
    accountId: "account-1",
    role: "agent",
  });
  h.rpc.mockResolvedValue({
    data: [{ id: "flow-1", draft_revision: 0 }],
    error: null,
  });
});

describe("flow code commit APIs", () => {
  it("creates a draft only through the atomic account-scoped RPC", async () => {
    const response = await CREATE(
      new Request("http://localhost/api/flows/import", {
        method: "POST",
        body: JSON.stringify({
          document,
          preview_digest: h.previewDigest,
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(h.rpc).toHaveBeenCalledOnce();
    expect(h.rpc).toHaveBeenCalledWith(
      "import_flow_draft",
      expect.objectContaining({
        p_actor_id: "actor-1",
        p_account_id: "account-1",
        p_flow_id: null,
        p_expected_revision: null,
      }),
    );
  });

  it("replaces a draft with CAS and maps conflicts without leaking SQL", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "draft_revision_conflict table=private" },
    });
    const response = await REPLACE(
      new Request("http://localhost/api/flows/flow-1/import", {
        method: "POST",
        body: JSON.stringify({
          document,
          preview_digest: h.previewDigest,
          expected_draft_revision: 7,
        }),
      }),
      { params: Promise.resolve({ id: "flow-1" }) },
    );

    expect(response.status).toBe(409);
    expect(h.rpc).toHaveBeenCalledWith(
      "import_flow_draft",
      expect.objectContaining({
        p_flow_id: "flow-1",
        p_expected_revision: 7,
        p_account_id: "account-1",
      }),
    );
    expect(await response.json()).toEqual({
      code: "DRAFT_REVISION_CONFLICT",
    });
  });

  it("does not mutate when authorization, digest or resolution fails", async () => {
    h.requireRole.mockRejectedValueOnce(new Error("forbidden"));
    const denied = await CREATE(
      new Request("http://localhost/api/flows/import", {
        method: "POST",
        body: JSON.stringify({
          document,
          preview_digest: h.previewDigest,
        }),
      }),
    );
    h.requireRole.mockResolvedValue({
      userId: "actor-1",
      accountId: "account-1",
    });
    const digestMismatch = await CREATE(
      new Request("http://localhost/api/flows/import", {
        method: "POST",
        body: JSON.stringify({
          document,
          preview_digest: "b".repeat(64),
        }),
      }),
    );
    h.blocking = true;
    const blocked = await CREATE(
      new Request("http://localhost/api/flows/import", {
        method: "POST",
        body: JSON.stringify({
          document,
          preview_digest: h.previewDigest,
        }),
      }),
    );

    expect(denied.status).toBe(403);
    expect(digestMismatch.status).toBe(409);
    expect(blocked.status).toBe(422);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
