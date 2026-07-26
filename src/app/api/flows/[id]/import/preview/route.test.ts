import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadCatalog: vi.fn(),
  previewFlowCode: vi.fn(),
  maybeSingle: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: h.requireRole,
  toErrorResponse: () =>
    Response.json({ code: "IMPORT_FORBIDDEN" }, { status: 403 }),
}));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({ from: h.from }),
}));

vi.mock("@/lib/flows/flow-code-server", () => ({
  loadFlowCodeCatalog: h.loadCatalog,
  previewFlowCode: h.previewFlowCode,
}));

import { POST } from "./route";

const flowId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue({
    userId: "agent-1",
    accountId: "account-1",
    role: "agent",
  });
  h.maybeSingle.mockResolvedValue({ data: { id: flowId }, error: null });
  h.from.mockImplementation(() => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: h.maybeSingle,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    return query;
  });
  h.loadCatalog.mockResolvedValue({ resources: [], flows: [] });
  h.previewFlowCode.mockReturnValue({
    preview: {
      normalized: "{}\n",
      digest: "a".repeat(64),
      resolved: {},
      secret_requirements: [],
      issues: [{ code: "SUBFLOW_SELF_REFERENCE", severity: "blocking" }],
    },
    graph: {
      name: "Imported",
      description: null,
      trigger_type: "manual",
      trigger_config: {},
      entry_node_id: null,
      fallback_policy: {},
      variable_schema: [],
      nodes: [],
    },
  });
});

describe("replace flow code preview API", () => {
  it("scopes the target to the account and previews with the replacing flow id", async () => {
    const response = await POST(
      new Request(`http://localhost/api/flows/${flowId}/import/preview`, {
        method: "POST",
        body: JSON.stringify({
          document: '{"kind":"wacrm.flow"}',
          resource_bindings: {},
        }),
      }),
      { params: Promise.resolve({ id: flowId }) },
    );

    expect(response.status).toBe(200);
    expect(h.from).toHaveBeenCalledWith("flows");
    expect(h.loadCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ from: h.from }),
      "account-1",
    );
    expect(h.previewFlowCode).toHaveBeenCalledWith(
      '{"kind":"wacrm.flow"}',
      { resources: [], flows: [] },
      flowId,
      {},
    );
    expect(await response.json()).toEqual(
      expect.objectContaining({
        issues: [
          expect.objectContaining({ code: "SUBFLOW_SELF_REFERENCE" }),
        ],
      }),
    );
  });

  it("does not preview a replacement outside the current account", async () => {
    h.maybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await POST(
      new Request(`http://localhost/api/flows/${flowId}/import/preview`, {
        method: "POST",
        body: JSON.stringify({ document: "{}" }),
      }),
      { params: Promise.resolve({ id: flowId }) },
    );

    expect(response.status).toBe(404);
    expect(h.loadCatalog).not.toHaveBeenCalled();
    expect(h.previewFlowCode).not.toHaveBeenCalled();
  });
});
