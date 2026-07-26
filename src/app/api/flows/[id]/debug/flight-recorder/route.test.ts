import { beforeEach, describe, expect, it, vi } from "vitest";

const RUN_A = "10000000-0000-4000-8000-000000000001";
const RUN_B = "10000000-0000-4000-8000-000000000002";
const FLOW_ID = "20000000-0000-4000-8000-000000000001";

const harness = vi.hoisted(() => ({
  executionSelect: "",
  executionLimit: 0,
  executionRunIds: [] as string[],
  executionCursorFilter: null as string | null,
  executionOrders: [] as string[],
  executionRows: [] as Array<{
    id: string;
    flow_run_id: string;
    node_key: string;
    node_type: string;
    attempt: number;
    status: string;
    duration_ms: number;
    started_at: string;
    completed_at: string;
  }>,
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
      if (table === "flow_runs") {
        const state = { requestedRun: null as string | null };
        const query = {
          eq: (column: string, value: string) => {
            if (column === "id") state.requestedRun = value;
            return query;
          },
          order: () => query,
          limit: async () => ({
            data: [
              {
                id: RUN_A,
                flow_id: FLOW_ID,
                status: "completed",
                started_at: "2026-01-01T00:00:00.000Z",
              },
              {
                id: RUN_B,
                flow_id: FLOW_ID,
                status: "error",
                started_at: "2025-12-31T00:00:00.000Z",
              },
            ].filter(
              (run) => !state.requestedRun || run.id === state.requestedRun,
            ),
            error: null,
          }),
        };
        return { select: () => query };
      }
      if (table === "flow_node_executions") {
        const query = {
          in: (_column: string, values: string[]) => {
            harness.executionRunIds = values;
            return query;
          },
          lt: (_column: string, value: string) => {
            harness.executionCursorFilter = `legacy:${value}`;
            return query;
          },
          or: (filter: string) => {
            harness.executionCursorFilter = filter;
            return query;
          },
          order: (column: string) => {
            harness.executionOrders.push(column);
            return query;
          },
          limit: async (value: number) => {
            harness.executionLimit = value;
            return {
              data: harness.executionRows
                .filter((row) =>
                  harness.executionRunIds.includes(row.flow_run_id),
                )
                .filter((_row, index) =>
                  harness.executionCursorFilter ? index > 0 : true,
                )
                .slice(0, value),
              error: null,
            };
          },
        };
        return {
          select: (columns: string) => {
            harness.executionSelect = columns;
            return query;
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { GET } from "./route";

function request(query = "") {
  return GET(
    new Request(
      `http://localhost/api/flows/${FLOW_ID}/debug/flight-recorder${query}`,
    ),
    { params: Promise.resolve({ id: FLOW_ID }) },
  );
}

describe("production flow flight recorder", () => {
  beforeEach(() => {
    harness.executionSelect = "";
    harness.executionLimit = 0;
    harness.executionRunIds = [];
    harness.executionCursorFilter = null;
    harness.executionOrders = [];
    harness.executionRows = [
      {
        id: "30000000-0000-4000-8000-000000000002",
        flow_run_id: RUN_A,
        node_key: "send",
        node_type: "send_message",
        attempt: 2,
        status: "completed",
        duration_ms: 4,
        started_at: "2026-01-01T00:00:02.000Z",
        completed_at: "2026-01-01T00:00:02.004Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000001",
        flow_run_id: RUN_A,
        node_key: "send",
        node_type: "send_message",
        attempt: 1,
        status: "error",
        duration_ms: 3,
        started_at: "2026-01-01T00:00:02.000Z",
        completed_at: "2026-01-01T00:00:02.003Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000003",
        flow_run_id: RUN_B,
        node_key: "end",
        node_type: "end",
        attempt: 1,
        status: "completed",
        duration_ms: 1,
        started_at: "2025-12-31T00:00:01.000Z",
        completed_at: "2025-12-31T00:00:01.001Z",
      },
    ];
  });

  it("filters attempts by run_id and keeps a stable response envelope", async () => {
    const response = await request(`?run_id=${RUN_A}&limit=1`);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.runs.map((run: { id: string }) => run.id)).toEqual([RUN_A]);
    expect(
      body.executions.map((execution: { id: string }) => execution.id),
    ).toEqual(["30000000-0000-4000-8000-000000000002"]);
    expect(body.latest_by_run[RUN_A].send.id).toBe(
      "30000000-0000-4000-8000-000000000002",
    );
    expect(body.page).toMatchObject({
      limit: 1,
      returned: 1,
      truncated: true,
      truncation_reason: "page",
      budget_bytes: 262_144,
    });
    expect(body.page.next_cursor).toEqual(expect.any(String));
    expect(body.page.next_cursor).not.toBe("2026-01-01T00:00:02.000Z");
    expect(harness.executionRunIds).toEqual([RUN_A]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("uses a deterministic compound cursor without skipping equal timestamps", async () => {
    const firstResponse = await request(`?run_id=${RUN_A}&limit=1`);
    const first = await firstResponse.json();
    harness.executionCursorFilter = null;
    harness.executionOrders = [];

    const response = await request(
      `?run_id=${RUN_A}&limit=1&cursor=${encodeURIComponent(first.page.next_cursor)}`,
    );
    const body = await response.json();

    expect(
      body.executions.map((execution: { id: string }) => execution.id),
    ).toEqual(["30000000-0000-4000-8000-000000000001"]);
    expect(harness.executionCursorFilter).toContain(
      "started_at.eq.2026-01-01T00:00:02.000Z",
    );
    expect(harness.executionCursorFilter).toContain(
      "id.lt.30000000-0000-4000-8000-000000000002",
    );
    expect(harness.executionOrders).toEqual(["started_at", "id"]);
    expect(harness.executionLimit).toBe(2);
    expect(harness.executionSelect).not.toMatch(
      /\b(inputs|outputs|error|vars)\b/,
    );
  });

  it("rejects invalid pagination input", async () => {
    await expect(request("?limit=500")).resolves.toMatchObject({ status: 400 });
    await expect(request("?cursor=not-a-date")).resolves.toMatchObject({
      status: 400,
    });
  });

  it("keeps the response envelope and reports aggregate-budget truncation", async () => {
    harness.executionRows = Array.from({ length: 100 }, (_, index) => ({
      id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      flow_run_id: RUN_A,
      node_key: `${index}-${"n".repeat(4_096)}`,
      node_type: "send_message",
      attempt: 1,
      status: "completed",
      duration_ms: 1,
      started_at: new Date(
        Date.UTC(2026, 0, 1, 0, 1, 40 - index),
      ).toISOString(),
      completed_at: new Date(
        Date.UTC(2026, 0, 1, 0, 1, 40 - index, 1),
      ).toISOString(),
    }));

    const response = await request(`?run_id=${RUN_A}&limit=100`);
    const body = await response.json();

    expect(body).toMatchObject({
      runs: expect.any(Array),
      executions: expect.any(Array),
      latest_by_run: expect.any(Object),
      page: {
        limit: 100,
        truncated: true,
        truncation_reason: "budget",
        budget_bytes: 262_144,
      },
    });
    expect(body.executions.length).toBeGreaterThan(0);
    expect(body.executions.length).toBeLessThan(100);
    expect(
      new TextEncoder().encode(JSON.stringify(body)).byteLength,
    ).toBeLessThanOrEqual(262_144);
  });
});
