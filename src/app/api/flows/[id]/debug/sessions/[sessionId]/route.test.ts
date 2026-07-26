import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpcName: "",
  rpcArgs: {} as Record<string, unknown>,
  revision: 1,
}));

vi.mock("@/lib/flows/debug-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/flows/debug-api")>()),
  requireFlowDebugOwner: async () => ({
    ok: true,
    user: { id: "owner-1" },
    accountId: "account-1",
    supabase: {},
  }),
}));

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
                    data: {
                      id: "10000000-0000-4000-8000-000000000001",
                      revision: h.revision,
                      status: "active",
                      expires_at: "2099-01-01T00:00:00.000Z",
                      variables: {
                        count: 1,
                        note: "",
                        contact: { id: "contact-1" },
                      },
                      graph_snapshot: {
                        schema_version: 1,
                        trigger: { type: "manual", config: {} },
                        entry_node_key: "end",
                        fallback_policy: {
                          on_unknown_reply: "ignore",
                          max_reprompts: 0,
                          on_timeout_hours: 24,
                          on_exhaust: "end",
                        },
                        variable_schema: [
                          { key: "count", type: "number", default: 1 },
                          { key: "note", type: "string", default: "" },
                          { key: "contact", type: "contact" },
                        ],
                        nodes: [
                          {
                            node_key: "end",
                            node_type: "end",
                            config: {},
                            position_x: 0,
                            position_y: 0,
                          },
                        ],
                      },
                    },
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
              order: () => ({
                limit: async () => ({
                  data: [
                    {
                      node_key: "end",
                      attempt: 2,
                      inputs: { token: "secret" },
                      outputs: { completed: true },
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.rpcName = name;
      h.rpcArgs = args;
      return {
        data: { id: args.p_session_id, revision: h.revision + 1 },
        error: null,
      };
    },
  }),
}));

import { DELETE, GET, PATCH } from "./route";

const context = {
  params: Promise.resolve({
    id: "20000000-0000-4000-8000-000000000001",
    sessionId: "10000000-0000-4000-8000-000000000001",
  }),
};

beforeEach(() => {
  h.rpcName = "";
  h.rpcArgs = {};
  h.revision = 1;
});

describe("flow debug session API", () => {
  it("coerces declared edits and preserves read-only contact values", async () => {
    const response = await PATCH(
      new Request("http://localhost/debug", {
        method: "PATCH",
        body: JSON.stringify({
          expected_revision: 1,
          variables: { count: "2", contact: { id: "changed" } },
        }),
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(h.rpcName).toBe("edit_flow_debug_session_variables");
    expect(h.rpcArgs.p_variables).toEqual({
      count: 2,
      note: "",
      contact: { id: "contact-1" },
    });
  });

  it("returns session state and attempts for the inspector", async () => {
    const response = await GET(new Request("http://localhost/debug"), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.executions[0]).toMatchObject({
      node_key: "end",
      attempt: 2,
    });
    expect(body.session.manifest).toMatchObject({
      variable_schema: [
        { key: "count", type: "number", default: 1 },
        { key: "note", type: "string", default: "" },
        { key: "contact", type: "contact" },
      ],
      nodes: [
        expect.objectContaining({ node_key: "end", node_type: "end" }),
      ],
    });
  });

  it("closes through the CAS RPC", async () => {
    const response = await DELETE(
      new Request("http://localhost/debug", {
        method: "DELETE",
        body: JSON.stringify({ expected_revision: 1 }),
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(h.rpcName).toBe("close_flow_debug_session");
  });

  it("rejects edits to variables outside the pinned manifest", async () => {
    const response = await PATCH(
      new Request("http://localhost/debug", {
        method: "PATCH",
        body: JSON.stringify({
          expected_revision: 1,
          variables: { undeclared: "value" },
        }),
      }),
      context,
    );
    expect(response.status).toBe(422);
    expect(h.rpcName).toBe("");
  });

  it("rejects variable edits exceeding 64 KiB before the RPC", async () => {
    const response = await PATCH(
      new Request("http://localhost/debug", {
        method: "PATCH",
        body: JSON.stringify({
          expected_revision: 1,
          variables: { note: "x".repeat(70_000) },
        }),
      }),
      context,
    );

    expect(response.status).toBe(413);
    expect(h.rpcName).toBe("");
  });
});
