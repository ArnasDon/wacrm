import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  flow: null as Record<string, unknown> | null,
  nodes: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: h.requireRole,
  toErrorResponse: () => Response.json({ error: "Forbidden" }, { status: 403 }),
}));

vi.mock("@/lib/flows/flow-code-server", () => ({
  loadFlowCodeCatalog: async () => ({ resources: [], flows: [] }),
}));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "flows") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: h.flow, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "flow_nodes") {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: h.nodes, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "flow-source-id" }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue({
    userId: "viewer-1",
    accountId: "account-source-id",
    role: "viewer",
  });
  h.flow = {
    id: "flow-source-id",
    account_id: "account-source-id",
    user_id: "user-source-id",
    name: 'Support "\r\nattachment',
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
  };
  h.nodes = [];
});

describe("flow code export API", () => {
  it("allows viewer membership and returns canonical redacted no-store JSON", async () => {
    const response = await GET(
      new Request("http://localhost/api/flows/flow-source-id/export"),
      context,
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(h.requireRole).toHaveBeenCalledWith("viewer");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="[a-zA-Z0-9_.-]+"$/,
    );
    expect(text.endsWith("\n")).toBe(true);
    expect(text).not.toMatch(
      /flow-source-id|account-source-id|user-source-id/,
    );
  });

  it("returns 304 for the canonical ETag and does not expose cross-account rows", async () => {
    const first = await GET(
      new Request("http://localhost/api/flows/flow-source-id/export"),
      context,
    );
    const etag = first.headers.get("etag")!;
    const cached = await GET(
      new Request("http://localhost/api/flows/flow-source-id/export", {
        headers: { "if-none-match": etag },
      }),
      context,
    );
    h.flow = null;
    const missing = await GET(
      new Request("http://localhost/api/flows/other/export"),
      { params: Promise.resolve({ id: "other" }) },
    );

    expect(cached.status).toBe(304);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ code: "FLOW_NOT_FOUND" });
  });

  it("rejects unauthorized callers before reading the flow", async () => {
    h.requireRole.mockRejectedValue(new Error("forbidden"));
    const response = await GET(
      new Request("http://localhost/api/flows/flow-source-id/export"),
      context,
    );
    expect(response.status).toBe(403);
  });
});
