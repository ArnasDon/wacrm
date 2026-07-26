import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sessionRevision: 2,
  sessionFlowId: "20000000-0000-4000-8000-000000000001",
  rpcError: null as { message: string } | null,
  rpcArgs: {} as Record<string, unknown>,
  recentCount: 0,
  sessionVariables: { name: "Ada" } as Record<string, unknown>,
}));

vi.mock("@/lib/flows/debug-api", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/flows/debug-api")>();
  return {
    ...original,
    requireFlowDebugOwner: async () => ({
      ok: true,
      user: { id: "owner-1" },
      accountId: "account-1",
      supabase: {},
    }),
  };
});

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "flow_debug_sessions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data:
                      h.sessionFlowId === "20000000-0000-4000-8000-000000000001"
                        ? {
                            id: "10000000-0000-4000-8000-000000000001",
                            flow_id: "20000000-0000-4000-8000-000000000001",
                            revision: h.sessionRevision,
                            status: "active",
                            expires_at: "2099-01-01T00:00:00.000Z",
                            variables: h.sessionVariables,
                            node_outputs: {},
                            graph_snapshot: {
                              schema_version: 1,
                              trigger: { type: "manual", config: {} },
                              entry_node_key: "send",
                              fallback_policy: {
                                on_unknown_reply: "ignore",
                                max_reprompts: 0,
                                on_timeout_hours: 24,
                                on_exhaust: "end",
                              },
                              variable_schema: [
                                {
                                  key: "name",
                                  type: "string",
                                  default: "Ada",
                                },
                              ],
                              nodes: [
                                {
                                  node_key: "send",
                                  node_type: "send_message",
                                  config: {
                                    text: "Hi {{vars.name}}",
                                    next_node_key: "end",
                                  },
                                  position_x: 0,
                                  position_y: 0,
                                },
                                {
                                  node_key: "end",
                                  node_type: "end",
                                  config: {},
                                  position_x: 0,
                                  position_y: 0,
                                },
                              ],
                            },
                          }
                        : null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "flow_debug_node_executions") {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                limit: async () => ({
                  data: Array.from({ length: h.recentCount }, (_, id) => ({
                    id,
                  })),
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async (_name: string, args: Record<string, unknown>) => {
      h.rpcArgs = args;
      return {
        data: h.rpcError
          ? null
          : {
              session: { id: args.p_session_id, revision: 3 },
              execution: {
                id: "exec-1",
                node_key: args.p_node_key,
                outputs: args.p_outputs,
                simulated_effects: args.p_simulated_effects,
              },
            },
        error: h.rpcError,
      };
    },
  }),
}));

import { POST } from "./route";

const context = {
  params: Promise.resolve({
    id: "20000000-0000-4000-8000-000000000001",
    sessionId: "10000000-0000-4000-8000-000000000001",
    nodeKey: "send",
  }),
};

beforeEach(() => {
  h.sessionRevision = 2;
  h.sessionFlowId = "20000000-0000-4000-8000-000000000001";
  h.rpcError = null;
  h.rpcArgs = {};
  h.recentCount = 0;
  h.sessionVariables = { name: "Ada" };
});

describe("isolated debug node API", () => {
  it("records a simulated send without fetch, providers, credits, or upstream execution", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await POST(
      new Request("http://localhost/debug", {
        method: "POST",
        body: JSON.stringify({ expected_revision: 2, overrides: {} }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(h.rpcArgs).toMatchObject({
      p_expected_revision: 2,
      p_node_key: "send",
      p_status: "completed",
      p_simulated_effects: [
        { kind: "whatsapp_text", payload: { text: "Hi Ada" } },
      ],
    });
    expect(JSON.stringify(h.rpcArgs)).not.toContain("wamid");
    fetchSpy.mockRestore();
  });

  it("requires the current optimistic revision", async () => {
    const response = await POST(
      new Request("http://localhost/debug", {
        method: "POST",
        body: JSON.stringify({ overrides: {} }),
      }),
      context,
    );
    expect(response.status).toBe(400);
    expect(h.rpcArgs).toEqual({});
  });

  it("returns 409 on commit races without mutating a production table", async () => {
    h.rpcError = { message: "debug_revision_conflict" };
    const response = await POST(
      new Request("http://localhost/debug", {
        method: "POST",
        body: JSON.stringify({ expected_revision: 2 }),
      }),
      context,
    );
    expect(response.status).toBe(409);
  });

  it("rate limits repeated node executions", async () => {
    h.recentCount = 30;
    const response = await POST(
      new Request("http://localhost/debug", {
        method: "POST",
        body: JSON.stringify({ expected_revision: 2 }),
      }),
      context,
    );
    expect(response.status).toBe(429);
    expect(h.rpcArgs).toEqual({});
  });

  it("rejects oversized variables without committing an execution", async () => {
    h.sessionVariables = { huge: "x".repeat(70_000) };
    const response = await POST(
      new Request("http://localhost/debug", {
        method: "POST",
        body: JSON.stringify({ expected_revision: 2 }),
      }),
      context,
    );

    expect(response.status).toBe(413);
    expect(h.rpcArgs).toEqual({});
  });
});
