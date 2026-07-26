import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "owner-1" } as { id: string } | null,
  flowOwner: "owner-1",
  sourceRun: null as Record<string, unknown> | null,
  sourceVersion: null as Record<string, unknown> | null,
  sourceExecutions: [] as Record<string, unknown>[],
  sourceExecutionLimit: 0,
  sourceRunSelect: "",
  rpcName: "",
  rpcCalls: [] as string[],
  rpcArgs: {} as Record<string, unknown>,
  rpcError: null as { message: string } | null,
  createdSession: null as Record<string, unknown> | null,
  sessionListSelect: "",
  sessionListLimit: 0,
  listedSessions: [] as Record<string, unknown>[],
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
      if (name === "read_flow_debug_source_variables") {
        const variables =
          (h.sourceRun?.vars as Record<string, unknown> | undefined) ?? {};
        const originalBytes = new TextEncoder().encode(
          JSON.stringify(variables),
        ).byteLength;
        return {
          data: {
            result_json:
              originalBytes > 65_536
                ? {
                    truncated: true,
                    reason: "source_variables_exceeded_limit",
                  }
                : variables,
            truncated: originalBytes > 65_536,
            original_bytes: originalBytes,
          },
          error: null,
        };
      }
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
          : (h.createdSession ?? {
              id: "session-1",
              flow_id: "flow-1",
              revision: 0,
              variables: { name: "Ada" },
            }),
        error: h.rpcError,
      };
    },
    from: (table: string) => {
      if (table === "flow_runs") {
        return {
          select: (columns: string) => {
            h.sourceRunSelect = columns;
            return {
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: h.sourceRun,
                    error: null,
                  }),
                }),
              }),
            };
          },
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
                limit: async (limit: number) => {
                  h.sourceExecutionLimit = limit;
                  return {
                    data: h.sourceExecutions.slice(0, limit),
                    error: null,
                  };
                },
              }),
            }),
          }),
        };
      }
      if (table === "flow_debug_sessions") {
        return {
          select: (columns: string) => {
            h.sessionListSelect = columns;
            return {
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: async (limit: number) => {
                      h.sessionListLimit = limit;
                      return {
                        data: h.listedSessions.slice(0, limit),
                        error: null,
                      };
                    },
                  }),
                }),
              }),
            };
          },
        };
      }
      throw new Error(`unexpected admin table ${table}`);
    },
  }),
}));

import { GET, POST } from "./route";

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
  h.sourceExecutionLimit = 0;
  h.sourceRunSelect = "";
  h.rpcName = "";
  h.rpcCalls = [];
  h.rpcArgs = {};
  h.rpcError = null;
  h.createdSession = null;
  h.sessionListSelect = "";
  h.sessionListLimit = 0;
  h.listedSessions = [];
});

describe("flow debug session inventory", () => {
  it("returns a bounded metadata-only list suitable for resuming or closing", async () => {
    h.listedSessions = [
      {
        id: "session-1",
        revision: 4,
        status: "active",
        variables: { secret: "must not be selected" },
      },
    ];

    const response = await GET(
      new Request("http://localhost/api/flows/flow-1/debug/sessions"),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(h.sessionListLimit).toBe(20);
    expect(h.sessionListSelect).not.toContain("variables");
    expect(body.sessions[0]).toMatchObject({
      id: "session-1",
      revision: 4,
      status: "active",
    });
  });
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
        body: JSON.stringify({
          source_run_id: "00000000-0000-4000-8000-000000000001",
        }),
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
    expect(h.rpcCalls).toContain("read_flow_debug_source_variables");
    expect(h.sourceRunSelect).not.toContain("vars");
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
    expect(h.sourceExecutionLimit).toBe(32);
    expect(
      new TextEncoder().encode(JSON.stringify(h.rpcArgs.p_source_node_outputs))
        .byteLength,
    ).toBeLessThanOrEqual(262_144);
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

  it("preserves the POST session envelope near the response limits", async () => {
    h.createdSession = nearLimitSession();
    const response = await POST(
      new Request("http://localhost/api/flows/flow-1/debug/sessions", {
        method: "POST",
        body: "{}",
      }),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.session).toMatchObject({
      id: "session-near-limit",
      revision: 0,
      status: "active",
      variables: expect.any(Object),
      manifest: {
        variable_schema: expect.any(Array),
        nodes: expect.any(Array),
      },
    });
    expect(body.session).not.toHaveProperty("truncated");
  });
});

function nearLimitSession() {
  const variable_schema = Array.from({ length: 15 }, (_, index) => ({
    key: `field_${index}`,
    type: "string",
    default: "",
  }));
  return {
    id: "session-near-limit",
    revision: 0,
    status: "active",
    variables: Object.fromEntries(
      variable_schema.map(({ key }) => [key, "x".repeat(4_096)]),
    ),
    graph_snapshot: {
      schema_version: 1,
      trigger: { type: "manual", config: {} },
      entry_node_key: "end_0",
      fallback_policy: {
        on_unknown_reply: "ignore",
        max_reprompts: 0,
        on_timeout_hours: 24,
        on_exhaust: "end",
      },
      variable_schema,
      nodes: Array.from({ length: 100 }, (_, index) => ({
        node_key: `end_${index}`,
        node_type: "end",
        config: {},
        position_x: index,
        position_y: 0,
      })),
    },
  };
}
