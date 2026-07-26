import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  admin: vi.fn(),
  rpc: vi.fn(),
  ownerUserId: "user-1",
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
      if (table === "flows") {
        return {
          select: (columns: string) => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data:
                    columns === "id, user_id"
                      ? { id: "flow-1", user_id: h.ownerUserId }
                      : {
                          id: "flow-1",
                          user_id: h.ownerUserId,
                          draft_revision: 4,
                        },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "flow_nodes") {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: h.admin,
}));

import { GET, PUT } from "./route";

function requestWithNode(node_type: string, config: Record<string, unknown>) {
  return new Request("http://localhost/api/flows/flow-1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expected_draft_revision: 0,
      nodes: [{ node_key: "x", node_type, config }],
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.flowUpdateCalls = [];
  h.ownerUserId = "user-1";
  h.requireRole.mockResolvedValue(undefined);
  h.admin.mockReturnValue({
    rpc: h.rpc,
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
  h.rpc.mockResolvedValue({
    data: [{ id: "flow-1", draft_revision: 5 }],
    error: null,
  });
});

describe("PUT /api/flows/[id] flow runtime boundary", () => {
  it.each([
    ["missing", {}],
    ["string", { expected_draft_revision: "4" }],
    ["negative", { expected_draft_revision: -1 }],
    ["fractional", { expected_draft_revision: 1.5 }],
  ])("requires a valid draft revision precondition (%s)", async (_case, body) => {
    const response = await PUT(
      new Request("http://localhost/api/flows/flow-1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, name: "Update" }),
      }),
      { params: Promise.resolve({ id: "flow-1" }) },
    );

    expect(response.status).toBe(428);
    expect(await response.json()).toEqual({
      code: "DRAFT_REVISION_REQUIRED",
      error:
        "expected_draft_revision must be the non-negative integer returned by the latest flow read",
    });
    expect(h.admin).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

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

  it("saves the envelope and full graph through one revisioned RPC", async () => {
    const response = await PUT(
      new Request("http://localhost/api/flows/flow-1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_draft_revision: 4,
          name: " Updated ",
          nodes: [
            {
              node_key: "end",
              node_type: "end",
              config: {},
              position_x: 10,
              position_y: 20,
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: "flow-1" }) },
    );

    expect(response.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("save_flow_draft", {
      p_flow_id: "flow-1",
      p_expected_revision: 4,
      p_patch: { name: "Updated" },
      p_nodes: [
        {
          node_key: "end",
          node_type: "end",
          config: {},
          position_x: 10,
          position_y: 20,
        },
      ],
    });
    expect(h.state.flowUpdateCalls).toEqual([]);
    expect(await response.json()).toMatchObject({
      flow: { id: "flow-1", draft_revision: 5 },
    });
  });

  it("returns 409 without partial draft mutation on revision conflict", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "draft_revision_conflict" },
    });

    const response = await PUT(
      new Request("http://localhost/api/flows/flow-1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_draft_revision: 4,
          name: "Concurrent edit",
        }),
      }),
      { params: Promise.resolve({ id: "flow-1" }) },
    );

    expect(response.status).toBe(409);
    expect(h.rpc).toHaveBeenCalledWith(
      "save_flow_draft",
      expect.objectContaining({ p_expected_revision: 4 }),
    );
    expect(h.state.flowUpdateCalls).toEqual([]);
  });
});

describe("GET /api/flows/[id] capabilities", () => {
  it.each([
    ["creator", "user-1", true],
    ["same-account non-owner", "user-2", false],
  ])("returns explicit version management capability for the %s", async (
    _case,
    ownerUserId,
    expected,
  ) => {
    h.ownerUserId = ownerUserId;

    const response = await GET(
      new Request("http://localhost/api/flows/flow-1"),
      { params: Promise.resolve({ id: "flow-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      capabilities: { can_manage_versions: expected },
    });
  });
});
