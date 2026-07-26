import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "owner-1" } as { id: string } | null,
  flowOwner: "owner-1",
  sourceRun: null as Record<string, unknown> | null,
  sourceVersion: null as Record<string, unknown> | null,
  sourceExecutions: [] as Record<string, unknown>[],
  rpcName: "",
  rpcCalls: [] as string[],
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
      h.rpcCalls.push(name);
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
      if (table === "flow_versions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: h.sourceVersion,
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
              order: () => ({
                limit: async () => ({
                  data: h.sourceExecutions,
                  error: null,
                }),
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
  h.sourceVersion = null;
  h.sourceExecutions = [];
  h.rpcName = "";
  h.rpcCalls = [];
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
    expect(h.rpcCalls).not.toContain("read_flow_draft_for_publish");
    expect(h.rpcCalls).not.toContain("create_flow_debug_session");
  });

  it("pins a cloned session to the source run's immutable version", async () => {
    const sourceRunId = "00000000-0000-4000-8000-000000000001";
    const sourceVersionId = "00000000-0000-4000-8000-000000000002";
    h.sourceRun = {
      id: sourceRunId,
      flow_id: "20000000-0000-4000-8000-000000000001",
      account_id: "account-1",
      flow_version_id: sourceVersionId,
      vars: { name: "Grace" },
    };
    h.sourceVersion = {
      id: sourceVersionId,
      flow_id: "20000000-0000-4000-8000-000000000001",
      graph: {
        schema_version: 1,
        trigger: { type: "manual", config: {} },
        entry_node_key: "source-end",
        fallback_policy: {
          on_unknown_reply: "ignore",
          max_reprompts: 0,
          on_timeout_hours: 24,
          on_exhaust: "end",
        },
        variable_schema: [
          { key: "name", type: "string", default: "Source default" },
        ],
        nodes: [
          {
            node_key: "source-end",
            node_type: "end",
            config: {},
            position_x: 0,
            position_y: 0,
          },
        ],
      },
    };
    h.sourceExecutions = [
      {
        node_key: "source-end",
        outputs: { completed: true },
        started_at: "2026-07-26T12:00:00.000Z",
      },
      {
        node_key: "source-end",
        outputs: { completed: false },
        started_at: "2026-07-26T11:00:00.000Z",
      },
    ];

    const response = await POST(
      new Request("http://localhost/api/flows/flow-1/debug/sessions", {
        method: "POST",
        body: JSON.stringify({ source_run_id: sourceRunId }),
      }),
      context,
    );

    expect(response.status).toBe(201);
    expect(h.rpcCalls).not.toContain("read_flow_draft_for_publish");
    expect(h.rpcArgs).toMatchObject({
      p_flow_version_id: sourceVersionId,
      p_draft_revision: null,
      p_source_run_id: sourceRunId,
      p_variables: { name: "Grace" },
      p_source_node_outputs: {
        "source-end": { completed: true },
      },
    });
    expect(h.rpcArgs.p_graph_snapshot).toMatchObject({
      entry_node_key: "source-end",
    });
  });

  it("rejects a version that conflicts with the source run", async () => {
    const sourceRunId = "00000000-0000-4000-8000-000000000001";
    h.sourceRun = {
      id: sourceRunId,
      flow_id: "20000000-0000-4000-8000-000000000001",
      account_id: "account-1",
      flow_version_id: "00000000-0000-4000-8000-000000000002",
      vars: {},
    };

    const response = await POST(
      new Request("http://localhost/api/flows/flow-1/debug/sessions", {
        method: "POST",
        body: JSON.stringify({
          source_run_id: sourceRunId,
          flow_version_id: "00000000-0000-4000-8000-000000000003",
        }),
      }),
      context,
    );

    expect(response.status).toBe(409);
    expect(h.rpcCalls).not.toContain("create_flow_debug_session");
  });

  it("rejects legacy source runs without an immutable version", async () => {
    const sourceRunId = "00000000-0000-4000-8000-000000000001";
    h.sourceRun = {
      id: sourceRunId,
      flow_id: "20000000-0000-4000-8000-000000000001",
      account_id: "account-1",
      flow_version_id: null,
      vars: {},
    };

    const response = await POST(
      new Request("http://localhost/api/flows/flow-1/debug/sessions", {
        method: "POST",
        body: JSON.stringify({ source_run_id: sourceRunId }),
      }),
      context,
    );

    expect(response.status).toBe(422);
    expect(h.rpcCalls).not.toContain("read_flow_draft_for_publish");
    expect(h.rpcCalls).not.toContain("create_flow_debug_session");
  });

  it("rejects oversized source variables before creating the session", async () => {
    const sourceRunId = "00000000-0000-4000-8000-000000000001";
    const sourceVersionId = "00000000-0000-4000-8000-000000000002";
    h.sourceRun = {
      id: sourceRunId,
      flow_id: "20000000-0000-4000-8000-000000000001",
      account_id: "account-1",
      flow_version_id: sourceVersionId,
      vars: { huge: "x".repeat(70_000) },
    };
    h.sourceVersion = {
      id: sourceVersionId,
      flow_id: "20000000-0000-4000-8000-000000000001",
      graph: {
        schema_version: 1,
        trigger: { type: "manual", config: {} },
        entry_node_key: "end",
        fallback_policy: {
          on_unknown_reply: "ignore",
          max_reprompts: 0,
          on_timeout_hours: 24,
          on_exhaust: "end",
        },
        variable_schema: [],
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
    };

    const response = await POST(
      new Request("http://localhost/api/flows/flow-1/debug/sessions", {
        method: "POST",
        body: JSON.stringify({ source_run_id: sourceRunId }),
      }),
      context,
    );

    expect(response.status).toBe(413);
    expect(h.rpcCalls).not.toContain("create_flow_debug_session");
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
