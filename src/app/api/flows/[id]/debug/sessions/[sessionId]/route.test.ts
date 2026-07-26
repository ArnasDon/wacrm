import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpcName: "",
  rpcArgs: {} as Record<string, unknown>,
  revision: 1,
  sessionOverride: null as Record<string, unknown> | null,
  rpcSessionOverride: null as Record<string, unknown> | null,
  executionsRead: false,
  executionLimit: 0,
  executionCursorFilter: null as string | null,
  executionOrders: [] as string[],
  executionRows: [] as Record<string, unknown>[],
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
                    data: h.sessionOverride ?? {
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
            eq: () => {
              const query = {
                or: (filter: string) => {
                  h.executionCursorFilter = filter;
                  return query;
                },
                order: (column: string) => {
                  h.executionOrders.push(column);
                  return query;
                },
                limit: async (limit: number) => {
                  h.executionsRead = true;
                  h.executionLimit = limit;
                  return {
                    data: h.executionRows
                      .filter((_row, index) =>
                        h.executionCursorFilter ? index > 0 : true,
                      )
                      .slice(0, limit),
                    error: null,
                  };
                },
              };
              return query;
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.rpcName = name;
      h.rpcArgs = args;
      return {
        data: h.rpcSessionOverride ?? {
          id: args.p_session_id,
          revision: h.revision + 1,
        },
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
  h.sessionOverride = null;
  h.rpcSessionOverride = null;
  h.executionsRead = false;
  h.executionLimit = 0;
  h.executionCursorFilter = null;
  h.executionOrders = [];
  h.executionRows = [
    {
      id: "30000000-0000-4000-8000-000000000002",
      node_key: "end",
      node_type: "end",
      status: "completed",
      attempt: 2,
      inputs: { token: "secret" },
      outputs: { completed: true },
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "30000000-0000-4000-8000-000000000001",
      node_key: "end",
      node_type: "end",
      status: "completed",
      attempt: 1,
      inputs: {},
      outputs: { completed: true },
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];
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
    expect(body.page).toMatchObject({
      limit: 25,
      returned: 2,
      truncated: false,
      next_cursor: null,
      budget_bytes: 262_144,
    });
    expect(body.session.manifest).toMatchObject({
      variable_schema: [
        { key: "count", type: "number", default: 1 },
        { key: "note", type: "string", default: "" },
        { key: "contact", type: "contact" },
      ],
      nodes: [expect.objectContaining({ node_key: "end", node_type: "end" })],
    });
  });

  it.each([
    ["closed", "2099-01-01T00:00:00.000Z"],
    ["active", "2000-01-01T00:00:00.000Z"],
  ])(
    "returns 410 without reading executions for unavailable session (%s)",
    async (status, expiresAt) => {
      h.sessionOverride = {
        ...nearLimitSession(1),
        status,
        expires_at: expiresAt,
      };

      const response = await GET(
        new Request("http://localhost/debug"),
        context,
      );

      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({
        code: "DEBUG_SESSION_UNAVAILABLE",
      });
      expect(h.executionsRead).toBe(false);
    },
  );

  it("pages attempts with a compound created_at/id cursor", async () => {
    const firstResponse = await GET(
      new Request("http://localhost/debug?limit=1"),
      context,
    );
    const first = await firstResponse.json();
    expect(first.executions[0].id).toBe("30000000-0000-4000-8000-000000000002");
    expect(first.page.next_cursor).toEqual(expect.any(String));
    expect(first.page.next_cursor).not.toBe("2026-01-01T00:00:00.000Z");

    h.executionCursorFilter = null;
    h.executionOrders = [];
    const secondResponse = await GET(
      new Request(
        `http://localhost/debug?limit=1&cursor=${encodeURIComponent(first.page.next_cursor)}`,
      ),
      context,
    );
    const second = await secondResponse.json();

    expect(second.executions[0].id).toBe(
      "30000000-0000-4000-8000-000000000001",
    );
    expect(h.executionCursorFilter).toContain(
      "created_at.eq.2026-01-01T00:00:00.000Z",
    );
    expect(h.executionCursorFilter).toContain(
      "id.lt.30000000-0000-4000-8000-000000000002",
    );
    expect(h.executionOrders).toEqual(["created_at", "id"]);
    expect(h.executionLimit).toBe(2);
  });

  it("preserves the session envelope while enforcing an aggregate execution budget", async () => {
    h.executionRows = Array.from({ length: 10 }, (_, index) => ({
      id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      node_key: `node_${index}`,
      node_type: "send_message",
      status: "completed",
      attempt: 1,
      inputs: {
        payload: Array.from({ length: 200 }, () => "x".repeat(1_000)),
      },
      outputs: {
        payload: Array.from({ length: 200 }, () => "y".repeat(1_000)),
      },
      created_at: new Date(
        Date.UTC(2026, 0, 1, 0, 0, 10 - index),
      ).toISOString(),
    }));

    const response = await GET(
      new Request("http://localhost/debug?limit=10"),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.session).toMatchObject({ id: expect.any(String) });
    expect(body.page).toMatchObject({
      truncated: true,
      truncation_reason: "budget",
      budget_bytes: 262_144,
    });
    expect(body.executions.length).toBeLessThan(10);
    expect(
      new TextEncoder().encode(JSON.stringify(body)).byteLength,
    ).toBeLessThanOrEqual(262_144);
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

  it("preserves the GET session envelope near the response limits", async () => {
    h.sessionOverride = nearLimitSession(1);
    const response = await GET(new Request("http://localhost/debug"), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.session).toMatchObject({
      id: "session-near-limit",
      revision: 1,
      status: "active",
      variables: expect.any(Object),
      manifest: {
        variable_schema: expect.any(Array),
        nodes: expect.any(Array),
      },
    });
    expect(body.session).not.toHaveProperty("truncated");
  });

  it("preserves the PATCH session envelope near the response limits", async () => {
    h.sessionOverride = nearLimitSession(1);
    h.rpcSessionOverride = nearLimitSession(2);
    const response = await PATCH(
      new Request("http://localhost/debug", {
        method: "PATCH",
        body: JSON.stringify({
          expected_revision: 1,
          variables: { field_0: "updated" },
        }),
      }),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.session).toMatchObject({
      id: "session-near-limit",
      revision: 2,
      status: "active",
      variables: expect.any(Object),
      manifest: expect.any(Object),
    });
    expect(body.session).not.toHaveProperty("truncated");
  });
});

function nearLimitSession(revision: number) {
  const variable_schema = Array.from({ length: 15 }, (_, index) => ({
    key: `field_${index}`,
    type: "string",
    default: "",
  }));
  return {
    id: "session-near-limit",
    revision,
    status: "active",
    expires_at: "2099-01-01T00:00:00.000Z",
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
