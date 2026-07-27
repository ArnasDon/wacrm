import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  rpc: vi.fn(),
  flow: null as Record<string, unknown> | null,
  version: null as Record<string, unknown> | null,
  started: vi.fn(),
}));

vi.mock("@/lib/auth/api-context", () => ({
  requireApiKey: h.requireApiKey,
}));

vi.mock("@/lib/flows/engine", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/flows/engine")>();
  return {
    ...original,
    startFlowRunFromTrigger: h.started,
  };
});

import { POST } from "./route";

const db = {
  from: (table: string) => {
    if (table === "flows") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: h.flow, error: null }),
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
              maybeSingle: async () => ({ data: h.version, error: null }),
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  },
  rpc: h.rpc,
};

const graph = {
  schema_version: 2,
  entry_node_key: "trigger",
  fallback_policy: {
    on_unknown_reply: "ignore",
    max_reprompts: 0,
    on_timeout_hours: 24,
    on_exhaust: "end",
  },
  variable_schema: [{ key: "ticket_id", type: "string", required: false }],
  nodes: [
    {
      node_key: "trigger",
      node_type: "trigger_manual",
      config: { next_node_key: "end" },
      position_x: -100,
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
};

const context = {
  params: Promise.resolve({ id: "flow-1" }),
};

beforeEach(() => {
  vi.clearAllMocks();
  h.requireApiKey.mockResolvedValue({
    accountId: "account-1",
    keyId: "key-1",
    scopes: ["flows:execute"],
    supabase: db,
  });
  h.flow = {
    id: "flow-1",
    account_id: "account-1",
    user_id: "user-1",
    name: "Manual",
    status: "active",
    published_version_id: "version-1",
    trigger_type: "manual",
    trigger_config: {},
    fallback_policy: graph.fallback_policy,
    entry_node_id: "end",
    draft_revision: 1,
  };
  h.version = {
    id: "version-1",
    flow_id: "flow-1",
    account_id: "account-1",
    graph,
  };
  h.rpc.mockImplementation(async (name: string) => {
    if (name === "accept_flow_trigger_invocation") {
      return {
        data: [
          {
            id: "invocation-1",
            status: "pending",
            claim_token: "claim-1",
            flow_version_id: "version-1",
          },
        ],
        error: null,
      };
    }
    if (name === "complete_flow_trigger_invocation") {
      return { data: true, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  h.started.mockResolvedValue({
    consumed: true,
    flow_run_id: "run-1",
    outcome: "started",
  });
});

describe("manual flow run API", () => {
  it("requires the flows:execute scope and awaits route params", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/flows/flow-1/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "manual-1",
        },
        body: JSON.stringify({ variables: { ticket_id: "T-1" } }),
      }),
      context,
    );

    expect(response.status).toBe(202);
    expect(h.requireApiKey).toHaveBeenCalledWith(expect.any(Request), "flows:execute");
    expect(h.rpc).toHaveBeenCalledWith(
      "accept_flow_trigger_invocation",
      expect.objectContaining({
        p_account_id: "account-1",
        p_flow_id: "flow-1",
        p_source: "manual",
        p_idempotency_key: "manual-1",
        p_variables: { ticket_id: "T-1" },
      }),
    );
    expect(h.started).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerInvocationId: "invocation-1",
        variables: { ticket_id: "T-1" },
      }),
    );
    expect(await response.json()).toEqual({
      data: { run_id: "run-1", status: "started" },
    });
  });

  it("requires Idempotency-Key before mutating", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/flows/flow-1/runs", {
        method: "POST",
        body: "{}",
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("404s flows outside the API key account", async () => {
    h.flow = null;

    const response = await POST(
      new Request("http://localhost/api/v1/flows/flow-1/runs", {
        method: "POST",
        headers: { "idempotency-key": "manual-1" },
        body: "{}",
      }),
      context,
    );

    expect(response.status).toBe(404);
    expect(h.started).not.toHaveBeenCalled();
  });
});
