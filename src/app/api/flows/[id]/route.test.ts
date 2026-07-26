import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  admin: vi.fn(),
  state: {
    flowUpdateCalls: [] as Record<string, unknown>[],
  },
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: h.requireRole,
  toErrorResponse: (error: unknown) =>
    new Response(JSON.stringify({ error: String(error) }), { status: 500 }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: "user-1" } } }),
    },
    from: (table: string) => {
      if (table !== "flows") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { id: "flow-1" }, error: null }),
          }),
        }),
      };
    },
  }),
}));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: h.admin,
}));

import { PUT } from "./route";

function requestWithNode(node_type: string, config: Record<string, unknown>) {
  return new Request("http://localhost/api/flows/flow-1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nodes: [{ node_key: "x", node_type, config }],
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.flowUpdateCalls = [];
  h.requireRole.mockResolvedValue(undefined);
  h.admin.mockReturnValue({
    from: (table: string) => {
      if (table === "flows") {
        return {
          update: (payload: Record<string, unknown>) => {
            h.state.flowUpdateCalls.push(payload);
            return {
              eq: () => Promise.resolve({ error: null }),
            };
          },
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: "flow-1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "flow_nodes") {
        return {
          delete: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
          insert: () => Promise.resolve({ error: null }),
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  });
});

describe("PUT /api/flows/[id] flow runtime boundary", () => {
  it.each([
    ["wait", { amount: 5, unit: "minutes", next_node_key: "end" }],
    [
      "send_webhook",
      { url: "https://hooks.example.com/in", next_node_key: "end" },
    ],
    [
      "trigger_keyword_match",
      { keywords: ["hello"], next_node_key: "end" },
    ],
  ])("rejects registered but unsupported %s nodes before mutating", async (nodeType, config) => {
    const response = await PUT(requestWithNode(nodeType, config), {
      params: Promise.resolve({ id: "flow-1" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: `Node type "${nodeType}" is not supported by the flow runtime`,
    });
    expect(h.admin).not.toHaveBeenCalled();
    expect(h.state.flowUpdateCalls).toEqual([]);
  });
});
