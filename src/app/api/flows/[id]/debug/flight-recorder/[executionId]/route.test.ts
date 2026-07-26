import { beforeEach, describe, expect, it, vi } from "vitest";

const FLOW_ID = "20000000-0000-4000-8000-000000000001";
const RUN_ID = "10000000-0000-4000-8000-000000000001";
const EXECUTION_ID = "30000000-0000-4000-8000-000000000001";

const h = vi.hoisted(() => ({
  ownerAllowed: true,
  runBelongsToFlow: true,
  detailWasRead: false,
}));

vi.mock("@/lib/flows/debug-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/flows/debug-api")>();
  return {
    ...actual,
    requireFlowDebugOwner: async () =>
      h.ownerAllowed
        ? {
            ok: true,
            user: { id: "owner-1" },
            accountId: "account-1",
            supabase: {},
          }
        : {
            ok: false,
            response: actual.debugJson({ error: "Not found" }, { status: 404 }),
          },
  };
});

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "flow_runs") {
        const query = {
          eq: () => query,
          maybeSingle: async () => ({
            data: h.runBelongsToFlow ? { id: RUN_ID, flow_id: FLOW_ID } : null,
            error: null,
          }),
        };
        return { select: () => query };
      }
      if (table === "flow_node_executions") {
        return {
          select: (columns: string) => {
            const query = {
              eq: () => query,
              maybeSingle: async () => {
                if (columns === "id, flow_run_id") {
                  return {
                    data: { id: EXECUTION_ID, flow_run_id: RUN_ID },
                    error: null,
                  };
                }
                h.detailWasRead = true;
                return {
                  data: {
                    id: EXECUTION_ID,
                    flow_run_id: RUN_ID,
                    node_key: "send",
                    node_type: "send_webhook",
                    status: "completed",
                    inputs: {
                      url: "https://user:pass@example.com/hook?token=secret#frag",
                      headers: { Authorization: "Bearer secret" },
                    },
                    outputs: { accepted: true },
                    error: null,
                    metadata: { request_id: "safe" },
                    duration_ms: 5,
                    attempt: 1,
                    started_at: "2026-01-01T00:00:00.000Z",
                    completed_at: "2026-01-01T00:00:00.005Z",
                  },
                  error: null,
                };
              },
            };
            return query;
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { GET } from "./route";

const context = {
  params: Promise.resolve({ id: FLOW_ID, executionId: EXECUTION_ID }),
};

describe("production execution lazy detail", () => {
  beforeEach(() => {
    h.ownerAllowed = true;
    h.runBelongsToFlow = true;
    h.detailWasRead = false;
  });

  it("returns one capped sanitized execution after verifying flow ownership", async () => {
    const response = await GET(new Request("http://localhost/detail"), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(h.detailWasRead).toBe(true);
    expect(body.execution).toMatchObject({
      id: EXECUTION_ID,
      inputs: {
        url: "https://example.com/hook",
        headers: { Authorization: "[REDACTED]" },
      },
      outputs: { accepted: true },
      metadata: { request_id: "safe" },
    });
    expect(body.execution).toHaveProperty("error", null);
    expect(
      new TextEncoder().encode(JSON.stringify(body)).byteLength,
    ).toBeLessThanOrEqual(262_144);
  });

  it("does not materialize payloads when the execution run is outside the flow", async () => {
    h.runBelongsToFlow = false;

    const response = await GET(new Request("http://localhost/detail"), context);

    expect(response.status).toBe(404);
    expect(h.detailWasRead).toBe(false);
  });

  it("does not query storage when the caller is not the flow owner", async () => {
    h.ownerAllowed = false;

    const response = await GET(new Request("http://localhost/detail"), context);

    expect(response.status).toBe(404);
    expect(h.detailWasRead).toBe(false);
  });
});
