import { describe, expect, it, vi } from "vitest";

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
      if (table === "flow_runs") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: [
                    {
                      id: "10000000-0000-4000-8000-000000000001",
                      flow_id: "20000000-0000-4000-8000-000000000001",
                      vars: { name: "Ada", access_token: "secret" },
                      status: "completed",
                    },
                  ],
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
            in: () => ({
              order: () => ({
                limit: async () => ({
                  data: [
                  {
                    id: "new",
                    flow_run_id: "10000000-0000-4000-8000-000000000001",
                    node_key: "send",
                    attempt: 2,
                    status: "completed",
                    inputs: { headers: { Authorization: "Bearer secret" } },
                    outputs: { ok: true },
                    started_at: "2026-01-01T00:00:02.000Z",
                  },
                  {
                    id: "old",
                    flow_run_id: "10000000-0000-4000-8000-000000000001",
                    node_key: "send",
                    attempt: 1,
                    status: "error",
                    inputs: {},
                    outputs: null,
                    started_at: "2026-01-01T00:00:01.000Z",
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
  }),
}));

import { GET } from "./route";

describe("production flow flight recorder", () => {
  it("returns attempts plus latest-per-node with secrets redacted", async () => {
    const response = await GET(
      new Request("http://localhost/api/flows/id/debug/flight-recorder"),
      {
        params: Promise.resolve({
          id: "20000000-0000-4000-8000-000000000001",
        }),
      },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.executions).toHaveLength(2);
    expect(
      body.latest_by_run["10000000-0000-4000-8000-000000000001"].send.id,
    ).toBe("new");
    expect(body.executions[0].inputs.headers.Authorization).toBe("[REDACTED]");
    expect(body.runs[0].vars.access_token).toBe("[REDACTED]");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
