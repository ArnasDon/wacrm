import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
  history: [] as Array<Record<string, unknown>>,
  draft: {} as Record<string, unknown>,
  nodes: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: h.requireRole,
  toErrorResponse: () =>
    Response.json({ error: "Forbidden" }, { status: 403 }),
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
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: "flow-1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "flow_versions") {
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve({ data: h.history, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected caller table ${table}`);
    },
  }),
}));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({
    rpc: h.rpc,
    from: (table: string) => {
      if (table === "flows") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: h.draft, error: null }),
            }),
          }),
        };
      }
      if (table === "flow_nodes") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: h.nodes, error: null }),
          }),
        };
      }
      throw new Error(`unexpected admin table ${table}`);
    },
  }),
}));

import { GET, POST } from "./route";
import { POST as POST_ACTIVATE } from "../activate/route";

const context = { params: Promise.resolve({ id: "flow-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue(undefined);
  h.history = [];
  h.draft = {
    id: "flow-1",
    account_id: "account-1",
    user_id: "user-1",
    name: "Support",
    description: null,
    status: "draft",
    trigger_type: "keyword",
    trigger_config: { keywords: ["help"] },
    entry_node_id: "start",
    fallback_policy: {
      on_unknown_reply: "reprompt",
      max_reprompts: 2,
      on_timeout_hours: 24,
      on_exhaust: "handoff",
    },
    execution_count: 0,
    last_executed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    published_version_id: null,
  };
  h.nodes = [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "end" },
      position_x: 0,
      position_y: 0,
    },
    {
      node_key: "end",
      node_type: "end",
      config: {},
      position_x: 100,
      position_y: 0,
    },
  ];
  h.rpc.mockResolvedValue({
    data: [
      {
        id: "version-1",
        flow_id: "flow-1",
        version: 1,
        label: "Initial",
      },
    ],
    error: null,
  });
});

describe("flow versions API", () => {
  it("lists owner-visible history newest first", async () => {
    h.history = [
      { id: "v2", version: 2 },
      { id: "v1", version: 1 },
    ];

    const response = await GET(
      new Request("http://localhost/api/flows/flow-1/versions"),
      context,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ versions: h.history });
  });

  it("publishes a validated snapshot through the atomic RPC", async () => {
    const response = await POST(
      new Request("http://localhost/api/flows/flow-1/versions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: " Initial " }),
      }),
      context,
    );

    expect(response.status).toBe(201);
    expect(h.rpc).toHaveBeenCalledWith(
      "publish_flow_version",
      expect.objectContaining({
        p_flow_id: "flow-1",
        p_published_by: "user-1",
        p_label: "Initial",
        p_graph: expect.objectContaining({
          schema_version: 1,
          entry_node_key: "start",
        }),
      }),
    );
    expect(await response.json()).toMatchObject({
      version: { id: "version-1", version: 1 },
      flow: { id: "flow-1" },
    });
  });

  it("rejects invalid drafts without allocating a version", async () => {
    h.draft.entry_node_id = "missing";

    const response = await POST(
      new Request("http://localhost/api/flows/flow-1/versions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      context,
    );

    expect(response.status).toBe(422);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("keeps legacy status=active clients compatible by publishing", async () => {
    const response = await POST_ACTIVATE(
      new Request("http://localhost/api/flows/flow-1/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      }),
      context,
    );

    expect(response.status).toBe(201);
    expect(h.rpc).toHaveBeenCalledWith(
      "publish_flow_version",
      expect.objectContaining({ p_flow_id: "flow-1" }),
    );
  });
});
