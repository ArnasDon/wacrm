import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  run: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/auth/api-context", () => ({
  requireApiKey: h.requireApiKey,
}));

import { GET } from "./route";

const db = {
  from: (table: string) => {
    if (table !== "flow_runs") throw new Error(`unexpected table ${table}`);
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: h.run, error: null }),
            }),
          }),
        }),
      }),
    };
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.requireApiKey.mockResolvedValue({
    accountId: "account-1",
    supabase: db,
  });
  h.run = {
    id: "run-1",
    flow_id: "flow-1",
    account_id: "account-1",
    flow_version_id: "version-1",
    status: "active",
    current_node_key: "send",
    started_at: "2026-07-27T10:00:00.000Z",
    ended_at: null,
    end_reason: null,
    vars: { secret: "do-not-return" },
  };
});

describe("manual flow run status API", () => {
  it("returns a sanitized same-account run status", async () => {
    const response = await GET(
      new Request("http://localhost/api/v1/flows/flow-1/runs/run-1"),
      { params: Promise.resolve({ id: "flow-1", runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    expect(h.requireApiKey).toHaveBeenCalledWith(expect.any(Request), "flows:execute");
    expect(await response.json()).toEqual({
      data: {
        id: "run-1",
        flow_id: "flow-1",
        flow_version_id: "version-1",
        status: "active",
        current_node_key: "send",
        started_at: "2026-07-27T10:00:00.000Z",
        ended_at: null,
        end_reason: null,
      },
    });
  });

  it("returns 404 across accounts or flows", async () => {
    h.run = null;

    const response = await GET(
      new Request("http://localhost/api/v1/flows/flow-1/runs/run-1"),
      { params: Promise.resolve({ id: "flow-1", runId: "run-1" }) },
    );

    expect(response.status).toBe(404);
  });
});
