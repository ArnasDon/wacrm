import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: h.requireRole,
  toErrorResponse: () => Response.json({ error: "Forbidden" }, { status: 403 }),
}));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({ rpc: h.rpc }),
}));

vi.mock("@/lib/flows/flow-code-server", () => ({
  loadFlowCodeCatalog: async () => ({ resources: [], flows: [] }),
  previewFlowCode: () => ({
    preview: {
      normalized: '{"kind":"wacrm.flow"}\n',
      digest: "a".repeat(64),
      resolved: {},
      secret_requirements: [
        {
          name: "request.headers.authorization",
          node_key: "request",
          path: "config.headers.Authorization",
        },
      ],
      issues: [
        {
          code: "SECRET_REQUIRED",
          severity: "blocking",
          message: "binding required",
        },
      ],
    },
    graph: {
      name: "Preview",
      description: null,
      trigger_type: "manual",
      trigger_config: {},
      entry_node_id: null,
      fallback_policy: {},
      variable_schema: [],
      nodes: [],
    },
  }),
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue({
    userId: "agent-1",
    accountId: "account-1",
    role: "agent",
  });
});

describe("flow code preview API", () => {
  it("is a dry run, reports requirements and never echoes secret bindings", async () => {
    const response = await POST(
      new Request("http://localhost/api/flows/import/preview", {
        method: "POST",
        body: JSON.stringify({ document: '{"kind":"wacrm.flow"}' }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(h.rpc).not.toHaveBeenCalled();
    expect(payload.secret_requirements).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toMatch(
      /Bearer |super-secret|secret_bindings/,
    );
  });

  it("requires agent role before parsing", async () => {
    h.requireRole.mockRejectedValue(new Error("forbidden"));
    const response = await POST(
      new Request("http://localhost/api/flows/import/preview", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(response.status).toBe(403);
  });
});
