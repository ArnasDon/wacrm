import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "owner-1" } as { id: string } | null,
  flowOwner: "owner-1",
  sourceRun: null as Record<string, unknown> | null,
  sourceExecutions: [] as Record<string, unknown>[],
  rpcName: "",
  rpcArgs: {} as Record<string, unknown>,
  rpcError: null as { message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: h.user } }),
    },
    from: (table: string) => {
      if (table === "flows") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "flow-1",
                  user_id: h.flowOwner,
                  account_id: "account-1",
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected browser table ${table}`);
    },
  }),
}));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.rpcName = name;
      h.rpcArgs = args;
      if (name === "read_flow_draft_for_publish") {
        return {
          data: {
            flow: {
              id: "flow-1",
              account_id: "account-1",
              user_id: "owner-1",
              trigger_type: "manual",
              trigger_config: {},
              entry_node_id: "end",
              fallback_policy: {
                on_unknown_reply: "ignore",
                max_reprompts: 0,
                on_timeout_hours: 24,
                on_exhaust: "end",
              },
              variable_schema: [
                { key: "name", type: "string", default: "Ada" },
              ],
              draft_revision: 4,
            },
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
          error: null,
        };
      }
      return {
        data: h.rpcError
          ? null
          : {
              id: "session-1",
              flow_id: "flow-1",
              revision: 0,
              variables: { name: "Ada" },
            },
        error: h.rpcError,
      };
    },
    from: (table: string) => {
      if (table === "flow_runs") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: h.sourceRun,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "flow_node_executions") {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({
                data: h.sourceExecutions,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "flow_debug_sessions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: [], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected admin table ${table}`);
    },
  }),
}));

import { POST } from "./route";

const context = {
  params: Promise.resolve({
    id: "20000000-0000-4000-8000-000000000001",
  }),
};

beforeEach(() => {
  h.user = { id: "owner-1" };
  h.flowOwner = "owner-1";
  h.sourceRun = null;
  h.sourceExecutions = [];
  h.rpcName = "";
  h.rpcArgs = {};
  h.rpcError = null;
});

describe("flow debug session creation", () => {
  it("creates an isolated draft session with variable defaults", async () => {
    const response = await POST(
      new Request("http://localhost/api/flows/flow-1/debug/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      context,
    );

    expect(response.status).toBe(201);
    expect(h.rpcName).toBe("create_flow_debug_session");
    expect(h.rpcArgs).toMatchObject({
      p_flow_id: "20000000-0000-4000-8000-000000000001",
      p_created_by: "owner-1",
      p_draft_revision: 4,
      p_flow_version_id: null,
      p_source_run_id: null,
      p_variables: { name: "Ada" },
      p_node_outputs: {},
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("hides a flow from an authenticated non-owner", async () => {
    h.flowOwner = "different-user";
    const response = await POST(
      new Request("http://localhost/api/flows/flow-1/debug/sessions", {
        method: "POST",
        body: "{}",
      }),
      context,
    );
    expect(response.status).toBe(404);
    expect(h.rpcName).toBe("");
  });

  it("clones only a source run belonging to the same flow", async () => {
    h.sourceRun = null;
    const response = await POST(
      new Request("http://localhost/api/flows/flow-1/debug/sessions", {
        method: "POST",
        body: JSON.stringify({ source_run_id: "00000000-0000-4000-8000-000000000001" }),
      }),
      context,
    );
    expect(response.status).toBe(404);
    expect(h.rpcName).toBe("read_flow_draft_for_publish");
  });

  it("returns a conflict when the draft revision changes", async () => {
    h.rpcError = { message: "debug_revision_conflict" };
    const response = await POST(
      new Request("http://localhost/api/flows/flow-1/debug/sessions", {
        method: "POST",
        body: "{}",
      }),
      context,
    );
    expect(response.status).toBe(409);
  });
});
