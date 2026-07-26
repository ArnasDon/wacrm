import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ownerAllowed: true,
  rpcName: "",
  rpcArgs: {} as Record<string, unknown>,
  execution: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/flows/debug-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/flows/debug-api")>()),
  requireFlowDebugOwner: async () =>
    h.ownerAllowed
      ? {
          ok: true,
          user: { id: "40000000-0000-4000-8000-000000000001" },
          accountId: "50000000-0000-4000-8000-000000000001",
          supabase: {},
        }
      : {
          ok: false,
          response: Response.json({ error: "Not found" }, { status: 404 }),
        },
}));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.rpcName = name;
      h.rpcArgs = args;
      return {
        data: h.execution ? { execution_json: h.execution } : null,
        error: null,
      };
    },
  }),
}));

import { GET } from "./route";

const context = {
  params: Promise.resolve({
    id: "20000000-0000-4000-8000-000000000001",
    sessionId: "10000000-0000-4000-8000-000000000001",
    executionId: "30000000-0000-4000-8000-000000000001",
  }),
};

beforeEach(() => {
  h.ownerAllowed = true;
  h.rpcName = "";
  h.rpcArgs = {};
  h.execution = {
    id: "30000000-0000-4000-8000-000000000001",
    node_key: "send",
    node_type: "send_message",
    status: "completed",
    attempt: 2,
    duration_ms: 9,
    created_at: "2026-07-26T12:00:00.000Z",
    inputs: {
      truncated: true,
      reason: "legacy_payload_exceeded_limit",
      original_bytes: 100_000,
    },
    outputs: { sent: true },
    error: null,
    simulated_effects: [],
    metadata: { authorization: "secret", request_id: "safe" },
  };
});

describe("debug execution detail API", () => {
  it("loads one bounded execution through an owner/flow/session-bound RPC", async () => {
    const response = await GET(new Request("http://localhost/debug"), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(h.rpcName).toBe("read_flow_debug_execution_detail");
    expect(h.rpcArgs).toEqual({
      p_flow_id: "20000000-0000-4000-8000-000000000001",
      p_session_id: "10000000-0000-4000-8000-000000000001",
      p_execution_id: "30000000-0000-4000-8000-000000000001",
      p_created_by: "40000000-0000-4000-8000-000000000001",
      p_max_field_bytes: 32_768,
    });
    expect(body.execution).toMatchObject({
      id: "30000000-0000-4000-8000-000000000001",
      node_key: "send",
      status: "completed",
      inputs: { truncated: true, original_bytes: 100_000 },
      metadata: { authorization: "[REDACTED]", request_id: "safe" },
    });
  });

  it("does not call the service RPC when owner authorization fails", async () => {
    h.ownerAllowed = false;

    const response = await GET(new Request("http://localhost/debug"), context);

    expect(response.status).toBe(404);
    expect(h.rpcName).toBe("");
  });
});
